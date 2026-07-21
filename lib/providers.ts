import { z } from "zod";
import { compileContract } from "@/lib/compiler";
import type { CompiledContract, ContractRule, Finding, JudgmentCoverage, JudgmentMode, PRSnapshot, ProviderDiagnostic, ProviderStatus } from "@/lib/contracts";

export const AI_BATCH_SIZE = 8;
export const AI_CONCURRENCY = 4;
export const NVIDIA_RPM_CEILING = 30;
export const NVIDIA_START_SPACING_MS = 2_000;
export const LONG_RUN_BUDGET_MS = 300_000;
const NVIDIA_COOLDOWN_MS = 20 * 60_000;
const MAX_JUDGMENT_CONTEXT = 28_000;

type Provider = "nvidia" | "gemini" | "ollama";
type FailureCode = ProviderDiagnostic;
type Progress = { phase: "compile" | "judgment"; completedRules: number; totalRules: number; completedBatches: number; totalBatches: number; provider?: Provider; status?: "running" | "retrying" | "waiting" | "fallback" | "partial" };
type RunOptions = { signal?: AbortSignal; onProgress?: (progress: Progress) => void; deadlineAt?: number; skipNvidia?: boolean };
type JudgmentBatchResult = { findings: Finding[]; providers: Provider[]; diagnostics: ProviderDiagnostic[]; unassessedRules: number };

class ProviderFailure extends Error {
  constructor(readonly code: FailureCode, message: string, readonly diagnostics: ProviderDiagnostic[] = []) { super(message); }
}

const repeatedNarrative = (value: string) => {
  const words = value.toLowerCase().match(/[\p{L}\p{N}]+(?:[-'][\p{L}\p{N}]+)*/gu) ?? [];
  if (words.length < 4) return false;
  const frequencies = new Map<string, number>();
  for (const word of words) frequencies.set(word, (frequencies.get(word) ?? 0) + 1);
  return words.every((word) => word === words[0]) || [...frequencies.values()].some((count) => count >= 4 && count / words.length >= 0.45);
};
const modelNarrative = (max: number) => z.string().trim().min(3).max(max).refine((value) => !/[\r\n]/.test(value), "Model evidence text must be one line.").refine((value) => !repeatedNarrative(value), "Model evidence text repeats itself.");
const findingSchema = z.object({ ruleId: z.string(), filePath: z.string(), line: z.number().int().positive(), violationType: modelNarrative(180), action: modelNarrative(300), confidence: z.enum(["high", "low"]) });
const responseSchema = z.object({ findings: z.array(findingSchema).max(10) });
const judgmentJsonSchema = { type: "object", properties: { findings: { type: "array", maxItems: 10, items: { type: "object", properties: { ruleId: { type: "string" }, filePath: { type: "string" }, line: { type: "integer" }, violationType: { type: "string" }, action: { type: "string" }, confidence: { type: "string", enum: ["high", "low"] } }, required: ["ruleId", "filePath", "line", "violationType", "action", "confidence"] } } }, required: ["findings"] };
const judgmentSystem = "Return only JSON matching the supplied schema. Assess only the supplied changed lines. A finding must copy a supplied ruleId, file path, and changed line number exactly. Never report a pre-existing line, invent evidence, or create a finding when the changed code complies.";

let nvidiaRequestTimes: number[] = [];
let nvidiaCooldownUntil = 0;
let nextNvidiaStartAt = 0;
let reservationTail: Promise<void> = Promise.resolve();
let testNow: (() => number) | undefined;
let testSleep: ((ms: number) => Promise<void>) | undefined;

export function resetProviderStateForTests() { nvidiaRequestTimes = []; nvidiaCooldownUntil = 0; nextNvidiaStartAt = 0; reservationTail = Promise.resolve(); testNow = undefined; testSleep = undefined; }
export function setProviderSchedulerForTests(clock: () => number, sleeper: (ms: number) => Promise<void>) { testNow = clock; testSleep = sleeper; }
export function providerStateForTests() { return { requestsInWindow: nvidiaRequestTimes.length, cooldownUntil: nvidiaCooldownUntil, nextNvidiaStartAt }; }
function now() { return testNow ? testNow() : Date.now(); }
function chunk<T>(values: T[], size: number) { return Array.from({ length: Math.ceil(values.length / size) }, (_, index) => values.slice(index * size, (index + 1) * size)); }
function deadlineFor(options?: RunOptions) { return options?.deadlineAt ?? now() + LONG_RUN_BUDGET_MS; }
function abortIfNeeded(signal?: AbortSignal) { if (signal?.aborted) throw new ProviderFailure("cancelled", "The browser session cancelled this run."); }
async function sleep(ms: number, signal?: AbortSignal) {
  abortIfNeeded(signal);
  if (testSleep) return testSleep(ms);
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(done, ms);
    const onAbort = () => { clearTimeout(timer); reject(new ProviderFailure("cancelled", "The browser session cancelled this run.")); };
    function done() { signal?.removeEventListener("abort", onAbort); resolve(); }
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
async function reserveNvidiaRequest(deadlineAt: number, signal?: AbortSignal) {
  let release!: () => void;
  const previous = reservationTail;
  reservationTail = new Promise<void>((resolve) => { release = resolve; });
  await previous;
  try {
    while (true) {
      abortIfNeeded(signal);
      const timestamp = now();
      nvidiaRequestTimes = nvidiaRequestTimes.filter((time) => timestamp - time < 60_000);
      if (timestamp < nvidiaCooldownUntil) throw new ProviderFailure("cooldown", "NVIDIA is temporarily cooling down after rate limiting.");
      const rpmDelay = nvidiaRequestTimes.length >= NVIDIA_RPM_CEILING ? nvidiaRequestTimes[0] + 60_000 - timestamp : 0;
      const spacingDelay = Math.max(0, nextNvidiaStartAt - timestamp);
      const waitFor = Math.max(rpmDelay, spacingDelay);
      if (timestamp + waitFor >= deadlineAt) throw new ProviderFailure("timeout", "Five-minute AI run budget exhausted.");
      if (waitFor > 0) await sleep(waitFor, signal);
      else {
        const started = now();
        nvidiaRequestTimes = nvidiaRequestTimes.filter((time) => started - time < 60_000);
        nvidiaRequestTimes.push(started);
        nextNvidiaStartAt = started + NVIDIA_START_SPACING_MS;
        return;
      }
    }
  } finally { release(); }
}
function openNvidiaCooldown() { nvidiaCooldownUntil = now() + NVIDIA_COOLDOWN_MS; }
function failureCode(error: unknown): FailureCode {
  if (error instanceof ProviderFailure) return error.code;
  if (error instanceof Error && /abort|timeout/i.test(error.name + error.message)) return "timeout";
  return "invalid_output";
}
async function timedFetch(url: string, init: RequestInit, timeoutMs: number, signal?: AbortSignal) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true });
  try { return await fetch(url, { ...init, signal: controller.signal }); }
  catch (error) { if (signal?.aborted) throw new ProviderFailure("cancelled", "The browser session cancelled this run."); throw error; }
  finally { clearTimeout(timer); signal?.removeEventListener("abort", abort); }
}
async function pooled<T, R>(values: T[], limit: number, fn: (value: T, index: number) => Promise<R>) {
  const results: R[] = Array(values.length); let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, async () => { while (cursor < values.length) { const index = cursor++; results[index] = await fn(values[index], index); } }));
  return results;
}

async function nvidia(messages: unknown, options: RunOptions, maxTokens: number) {
  const key = process.env.NVIDIA_API_KEY;
  if (!key) throw new ProviderFailure("cooldown", "NVIDIA inference is not configured.");
  const deadlineAt = deadlineFor(options);
  await reserveNvidiaRequest(deadlineAt, options.signal);
  let response: Response;
  try {
    response = await timedFetch("https://integrate.api.nvidia.com/v1/chat/completions", { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: JSON.stringify({ model: process.env.NVIDIA_MODEL || "google/gemma-4-31b-it", temperature: 0, max_tokens: maxTokens, response_format: { type: "json_object" }, messages }) }, Math.min(45_000, Math.max(1_000, deadlineAt - now())), options.signal);
  } catch (error) { if (error instanceof ProviderFailure) throw error; throw new ProviderFailure(failureCode(error), "NVIDIA inference timed out."); }
  if (response.status === 429) { openNvidiaCooldown(); throw new ProviderFailure("rate_limited", "NVIDIA rate limit reached; cooldown opened."); }
  if (response.status === 504) throw new ProviderFailure("gateway_timeout", "NVIDIA gateway timed out.");
  if (!response.ok) throw new ProviderFailure("invalid_output", `NVIDIA inference failed (${response.status}).`);
  try { return JSON.parse((await response.json() as { choices?: { message?: { content?: string } }[] }).choices?.[0]?.message?.content || "{}"); }
  catch { throw new ProviderFailure("invalid_output", "NVIDIA returned invalid JSON."); }
}
async function gemini(prompt: string, schema: unknown, options: RunOptions, maxTokens: number) {
  const key = process.env.GEMINI_API_KEY; const model = process.env.GEMINI_MODEL;
  if (!key || !model) throw new ProviderFailure("cooldown", "Gemini fallback is not configured.");
  const deadlineAt = deadlineFor(options);
  const models = [...new Set([model, process.env.GEMINI_FALLBACK_MODEL || "gemma-4-26b-a4b-it"])];
  let rateLimit: ProviderFailure | undefined;
  for (const candidate of models) {
    let response: Response;
    try { response = await timedFetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(candidate)}:generateContent?key=${encodeURIComponent(key)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: prompt }] }], generationConfig: { responseMimeType: "application/json", responseSchema: schema, temperature: 0, maxOutputTokens: maxTokens } }) }, Math.min(30_000, Math.max(1_000, deadlineAt - now())), options.signal); }
    catch (error) { if (error instanceof ProviderFailure) throw error; throw new ProviderFailure(failureCode(error), "Gemini inference timed out."); }
    if (response.status === 429) { rateLimit = new ProviderFailure("rate_limited", "Gemini model rate limit reached."); continue; }
    if (!response.ok) throw new ProviderFailure("invalid_output", `Gemini inference failed (${response.status}).`);
    try { return JSON.parse((await response.json() as { candidates?: { content?: { parts?: { text?: string }[] } }[] }).candidates?.[0]?.content?.parts?.[0]?.text || "{}"); }
    catch { throw new ProviderFailure("invalid_output", "Gemini returned invalid JSON."); }
  }
  throw rateLimit ?? new ProviderFailure("rate_limited", "Gemini model rate limit reached.");
}
async function ollama(messages: unknown, schema: unknown, options: RunOptions) {
  const base = process.env.OLLAMA_BASE_URL;
  if (!base || process.env.NODE_ENV === "production") throw new ProviderFailure("cooldown", "Ollama is unavailable.");
  let response: Response;
  try { response = await timedFetch(`${base.replace(/\/$/, "")}/chat`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model: process.env.OLLAMA_MODEL || "gemma4-12b-lmstudio", stream: false, format: schema, options: { num_predict: 2048 }, messages }) }, Math.min(90_000, Math.max(1_000, deadlineFor(options) - now())), options.signal); }
  catch (error) { if (error instanceof ProviderFailure) throw error; throw new ProviderFailure(failureCode(error), "Ollama inference timed out."); }
  if (!response.ok) throw new ProviderFailure(response.status === 429 ? "rate_limited" : "invalid_output", `Ollama inference failed (${response.status}).`);
  try { return JSON.parse((await response.json() as { message?: { content?: string } }).message?.content || "{}"); }
  catch { throw new ProviderFailure("invalid_output", "Ollama returned invalid JSON."); }
}

/** Providers never compile enforcement configuration. They only judge changed hunks. */
export async function compileWithProviders(spec: string, options: RunOptions = {}): Promise<CompiledContract> {
  const contract = compileContract(spec);
  options.onProgress?.({ phase: "compile", completedRules: contract.sourceRules.length, totalRules: contract.sourceRules.length, completedBatches: 0, totalBatches: 0, status: "running" });
  return contract;
}

function changedLines(snapshot: PRSnapshot, path: string) {
  const lines = snapshot.unifiedDiff.split(/\r?\n/); const header = `+++ b/${path}`; const result = new Set<number>(); const hasFileHeaders = lines.some((line) => line.startsWith("+++ b/")); let active = !hasFileHeaders; let newLine = 0;
  for (const line of lines) { if (line.startsWith("+++ b/")) { active = line === header; continue; } if (!active) continue; const range = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/); if (range) { newLine = Number(range[1]); continue; } if (line.startsWith("@@ ") || line.startsWith("diff --git ")) { active = false; continue; } if (line.startsWith("+") && !line.startsWith("+++")) { result.add(newLine); newLine += 1; } else if (!line.startsWith("-")) newLine += 1; }
  return result;
}
function hunk(snapshot: PRSnapshot, filePath: string, line: number) { const fileLines = snapshot.changedFiles.find((file) => file.path === filePath)?.content.split(/\r?\n/) ?? []; if (!changedLines(snapshot, filePath).has(line)) return `Pre-existing: ${filePath}:${line}`; const start = Math.max(1, line - 3); const end = Math.min(fileLines.length, line + 3); return fileLines.slice(start - 1, end).map((text, index) => `${start + index}: ${text}`).join("\n"); }

export function selectRelevantRules(snapshot: PRSnapshot, rules: ContractRule[], mode: JudgmentMode) {
  if (mode === "all") return { selected: rules, excluded: [] as ContractRule[] };
  const paths = snapshot.changedFiles.map((file) => file.path.toLowerCase());
  const selected: ContractRule[] = []; const excluded: ContractRule[] = [];
  for (const rule of rules) {
    const pathScopes = rule.requirementQuote.match(/(?:[\w.-]+\/)+[\w.*-]+/g)?.map((value) => value.toLowerCase()) ?? [];
    const extensions = rule.requirementQuote.match(/\.(?:[a-z]{1,5})\b/gi)?.map((value) => value.toLowerCase()) ?? [];
    const pathMatches = pathScopes.some((scope) => paths.some((path) => path.includes(scope.replace(/\*/g, ""))));
    const extensionMatches = extensions.some((extension) => paths.some((path) => path.endsWith(extension)));
    if ((pathScopes.length || extensions.length) && !pathMatches && !extensionMatches) excluded.push(rule); else selected.push(rule);
  }
  return { selected, excluded };
}
export function buildJudgmentContext(snapshot: PRSnapshot, rules: ContractRule[]) {
  let remaining = MAX_JUDGMENT_CONTEXT;
  const changedFiles = snapshot.changedFiles.flatMap((file) => {
    const source = file.content.split(/\r?\n/); const lineNumbers = [...changedLines(snapshot, file.path)]; if (!lineNumbers.length) return [];
    const seen = new Set<number>(); const lines: { line: number; text: string }[] = [];
    for (const changed of lineNumbers) for (let line = Math.max(1, changed - 3); line <= Math.min(source.length, changed + 3); line += 1) { if (seen.has(line)) continue; const item = { line, text: source[line - 1] ?? "" }; const size = JSON.stringify(item).length; if (size > remaining) break; remaining -= size; seen.add(line); lines.push(item); }
    return lines.length ? [{ path: file.path, lines }] : [];
  });
  return { rules: rules.map(({ id, requirementQuote, specLine, level }) => ({ id, rule: requirementQuote, specLine, level })), changedFiles };
}
async function withJudgmentProvider<T>(messages: unknown, schema: unknown, prompt: string, parse: (value: unknown) => T, options: RunOptions, allowFallback = true): Promise<{ value: T; provider: Provider; diagnostics: ProviderDiagnostic[] }> {
  const diagnostics: ProviderDiagnostic[] = [];
  if (process.env.NVIDIA_API_KEY && !options.skipNvidia) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try { return { value: parse(await nvidia(messages, options, 2048)), provider: "nvidia", diagnostics }; }
      catch (error) {
        const code = failureCode(error); diagnostics.push(code);
        if (code === "cancelled") throw error;
        if (!["gateway_timeout", "timeout", "invalid_output"].includes(code) || attempt === 1) break;
      }
    }
    if (!allowFallback) throw new ProviderFailure(diagnostics.at(-1) ?? "invalid_output", "NVIDIA judgment batch needs recovery.", diagnostics);
  }
  if (!allowFallback) throw new ProviderFailure("cooldown", "No NVIDIA judgment provider is configured.", diagnostics);
  if (process.env.GEMINI_API_KEY && process.env.GEMINI_MODEL) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try { return { value: parse(await gemini(prompt, schema, options, 2048)), provider: "gemini", diagnostics }; }
      catch (error) {
        const code = failureCode(error); diagnostics.push(code);
        if (code === "cancelled") throw error;
        if (!["gateway_timeout", "timeout", "invalid_output"].includes(code) || attempt === 1) break;
      }
    }
  }
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try { return { value: parse(await ollama(messages, schema, options)), provider: "ollama", diagnostics }; }
    catch (error) {
      const code = failureCode(error); diagnostics.push(code);
      if (code === "cancelled") throw error;
      if (!["gateway_timeout", "timeout", "invalid_output"].includes(code) || attempt === 1) throw new ProviderFailure(code, "No AI judgment provider completed this batch.", diagnostics);
    }
  }
  throw new ProviderFailure("invalid_output", "No AI judgment provider completed this batch.", diagnostics);
}
async function judgeBatch(snapshot: PRSnapshot, rules: ContractRule[], batchIndex: number, options: RunOptions, allowFallback = true): Promise<JudgmentBatchResult> {
  const context = buildJudgmentContext(snapshot, rules);
  if (!context.changedFiles.length) return { findings: [], providers: [], diagnostics: [], unassessedRules: 0 };
  const messages = [{ role: "system", content: judgmentSystem }, { role: "user", content: JSON.stringify(context) }];
  try {
    const result = await withJudgmentProvider(messages, judgmentJsonSchema, `${judgmentSystem}\n${JSON.stringify(context)}`, (value) => responseSchema.parse(value), options, allowFallback);
    const ruleMap = new Map(rules.map((rule) => [rule.id, rule]));
    const findings = result.value.findings.flatMap((entry, index) => {
      const file = snapshot.changedFiles.find((candidate) => candidate.path === entry.filePath); const rule = ruleMap.get(entry.ruleId);
      if (!file || !rule || !changedLines(snapshot, entry.filePath).has(entry.line)) return [];
      return [{ id: `judgment-${batchIndex + 1}-${index + 1}`, requirementQuote: rule.requirementQuote, specLine: rule.specLine, filePath: entry.filePath, line: entry.line, diffHunk: hunk(snapshot, entry.filePath, entry.line), violationType: entry.violationType, action: entry.action, source: "llm" as const, confidence: entry.confidence, preExisting: false }];
    });
    return { findings, providers: [result.provider], diagnostics: result.diagnostics, unassessedRules: 0 };
  } catch (error) {
    const code = failureCode(error); if (code === "cancelled") throw error;
    const diagnostics = error instanceof ProviderFailure && error.diagnostics.length ? error.diagnostics : [code];
    return { findings: [], providers: [], diagnostics, unassessedRules: rules.length };
  }
}
function mergeBatchResults(results: JudgmentBatchResult[], diagnostics: ProviderDiagnostic[] = []): JudgmentBatchResult {
  return { findings: results.flatMap((result) => result.findings), providers: [...new Set(results.flatMap((result) => result.providers))], diagnostics: [...new Set([...diagnostics, ...results.flatMap((result) => result.diagnostics)])], unassessedRules: results.reduce((total, result) => total + result.unassessedRules, 0) };
}
async function recoverJudgmentBatch(snapshot: PRSnapshot, batch: ContractRule[], batchIndex: number, options: RunOptions, completedRules: number, totalRules: number, completedBatches: number, totalBatches: number): Promise<JudgmentBatchResult> {
  if (!process.env.NVIDIA_API_KEY) return judgeBatch(snapshot, batch, batchIndex, options);
  const initial = await judgeBatch(snapshot, batch, batchIndex, options, false);
  if (!initial.unassessedRules) return initial;
  const recoverable = initial.diagnostics.some((code) => ["gateway_timeout", "timeout", "invalid_output"].includes(code));
  if (!recoverable || batch.length === 1) {
    const fallback = await judgeBatch(snapshot, batch, batchIndex, { ...options, skipNvidia: true });
    return mergeBatchResults([fallback], initial.diagnostics);
  }
  // Give the hosted fallback its full remaining budget before multiplying failed
  // NVIDIA work through split retries. Otherwise a pair of 45-second NVIDIA
  // attempts can leave Gemini only milliseconds to respond.
  options.onProgress?.({ phase: "judgment", completedRules, totalRules, completedBatches, totalBatches, status: "fallback" });
  const fallback = await judgeBatch(snapshot, batch, batchIndex, { ...options, skipNvidia: true });
  if (!fallback.unassessedRules) return mergeBatchResults([fallback], initial.diagnostics);
  options.onProgress?.({ phase: "judgment", completedRules, totalRules, completedBatches, totalBatches, status: "retrying" });
  const smallerBatches = chunk(batch, Math.ceil(batch.length / 2));
  const recovered: JudgmentBatchResult[] = [];
  for (const [index, smaller] of smallerBatches.entries()) {
    const retried = await judgeBatch(snapshot, smaller, batchIndex * 10 + index, options, false);
    if (!retried.unassessedRules) recovered.push(retried);
    else recovered.push(await mergeBatchResults([await judgeBatch(snapshot, smaller, batchIndex * 10 + index, { ...options, skipNvidia: true })], retried.diagnostics));
  }
  return mergeBatchResults(recovered, initial.diagnostics);
}
function providerStatus(providers: Provider[]): ProviderStatus { const unique = [...new Set(providers)]; return unique.length === 0 ? "deterministic-only" : unique.length === 1 ? unique[0] : "mixed"; }
export async function judgeWithProviders(snapshot: PRSnapshot, contract: CompiledContract, mode: JudgmentMode = "relevant", options: RunOptions = {}): Promise<{ findings: Finding[]; provider: ProviderStatus; coverage: JudgmentCoverage; diagnostics: string[] }> {
  const relevant = selectRelevantRules(snapshot, contract.unexpressibleRules, mode); const selected = relevant.selected; const batches = chunk(selected, AI_BATCH_SIZE); const deadlineAt = deadlineFor(options);
  if (!selected.length) return { findings: [], provider: "deterministic-only", diagnostics: [], coverage: { mode, totalRules: contract.unexpressibleRules.length, scopeExcludedRules: relevant.excluded.length, selectedRules: 0, completedRules: 0, unassessedRules: 0, complete: true, providersUsed: ["deterministic-only"] } };
  let completedRules = 0; let completedBatches = 0;
  const results = await pooled(batches, AI_CONCURRENCY, async (batch, index) => {
    const result = await recoverJudgmentBatch(snapshot, batch, index, { ...options, deadlineAt }, completedRules, selected.length, completedBatches, batches.length);
    completedRules += batch.length - result.unassessedRules; completedBatches += 1;
    options.onProgress?.({ phase: "judgment", completedRules, totalRules: selected.length, completedBatches, totalBatches: batches.length, provider: result.providers.at(-1), status: result.unassessedRules ? "partial" : result.diagnostics.length ? "fallback" : "running" });
    return result;
  });
  const providers = results.flatMap((result) => result.providers);
  const unassessedRules = results.reduce((total, result) => total + result.unassessedRules, 0);
  return { findings: results.flatMap((result) => result.findings), provider: providerStatus(providers), diagnostics: [...new Set(results.flatMap((result) => result.diagnostics))], coverage: { mode, totalRules: contract.unexpressibleRules.length, scopeExcludedRules: relevant.excluded.length, selectedRules: selected.length, completedRules: selected.length - unassessedRules, unassessedRules, complete: unassessedRules === 0, providersUsed: providers.length ? [...new Set(providers)] : ["deterministic-only"] } };
}
