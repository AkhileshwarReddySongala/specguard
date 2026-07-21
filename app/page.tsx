"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { AnalysisResult, CompiledContract, Finding, JudgmentMode } from "@/lib/contracts";
import { CURATED_PRESETS, DEMO_CONTRACTS, DEMOS, SAMPLE_CONTRACT } from "@/lib/fixtures";

type ContractSource = "repository" | "pasted" | "sample" | "demo" | undefined;
type PRContext = { title: string; agentsMarkdown: string | null; agentsPath: string | null };
type Connector = { top: number; label: string } | undefined;
type Stage = { stage: string; message: string };
type WorkflowStep = "select" | "contract" | "coverage" | "analyze" | "verdict";

const verdictCopy = { merge_blocked: "MERGE BLOCKED", changes_required: "CHANGES REQUIRED", approved_with_warnings: "APPROVED WITH WARNINGS", approved: "APPROVED" };
const verdictReason = { merge_blocked: "The code may pass review. It was not authorized.", changes_required: "The contract requires a correction before this change is ready.", approved_with_warnings: "Coverage is partial or only non-blocking evidence remains.", approved: "Every selected contract rule was assessed without an active violation." };
const workflowSteps: Array<{ id: WorkflowStep; label: string }> = [
  { id: "select", label: "Select PR" }, { id: "contract", label: "Confirm contract" }, { id: "coverage", label: "Choose coverage" }, { id: "analyze", label: "Analyze" }, { id: "verdict", label: "Evidence verdict" },
];

function sourceLines(value: string) { return value.split(/\r?\n/); }
function badgeText(item: Finding) { return item.source === "deterministic" ? "DETERMINISTIC" : `AI JUDGMENT · ${item.confidence.toUpperCase()}`; }
function providerCopy(value: AnalysisResult["providerStatus"], unavailable = false) { return value === "nvidia" ? "NVIDIA judgment" : value === "gemini" ? "Gemini fallback" : value === "ollama" ? "Local Ollama" : value === "mixed" ? "Multi-provider judgment" : value === "fallback" ? "Committed fallback" : unavailable ? "AI judgment partial" : "No AI judgment required"; }
function mergeStage(setter: React.Dispatch<React.SetStateAction<Stage[]>>, event: { stage?: string; message?: string }) { if (!event.stage || !event.message) return; const { stage, message } = event; setter((stages) => [...stages.filter((item) => item.stage !== stage), { stage, message }]); }

export default function Home() {
  const [spec, setSpec] = useState("");
  const [prUrl, setPrUrl] = useState("");
  const [contract, setContract] = useState<CompiledContract>();
  const [result, setResult] = useState<AnalysisResult>();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState<"context" | "compile" | "analyze" | "">("");
  const [selected, setSelected] = useState<string>();
  const [context, setContext] = useState<PRContext>();
  const [contractSource, setContractSource] = useState<ContractSource>();
  const [compileStages, setCompileStages] = useState<Stage[]>([]);
  const [analysisStages, setAnalysisStages] = useState<Stage[]>([]);
  const [judgmentMode, setJudgmentMode] = useState<JudgmentMode>("relevant");
  const [connector, setConnector] = useState<Connector>();
  const [startedAt, setStartedAt] = useState<number>();
  const [now, setNow] = useState(Date.now());
  const abortRef = useRef<AbortController | undefined>(undefined);
  const specPane = useRef<HTMLDivElement>(null);
  const diffPane = useRef<HTMLDivElement>(null);
  const evidenceGrid = useRef<HTMLDivElement>(null);
  const findingRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const isDemo = prUrl.startsWith("demo://");
  const findings = result?.findings ?? [];
  const elapsedSeconds = startedAt ? Math.floor((now - startedAt) / 1000) : 0;
  const formatTime = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;

  useEffect(() => { if (!loading) return; const timer = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(timer); }, [loading]);

  const resetAnalysis = useCallback(() => { setContract(undefined); setResult(undefined); setSelected(undefined); setConnector(undefined); setCompileStages([]); setAnalysisStages([]); setStartedAt(undefined); }, []);
  const updatePr = useCallback((value: string) => { setPrUrl(value); setError(""); resetAnalysis(); setContext(undefined); if (value.startsWith("demo://")) { setSpec(DEMO_CONTRACTS[value] ?? SAMPLE_CONTRACT); setContractSource("demo"); } else { setSpec(""); setContractSource(undefined); } }, [resetAnalysis]);
  const updateSpec = (value: string) => { setSpec(value); resetAnalysis(); };

  const refreshConnector = useCallback(() => {
    const active = findings.find((item) => item.id === selected); const grid = evidenceGrid.current; const left = specPane.current; const right = diffPane.current;
    if (!active || !grid || !left || !right) return setConnector(undefined);
    const rule = left.querySelector(`[data-line='${active.specLine}']`) as HTMLElement | null;
    const code = right.querySelector(`[data-file='${active.filePath}'][data-line='${active.line}']`) as HTMLElement | null;
    if (!rule || !code) return setConnector(undefined);
    const visible = (node: HTMLElement, container: HTMLDivElement) => node.offsetTop >= container.scrollTop && node.offsetTop + node.offsetHeight <= container.scrollTop + container.clientHeight;
    if (!visible(rule, left) || !visible(code, right)) return setConnector(undefined);
    const top = (rule.getBoundingClientRect().top + code.getBoundingClientRect().top) / 2 - grid.getBoundingClientRect().top + 10;
    setConnector({ top, label: `rule §${active.specLine} → line ${active.line}` });
  }, [findings, selected]);

  const selectFinding = useCallback((item: Finding, focus = false) => {
    setSelected(item.id);
    requestAnimationFrame(() => {
      const rule = specPane.current?.querySelector(`[data-line='${item.specLine}']`) as HTMLElement | null;
      const code = diffPane.current?.querySelector(`[data-file='${item.filePath}'][data-line='${item.line}']`) as HTMLElement | null;
      if (rule && specPane.current) specPane.current.scrollTo({ top: rule.offsetTop - 120, behavior: "smooth" });
      if (code && diffPane.current) diffPane.current.scrollTo({ top: code.offsetTop - 120, behavior: "smooth" });
      if (focus) findingRefs.current[item.id]?.focus();
      window.setTimeout(refreshConnector, 260);
    });
  }, [refreshConnector]);

  useEffect(() => { if (selected) refreshConnector(); }, [selected, refreshConnector]);
  useEffect(() => { const move = () => refreshConnector(); const left = specPane.current; const right = diffPane.current; left?.addEventListener("scroll", move); right?.addEventListener("scroll", move); window.addEventListener("resize", move); return () => { left?.removeEventListener("scroll", move); right?.removeEventListener("scroll", move); window.removeEventListener("resize", move); }; }, [refreshConnector, result]);

  async function loadPrContext(value = prUrl) {
    setError(""); resetAnalysis(); setLoading("context"); setStartedAt(Date.now()); setCompileStages([{ stage: "context", message: "Reading pull request context at head SHA" }]);
    try {
      const response = await fetch("/api/pr-context", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prUrl: value }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Unable to load PR context.");
      setContext(payload);
      if (payload.agentsMarkdown) { setSpec(payload.agentsMarkdown); setContractSource("repository"); } else { setSpec(""); setContractSource(undefined); }
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to load PR context."); }
    finally { setLoading(""); setStartedAt(undefined); }
  }
  async function usePreset(url: string) { updatePr(url); await loadPrContext(url); }
  function choosePasted() { setSpec(""); setContractSource("pasted"); resetAnalysis(); }
  function chooseSample() { setSpec(SAMPLE_CONTRACT); setContractSource("sample"); resetAnalysis(); }
  function cancelRun() { abortRef.current?.abort(); }
  async function readStream(response: Response, onEvent: (event: Record<string, unknown>) => void) {
    if (!response.body) throw new Error("Streaming response was unavailable.");
    const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = "";
    while (true) { const { done, value } = await reader.read(); if (done) break; buffer += decoder.decode(value, { stream: true }); const events = buffer.split("\n\n"); buffer = events.pop() || ""; for (const message of events) if (message.startsWith("data: ")) onEvent(JSON.parse(message.slice(6)) as Record<string, unknown>); }
  }
  async function compile() {
    if (!spec.trim()) return; setError(""); resetAnalysis(); setLoading("compile"); setStartedAt(Date.now()); setCompileStages([{ stage: "queued", message: "Contract queued" }]); const controller = new AbortController(); abortRef.current = controller;
    try {
      const response = await fetch("/api/compile", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ specMarkdown: spec }), signal: controller.signal });
      if (!response.ok) throw new Error((await response.json()).error || "Compilation failed.");
      let finalContract: CompiledContract | undefined; let streamError = "";
      await readStream(response, (event) => { if (event.type === "progress") mergeStage(setCompileStages, { stage: String(event.stage), message: String(event.message) }); if (event.type === "final") finalContract = event.contract as CompiledContract; if (event.type === "error") streamError = String(event.message || "Compilation failed."); });
      if (streamError) throw new Error(streamError); if (!finalContract) throw new Error("Compilation stream ended before a final contract was received."); setContract(finalContract);
    } catch (caught) { setError(caught instanceof DOMException && caught.name === "AbortError" ? "Compilation cancelled." : caught instanceof Error ? caught.message : "Compilation failed."); }
    finally { abortRef.current = undefined; setLoading(""); setStartedAt(undefined); }
  }
  async function analyze() {
    if (!contract) return; setError(""); setLoading("analyze"); setStartedAt(Date.now()); setAnalysisStages([{ stage: "queued", message: "Deterministic evidence queued" }]); const controller = new AbortController(); abortRef.current = controller;
    try {
      const response = await fetch("/api/analyze", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prUrl, compiledContract: contract, judgmentMode }), signal: controller.signal });
      if (!response.ok) throw new Error((await response.json()).error || "Analysis failed.");
      let finalResult: AnalysisResult | undefined; let streamError = "";
      await readStream(response, (event) => { if (event.type === "progress") mergeStage(setAnalysisStages, { stage: String(event.stage), message: String(event.message) }); if (event.type === "final") finalResult = event.result as AnalysisResult; if (event.type === "error") streamError = String(event.message || "Analysis failed."); });
      if (streamError) throw new Error(streamError); if (!finalResult) throw new Error("Analysis stream ended before a final result was received."); setResult(finalResult); setSelected(finalResult.findings[0]?.id);
    } catch (caught) { setError(caught instanceof DOMException && caught.name === "AbortError" ? "Analysis cancelled. No verdict was produced." : caught instanceof Error ? caught.message : "Analysis failed."); }
    finally { abortRef.current = undefined; setLoading(""); setStartedAt(undefined); }
  }
  function onFindingKeyDown(event: React.KeyboardEvent<HTMLButtonElement>, index: number) {
    if (!findings.length) return; let target = index;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") target = (index + 1) % findings.length;
    else if (event.key === "ArrowLeft" || event.key === "ArrowUp") target = (index - 1 + findings.length) % findings.length;
    else if (event.key === "Home") target = 0;
    else if (event.key === "End") target = findings.length - 1;
    else if (event.key === "Enter" || event.key === " ") { event.preventDefault(); selectFinding(findings[index], true); return; } else return;
    event.preventDefault(); selectFinding(findings[target], true);
  }

  const deterministicFindings = findings.filter((item) => item.source === "deterministic").length;
  const aiFindings = findings.length - deterministicFindings;
  const coverage = result?.judgmentCoverage;
  const passedChecks = result ? result.contract.checks.filter((check) => !findings.some((item) => item.source === "deterministic" && item.id.startsWith(check.id) && !item.preExisting)) : [];
  const hasCodeChecks = Boolean(result?.contract.checks.length);
  const hasJudgeableRules = Boolean(coverage?.totalRules);
  const hasNoAssessableRules = Boolean(result) && !hasCodeChecks && !hasJudgeableRules;
  const aiOnlyCoverage = Boolean(result) && !hasCodeChecks && hasJudgeableRules;
  const requiresChoice = !isDemo && Boolean(context) && !contractSource;
  const action = isDemo || contractSource ? (contract ? analyze : compile) : () => loadPrContext();
  const actionLabel = loading === "context" ? "LOADING CONTRACT…" : loading === "compile" ? "COMPILING CONTRACT…" : loading === "analyze" ? "ANALYZING DIFF…" : isDemo || contractSource ? contract ? "ANALYZE PULL REQUEST" : "COMPILE CONTRACT" : "LOAD CONTRACT";
  const activeStages = loading === "analyze" ? analysisStages : compileStages;
  const activeStep: WorkflowStep = result ? "verdict" : loading === "analyze" ? "analyze" : contract ? "coverage" : contractSource || context ? "contract" : "select";
  const stepIndex = workflowSteps.findIndex((step) => step.id === activeStep);
  const hasContractStage = Boolean(contractSource || context || isDemo);

  return <main>
    <header><span className="wordmark">SPEC<span>GUARD</span></span><span className="eyebrow">Contract enforcement for agent-written code</span></header>
    <section className="hero">
      <div><p className="kicker">GOVERNANCE, NOT REVIEW</p><h1>Prove AI-written code matches what humans authorized.</h1><p>One contract. One public pull request. An evidence-backed merge verdict.</p></div>
      <div className="hero-action"><label htmlFor="pr">PUBLIC GITHUB PR URL</label><div><input id="pr" value={prUrl} onChange={(event) => updatePr(event.target.value)} placeholder="https://github.com/owner/repo/pull/42" />{contractSource ? <button className="primary secondary-action" onClick={() => updatePr("")} disabled={Boolean(loading)}>CHANGE PR</button> : <button className="primary" onClick={() => loadPrContext()} disabled={Boolean(loading) || !prUrl.trim()}>{loading === "context" ? "LOADING CONTRACT…" : "LOAD CONTRACT"}</button>}</div><small>Public JavaScript or TypeScript pull requests only. Contracts are loaded at the PR head.</small></div>
    </section>
    <section className="workspace">
      {!result && <section className="input-flow">
        <ol className="workflow-rail" aria-label="Analysis workflow">{workflowSteps.map((step, index) => <li className={index < stepIndex ? "complete" : index === stepIndex ? "active" : ""} key={step.id}><span>{index < stepIndex ? "✓" : index + 1}</span><b>{step.label}</b></li>)}</ol>
        {!hasContractStage && <><section className="preset-section"><div><p className="kicker">START WITH A VERIFIED PUBLIC PR</p><p>Choose a short live example, or paste a public GitHub pull request above.</p></div><div className="preset-row">{CURATED_PRESETS.map((preset) => <button className={prUrl === preset.url ? "preset active" : "preset"} key={preset.url} onClick={() => usePreset(preset.url)} disabled={Boolean(loading)}><b>{preset.label}</b><span>{preset.detail}</span></button>)}</div></section><details className="scenario-section"><summary>AUTHORED DEMO SCENARIOS</summary><div className="scenario-row">{DEMOS.map((demo) => <button className={prUrl === demo.id ? "demo active" : "demo"} key={demo.id} onClick={() => updatePr(demo.id)}>{demo.label}</button>)}</div></details></>}
        {hasContractStage && <section className="stage-surface contract-stage"><div className="stage-heading"><div><p className="kicker">STEP 2 · CONTRACT AUTHORITY</p><h2>{contractSource === "repository" ? "Confirm the repository contract" : requiresChoice ? "Choose a contract source" : "Review the contract before compilation"}</h2></div>{contractSource === "repository" && <span className="source-label">LOADED · {context?.agentsPath}</span>}{contractSource === "sample" && <span className="source-label sample">ILLUSTRATIVE SAMPLE</span>}</div>
          {contractSource === "sample" && <p className="notice">Example contract — edit it to make it yours.</p>}
          {requiresChoice ? <div className="choice"><strong>No AGENTS.md found</strong><p>Use your own contract or an explicitly illustrative sample. SpecGuard will never silently infer one.</p><div><button className="demo" onClick={choosePasted}>PASTE A CONTRACT</button><button className="demo" onClick={chooseSample}>USE ILLUSTRATIVE SAMPLE</button></div></div> : <><label className="sr-only" htmlFor="contract">CONTRACT</label><textarea id="contract" value={spec} onChange={(event) => updateSpec(event.target.value)} placeholder={contractSource === "pasted" ? "Paste your engineering contract here…" : "Load a PR contract first."} disabled={!isDemo && !contractSource} />{!contract && <div className="stage-action"><p>{sourceLines(spec).filter(Boolean).length} authored lines ready for allowlisted compilation.</p><button className="primary" onClick={compile} disabled={Boolean(loading) || !spec.trim()}>COMPILE CONTRACT</button></div>}</>}</section>}
        {contract && <section className="stage-surface coverage-stage"><div className="stage-heading"><div><p className="kicker">STEP 3 · AI JUDGMENT COVERAGE</p><h2>Choose what receives model judgment.</h2></div><span className="source-label">{contract.checks.length} DETERMINISTIC · {contract.unexpressibleRules.length} AI CANDIDATES</span></div><fieldset className="judgment-mode"><legend>Coverage mode</legend><label><input type="radio" name="judgment-mode" checked={judgmentMode === "relevant"} onChange={() => setJudgmentMode("relevant")} /><span><b>Judge relevant rules</b><small>Recommended. Excludes only explicit rules whose scope cannot touch the changed files.</small></span></label><label><input type="radio" name="judgment-mode" checked={judgmentMode === "all"} onChange={() => setJudgmentMode("all")} /><span><b>Judge all rules</b><small>Slower. Evaluates every unresolved rule during this browser session, up to five minutes.</small></span></label></fieldset><div className="stage-action"><p>Deterministic checks are always run. AI judgment cannot change their evidence.</p><button className="primary" onClick={analyze} disabled={Boolean(loading)}>ANALYZE PULL REQUEST</button></div>{contract.compilerDiagnostics.map((diagnostic) => <p className="notice" key={diagnostic}>Compiler recovery: {diagnostic.replace(/_/g, " ")}</p>)}</section>}
        {loading && <section className="run-panel" aria-live="polite"><div className="run-heading"><div><p className="kicker">LIVE RUN · {loading === "context" ? "STEP 1" : loading === "analyze" ? "STEP 4" : "STEP 2"}</p><h2>{loading === "context" ? "Loading pull request context" : loading === "analyze" ? "Building the evidence trail" : "Compiling contract authority"}</h2></div><div className="run-time"><b>{formatTime(elapsedSeconds)}</b><span>{loading === "context" ? "elapsed · GitHub snapshot" : "elapsed · up to 5:00"}</span></div></div><div className="run-stats"><span><b>{loading === "context" ? "1" : loading === "compile" ? sourceLines(spec).filter(Boolean).length : contract?.checks.length ?? 0}</b> {loading === "context" ? "public PR" : loading === "compile" ? "contract lines" : "deterministic checks"}</span><span><b>{loading === "context" ? "HEAD" : loading === "compile" ? contract?.unexpressibleRules.length ?? "—" : activeStages.find((stage) => stage.message.match(/\d+\/\d+/))?.message.match(/\d+\/\d+/)?.[0] ?? "—"}</b> {loading === "context" ? "snapshot" : "AI assessed"}</span><span><b>{loading === "context" ? "GitHub" : loading === "analyze" ? judgmentMode : "allowlisted"}</b> mode</span></div><ol className="stage-list" aria-label={loading === "analyze" ? "Analysis progress" : "Compilation progress"}>{activeStages.map((stage) => <li key={stage.stage}>✓ {stage.message}</li>)}</ol><div className="run-footer"><span>Keep this tab open. Refreshing or cancelling ends this browser-session run.</span><button className="demo cancel-run" onClick={cancelRun}>CANCEL RUN</button></div></section>}
      </section>}
      {error && <div className="error" role="alert"><strong>Analysis needs attention.</strong><span>{error}</span><small>Long runs are browser-session-only. Retry after provider cooldown, or use a committed demo scenario.</small></div>}
      {result && <section className={`results ${result.verdict}`}>
        {contractSource === "sample" && <p className="notice">Example contract — findings illustrate the mechanism; edit it to make it yours.</p>}
        <div className="verdict"><div className="verdict-main"><p className="kicker">STEP 5 · PULL REQUEST VERDICT</p><h2>{verdictCopy[result.verdict]}</h2><p>{verdictReason[result.verdict]}</p></div><div className="evidence-ledger"><span><b>{deterministicFindings}</b> deterministic findings</span>{hasCodeChecks ? <span><b>{passedChecks.length}</b> deterministic checks passed</span> : <span><b>0</b> deterministic checks</span>}<span><b>{aiFindings}</b> AI findings</span>{coverage && <span><b>{coverage.completedRules}/{coverage.selectedRules}</b> AI rules assessed</span>}</div><div className="score"><span>{result.judgmentUnavailable ? "PARTIAL SCORE" : "COMPLIANCE"}</span><strong>{result.complianceScore}</strong><small>{result.judgmentUnavailable ? "/100 CAP" : "/100"}</small></div></div>
        <div className="result-status"><span className="provider">{providerCopy(result.providerStatus, result.judgmentUnavailable)}</span>{coverage && <span>AI assessment: {coverage.completedRules}/{coverage.selectedRules} selected rules ({coverage.selectedRules ? Math.round((coverage.completedRules / coverage.selectedRules) * 100) : 100}%) · {coverage.scopeExcludedRules} scoped out · {coverage.unassessedRules} unassessed</span>}{result.judgmentUnavailable && <span className="partial-label">PARTIAL RESULT · score capped at 79 until {coverage?.unassessedRules ?? 0} selected rule(s) are assessed</span>}</div>
        {result.diagnostics.map((message) => <p className="notice" key={message}>{message}</p>)}{result.contract.compilerDiagnostics.map((diagnostic) => <p className="notice" key={`compiler-${diagnostic}`}>Compiler recovery: {diagnostic.replace(/_/g, " ")}</p>)}
        <section className="findings-region"><div className="section-heading"><div><p className="kicker">FINDINGS · EVIDENCE INDEX</p><h3>{findings.length ? "Trace each verdict to its source." : hasNoAssessableRules ? "No enforceable contract rules." : aiOnlyCoverage ? "AI judgment coverage." : "Evidence of checks that passed."}</h3></div><span>{findings.length ? `${findings.length} finding${findings.length === 1 ? "" : "s"}` : hasNoAssessableRules ? "No checks available" : aiOnlyCoverage ? `${coverage?.completedRules ?? 0}/${coverage?.selectedRules ?? 0} AI rules assessed` : `${passedChecks.length} passed checks`}</span></div>{findings.length ? <div className="findings" role="listbox" aria-label="Findings">{findings.map((item, index) => <div key={item.id} className="finding-wrap"><button ref={(node) => { findingRefs.current[item.id] = node; }} role="option" aria-selected={selected === item.id} tabIndex={selected === item.id || (!selected && index === 0) ? 0 : -1} className={selected === item.id ? "finding selected" : "finding"} onClick={() => selectFinding(item)} onKeyDown={(event) => onFindingKeyDown(event, index)}><span className={item.source === "deterministic" ? "badge solid" : "badge dashed"}>{badgeText(item)}</span><span className="finding-copy"><b>{item.violationType}</b><small>{item.preExisting ? "Pre-existing evidence — excluded from verdict" : item.action}</small>{item.source === "llm" && <small className="rule-quote">Contract: {item.requirementQuote}</small>}</span><code>rule §{item.specLine} → changed line {item.line}</code></button>{selected === item.id && <div className="mobile-chain"><div><p>THE CONTRACT SAYS</p><code>{item.requirementQuote}</code></div><div className="chain-copy">▼ violated by ▼</div><div><p>THE CHANGE DOES</p><code>{item.diffHunk}</code><small>{item.action}</small></div></div>}</div>)}</div> : <div className="approved-proof">{hasNoAssessableRules ? <p>No code-enforceable checks compiled and no AI-judgeable rules were found.</p> : aiOnlyCoverage ? <p>No code-enforceable checks compiled. AI judgment assessed {coverage?.completedRules ?? 0} of {coverage?.selectedRules ?? 0} selected rules{coverage?.unassessedRules ? `; ${coverage.unassessedRules} remain unassessed.` : " without a finding."}</p> : <><p>0 active violations against {result.contract.checks.length} compiled checks.</p>{passedChecks.length > 0 && <ul>{passedChecks.map((check) => <li key={check.id}>✓ §{check.specLine} {check.requirementQuote}</li>)}</ul>}</>}</div>}</section>
        <div className="evidence-grid" ref={evidenceGrid}><article className="pane" ref={specPane}><h3>CONTRACT <span>quoted authority</span></h3><pre>{sourceLines(spec).map((line, index) => <div data-line={index + 1} className={findings.some((item) => item.specLine === index + 1 && item.id === selected) ? "highlight contract-line" : ""} key={index}><i>{String(index + 1).padStart(3, "0")}</i>{line}</div>)}</pre></article><div className="connector" aria-hidden="true">{connector && <><span style={{ top: connector.top }}>{connector.label}</span><i style={{ top: connector.top + 20 }} /></>}</div><article className="pane" ref={diffPane}><h3>CHANGED CODE <span>evidence at head</span></h3>{result.snapshot.changedFiles.map((file) => <pre className="diff-file" key={file.path}><b>{file.path}</b>{sourceLines(file.content).map((line, index) => <div data-file={file.path} data-line={index + 1} className={selected && findings.some((item) => item.id === selected && item.filePath === file.path && item.line === index + 1) ? "highlight diff-line" : ""} key={index}><i>{String(index + 1).padStart(3, "0")}</i>{line}</div>)}</pre>)}</article></div>
        <button className="back" onClick={() => { setResult(undefined); setContract(undefined); setSelected(undefined); setAnalysisStages([]); }}>← ANALYZE ANOTHER PR</button>
      </section>}
    </section>
  </main>;
}
