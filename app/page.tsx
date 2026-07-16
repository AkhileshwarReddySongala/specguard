"use client";

import { useRef, useState } from "react";
import type { AnalysisResult, CompiledContract, Finding } from "@/lib/contracts";
import { DEMOS, SAMPLE_CONTRACT } from "@/lib/fixtures";

const verdictCopy = {
  merge_blocked: "MERGE BLOCKED",
  changes_required: "CHANGES REQUIRED",
  approved_with_warnings: "APPROVED WITH WARNINGS",
  approved: "APPROVED",
};

function sourceLines(value: string) { return value.split(/\r?\n/); }

export default function Home() {
  const [spec, setSpec] = useState(SAMPLE_CONTRACT);
  const [prUrl, setPrUrl] = useState("demo://blocked");
  const [contract, setContract] = useState<CompiledContract>();
  const [result, setResult] = useState<AnalysisResult>();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState<"compile" | "analyze" | "">("");
  const [selected, setSelected] = useState<string>();
  const specPane = useRef<HTMLDivElement>(null);
  const diffPane = useRef<HTMLDivElement>(null);

  async function compile() {
    setError(""); setResult(undefined); setContract(undefined); setLoading("compile");
    try {
      const response = await fetch("/api/compile", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ specMarkdown: spec }) });
      if (!response.ok || !response.body) throw new Error((await response.json()).error || "Compilation failed.");
      const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = ""; let finalContract: CompiledContract | undefined;
      while (true) {
        const { done, value } = await reader.read(); if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const messages = buffer.split("\n\n"); buffer = messages.pop() || "";
        messages.forEach((message) => { if (message.startsWith("data: ")) { const event = JSON.parse(message.slice(6)); if (event.type === "final") finalContract = event.contract; } });
      }
      if (!finalContract) throw new Error("Compilation stream ended before a final contract was received.");
      setContract(finalContract);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Compilation failed."); }
    finally { setLoading(""); }
  }

  async function analyze() {
    if (!contract) return; setError(""); setLoading("analyze");
    try {
      const response = await fetch("/api/analyze", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prUrl, compiledContract: contract }) });
      const payload = await response.json(); if (!response.ok) throw new Error(payload.error || "Analysis failed.");
      setResult(payload); setSelected(payload.findings[0]?.id);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Analysis failed."); }
    finally { setLoading(""); }
  }

  function selectFinding(item: Finding) {
    setSelected(item.id);
    const specNode = specPane.current?.querySelector(`[data-line='${item.specLine}']`);
    const diffNode = diffPane.current?.querySelector(`[data-file='${item.filePath}']`);
    specNode?.scrollIntoView({ block: "center", behavior: "smooth" });
    diffNode?.scrollIntoView({ block: "center", behavior: "smooth" });
  }

  const deterministicCount = result?.findings.filter((item) => item.source === "deterministic").length ?? 0;
  return <main>
    <header><span className="wordmark">SPEC<span>GUARD</span></span><span className="eyebrow">Contract enforcement for agent-written code</span></header>
    <section className="hero">
      <p className="kicker">GOVERNANCE, NOT REVIEW</p>
      <h1>Prove AI-written code matches what humans authorized.</h1>
      <p>Compile a development contract, analyze a public pull request, and follow every finding from requirement to changed code.</p>
    </section>
    <section className="workspace">
      {!result && <div className="input-grid">
        <div><label htmlFor="contract">CONTRACT</label><textarea id="contract" value={spec} onChange={(event) => setSpec(event.target.value)} /></div>
        <div className="controls"><label>TRY A LIVE-SHAPED DEMO</label><div className="demo-row">{DEMOS.map((demo) => <button className={prUrl === demo.id ? "demo active" : "demo"} key={demo.id} onClick={() => setPrUrl(demo.id)}>{demo.label}</button>)}</div>
          <label htmlFor="pr">PUBLIC GITHUB PR URL</label><input id="pr" value={prUrl} onChange={(event) => setPrUrl(event.target.value)} placeholder="https://github.com/owner/repo/pull/42" />
          <button className="primary" onClick={contract ? analyze : compile} disabled={Boolean(loading)}>{loading === "compile" ? "COMPILING CONTRACT…" : loading === "analyze" ? "ANALYZING DIFF…" : contract ? "ANALYZE PULL REQUEST" : "COMPILE CONTRACT"}</button>
          {contract && <p className="stage">✓ Contract compiled: {contract.checks.length} enforceable checks. {contract.unexpressibleRules.length ? `${contract.unexpressibleRules.length} judgment rule(s) labeled separately.` : ""}</p>}
        </div>
      </div>}
      {error && <div className="error" role="alert">{error}</div>}
      {result && <section className={`results ${result.verdict}`}>
        <div className="verdict"><div><p className="kicker">PULL REQUEST VERDICT</p><h2>{verdictCopy[result.verdict]}</h2><p>{result.verdict === "merge_blocked" ? "The code may pass review. It was not authorized." : "Evidence is attached to every decision."}</p></div><div className="score"><span>COMPLIANCE</span><strong>{result.complianceScore}</strong><small>/100</small></div><div className="tally">{deterministicCount} engine-verified<br />{result.findings.length - deterministicCount} AI judgment</div></div>
        {result.diagnostics.map((message) => <p className="notice" key={message}>{message}</p>)}
        <div className="findings" role="listbox" aria-label="Findings">{result.findings.length ? result.findings.map((item) => <button key={item.id} role="option" aria-selected={selected === item.id} className={selected === item.id ? "finding selected" : "finding"} onClick={() => selectFinding(item)} onKeyDown={(event) => { if (event.key === "Enter") selectFinding(item); }}><span className={item.source === "deterministic" ? "badge solid" : "badge dashed"}>{item.source === "deterministic" ? "ENGINE" : "JUDGMENT"}</span><span>{item.violationType}</span><code>§{item.specLine} → {item.filePath}:{item.line}</code></button>) : <p className="clean">0 violations against {result.contract.checks.length} compiled checks.</p>}</div>
        <div className="panes"><article ref={specPane}><h3>CONTRACT <span>quoted authority</span></h3><pre>{sourceLines(spec).map((line, index) => <div data-line={index + 1} className={result.findings.some((item) => item.specLine === index + 1 && item.id === selected) ? "highlight" : ""} key={index}><i>{String(index + 1).padStart(2, "0")}</i>{line}</div>)}</pre></article>
          <article ref={diffPane}><h3>CHANGED CODE <span>evidence</span></h3>{result.snapshot.changedFiles.map((file) => <pre data-file={file.path} className={result.findings.some((item) => item.filePath === file.path && item.id === selected) ? "highlight block" : "block"} key={file.path}><b>{file.path}</b>{sourceLines(file.content).map((line, index) => <div key={index}><i>+{index + 1}</i>{line}</div>)}</pre>)}</article></div>
        <button className="back" onClick={() => { setResult(undefined); setContract(undefined); }}>← ANALYZE ANOTHER PR</button>
      </section>}
    </section>
  </main>;
}
