import { z } from "zod";
import { compileContract, validateProviderBatch } from "@/lib/compiler";
import type { CompiledCheck, CompiledContract, ContractRule, Finding, PRSnapshot, ProviderDiagnostic } from "@/lib/contracts";

const MAX_JUDGMENT_RULES = 8;
const MAX_JUDGMENT_CONTEXT = 28_000;
const COMPILE_BATCH_SIZE = 8;
const COMPILE_CONCURRENCY = 4;
const COMPILE_BUDGET_MS = 45_000;
const MIN_BATCH_TIME_MS = 3_000;
const COMPILE_BATCH_TIMEOUT_MS = 8_000;
const NVIDIA_RPM_CEILING = 30;
const NVIDIA_COOLDOWN_MS = 20 * 60_000;
type Provider = "nvidia" | "gemini" | "ollama";
type JudgmentProvider = Provider | "deterministic-only";
type FailureCode = ProviderDiagnostic;
class ProviderFailure extends Error { constructor(readonly code: FailureCode, message: string) { super(message); } }

const assignmentSchema = z.object({ ruleId: z.string(), mode: z.enum(["restricted-import", "restricted-syntax", "path-glob", "dependency", "required-test", "judgment"]), target: z.string().optional(), package: z.string().optional(), path: z.string().optional(), pattern: z.string().optional() });
const compileResponseSchema = z.object({ assignments: z.array(assignmentSchema).max(COMPILE_BATCH_SIZE) });
const findingSchema = z.object({ ruleId: z.string(), filePath: z.string(), line: z.number().int().positive(), violationType: z.string(), action: z.string(), confidence: z.enum(["high", "low"]) });
const responseSchema = z.object({ findings: z.array(findingSchema).max(10) });
const compileJsonSchema = { type: "object", properties: { assignments: { type: "array", maxItems: COMPILE_BATCH_SIZE, items: { type: "object", properties: { ruleId: { type: "string" }, mode: { type: "string", enum: ["restricted-import", "restricted-syntax", "path-glob", "dependency", "required-test", "judgment"] }, target: { type: "string" } }, required: ["ruleId", "mode"] } } }, required: ["assignments"] };
const judgmentJsonSchema = { type: "object", properties: { findings: { type: "array", maxItems: 10, items: { type: "object", properties: { ruleId: { type: "string" }, filePath: { type: "string" }, line: { type: "integer" }, violationType: { type: "string" }, action: { type: "string" }, confidence: { type: "string", enum: ["high", "low"] } }, required: ["ruleId", "filePath", "line", "violationType", "action", "confidence"] } } }, required: ["findings"] };
const judgmentSystem = "Return only JSON matching the supplied schema. Assess only the supplied changed lines. A finding must copy a supplied ruleId, file path, and changed line number exactly. Never report a pre-existing line, invent evidence, or create a finding when the changed code complies.";

let nvidiaRequestTimes: number[] = [];
let nvidiaCooldownUntil = 0;
export function resetProviderStateForTests() { nvidiaRequestTimes = []; nvidiaCooldownUntil = 0; }
export function providerStateForTests() { return { requestsInWindow: nvidiaRequestTimes.length, cooldownUntil: nvidiaCooldownUntil }; }
function now() { return Date.now(); }
function reserveNvidiaRequest() {
  const timestamp = now(); nvidiaRequestTimes = nvidiaRequestTimes.filter((time) => timestamp - time < 60_000);
  if (timestamp < nvidiaCooldownUntil) throw new ProviderFailure("cooldown", "NVIDIA is temporarily cooling down after rate limiting.");
  if (nvidiaRequestTimes.length >= NVIDIA_RPM_CEILING) throw new ProviderFailure("rate_limited", "NVIDIA request safety ceiling reached.");
  nvidiaRequestTimes.push(timestamp);
}
function openNvidiaCooldown() { nvidiaCooldownUntil = now() + NVIDIA_COOLDOWN_MS; }
function failureCode(error: unknown): FailureCode {
  if (error instanceof ProviderFailure) return error.code;
  if (error instanceof Error && /abort|timeout/i.test(error.name + error.message)) return "timeout";
  return "invalid_output";
}
function chunk<T>(values: T[], size: number) { return Array.from({ length: Math.ceil(values.length / size) }, (_, index) => values.slice(index * size, (index + 1) * size)); }
async function pooled<T, R>(values: T[], limit: number, fn: (value: T) => Promise<R>) {
  const results: R[] = Array(values.length); let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, async () => { while (cursor < values.length) { const index = cursor++; results[index] = await fn(values[index]); } }));
  return results;
}

async function nvidia(messages: unknown, timeoutMs: number, maxTokens: number) {
  const key = process.env.NVIDIA_API_KEY; if (!key) throw new ProviderFailure("cooldown", "NVIDIA inference is not configured."); reserveNvidiaRequest();
  let response: Response;
  try { response = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: JSON.stringify({ model: process.env.NVIDIA_MODEL || "google/gemma-4-31b-it", temperature: 0, max_tokens: maxTokens, response_format: { type: "json_object" }, messages }), signal: AbortSignal.timeout(timeoutMs) }); }
  catch (error) { throw new ProviderFailure(failureCode(error), "NVIDIA inference timed out."); }
  if (response.status === 429) { openNvidiaCooldown(); throw new ProviderFailure("rate_limited", "NVIDIA rate limit reached; cooldown opened."); }
  if (response.status === 504) throw new ProviderFailure("gateway_timeout", "NVIDIA gateway timed out.");
  if (!response.ok) throw new ProviderFailure("invalid_output", `NVIDIA inference failed (${response.status}).`);
  try { return JSON.parse((await response.json() as { choices?: { message?: { content?: string } }[] }).choices?.[0]?.message?.content || "{}"); }
  catch { throw new ProviderFailure("invalid_output", "NVIDIA returned invalid JSON."); }
}
async function gemini(prompt: string, schema: unknown, timeoutMs: number, maxTokens: number) {
  const key = process.env.GEMINI_API_KEY; const model = process.env.GEMINI_MODEL; if (!key || !model) throw new ProviderFailure("cooldown", "Gemini fallback is not configured.");
  let response: Response;
  try { response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: prompt }] }], generationConfig: { responseMimeType: "application/json", responseSchema: schema, temperature: 0, maxOutputTokens: maxTokens } }), signal: AbortSignal.timeout(timeoutMs) }); }
  catch (error) { throw new ProviderFailure(failureCode(error), "Gemini inference timed out."); }
  if (!response.ok) throw new ProviderFailure(response.status === 429 ? "rate_limited" : "invalid_output", `Gemini inference failed (${response.status}).`);
  try { return JSON.parse((await response.json() as { candidates?: { content?: { parts?: { text?: string }[] } }[] }).candidates?.[0]?.content?.parts?.[0]?.text || "{}"); }
  catch { throw new ProviderFailure("invalid_output", "Gemini returned invalid JSON."); }
}
async function ollama(messages: unknown, schema: unknown) {
  const base = process.env.OLLAMA_BASE_URL; if (!base || process.env.NODE_ENV === "production") throw new ProviderFailure("cooldown", "Ollama is unavailable.");
  const response = await fetch(`${base.replace(/\/$/, "")}/chat`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model: process.env.OLLAMA_MODEL || "gemma4-12b-lmstudio", stream: false, format: schema, options: { num_predict: 2048 }, messages }), signal: AbortSignal.timeout(90_000) });
  if (!response.ok) throw new ProviderFailure(response.status === 429 ? "rate_limited" : "invalid_output", `Ollama inference failed (${response.status}).`);
  try { return JSON.parse((await response.json() as { message?: { content?: string } }).message?.content || "{}"); }
  catch { throw new ProviderFailure("invalid_output", "Ollama returned invalid JSON."); }
}

function compileMessages(rules: ContractRule[]) {
  const prompt = { rules: rules.map(({ id, requirementQuote, specLine, level }) => ({ id, rule: requirementQuote, specLine, level })) };
  return { messages: [{ role: "system", content: "Return JSON only: {assignments:[{ruleId,mode,target?}]}. Each assignment must reference only a supplied ruleId. Use one allowlisted mode (restricted-import, restricted-syntax, path-glob, dependency, required-test) only when its target is explicit. Otherwise use judgment with no target. Never paraphrase rules or create executable configuration." }, { role: "user", content: JSON.stringify(prompt) }], prompt: JSON.stringify(prompt) };
}
async function compileNvidiaBatch(rules: ContractRule[], startedAt: number): Promise<{ checks: CompiledCheck[]; diagnostics: ProviderDiagnostic[] }> {
  const { messages } = compileMessages(rules); let last: ProviderFailure | undefined; const diagnostics: ProviderDiagnostic[] = [];
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const remaining = COMPILE_BUDGET_MS - (now() - startedAt); if (remaining < MIN_BATCH_TIME_MS) throw new ProviderFailure("timeout", "Compile budget exhausted before batch completion.");
    try { return { checks: validateProviderBatch(compileResponseSchema.parse(await nvidia(messages, Math.min(COMPILE_BATCH_TIMEOUT_MS, remaining), 800)), rules, "nvidia"), diagnostics }; }
    catch (error) { const failure = error instanceof ProviderFailure ? error : new ProviderFailure("invalid_output", "NVIDIA batch validation failed."); last = failure; diagnostics.push(failure.code); if (!(["gateway_timeout", "timeout", "invalid_output"].includes(failure.code)) || attempt === 1) throw failure; }
  }
  throw last || new ProviderFailure("invalid_output", "NVIDIA batch failed.");
}
async function compileGeminiBatch(rules: ContractRule[], startedAt: number) {
  const { prompt } = compileMessages(rules); const remaining = COMPILE_BUDGET_MS - (now() - startedAt); if (remaining < MIN_BATCH_TIME_MS) throw new ProviderFailure("timeout", "Compile budget exhausted before Gemini fallback.");
  return validateProviderBatch(compileResponseSchema.parse(await gemini(prompt, compileJsonSchema, Math.min(20_000, remaining), 800)), rules, "gemini");
}

type BatchResult = { checks: CompiledCheck[]; provider?: "nvidia" | "gemini"; diagnostics: ProviderDiagnostic[] };
async function compileBatch(rules: ContractRule[], startedAt: number): Promise<BatchResult> {
  const diagnostics: ProviderDiagnostic[] = [];
  if (process.env.NVIDIA_API_KEY) try { const result = await compileNvidiaBatch(rules, startedAt); return { checks: result.checks, provider: "nvidia", diagnostics: [...diagnostics, ...result.diagnostics] }; } catch (error) { diagnostics.push(failureCode(error)); }
  if (process.env.GEMINI_API_KEY && process.env.GEMINI_MODEL) try { return { checks: await compileGeminiBatch(rules, startedAt), provider: "gemini", diagnostics }; } catch (error) { diagnostics.push(failureCode(error)); }
  return { checks: [], diagnostics };
}

export async function compileWithProviders(spec: string): Promise<CompiledContract> {
  const baseline = compileContract(spec); const candidates = baseline.unexpressibleRules; if (!candidates.length || (!process.env.NVIDIA_API_KEY && !(process.env.GEMINI_API_KEY && process.env.GEMINI_MODEL))) return baseline;
  const startedAt = now(); const batches = chunk(candidates, COMPILE_BATCH_SIZE); const results = await pooled(batches, COMPILE_CONCURRENCY, (batch) => compileBatch(batch, startedAt));
  const checks = [...baseline.checks]; for (const result of results) for (const check of result.checks) if (!checks.some((existing) => existing.id === check.id) && checks.length < 500) checks.push(check);
  const checked = new Set(checks.map((check) => check.id)); const compiler = results.some((result) => result.provider === "nvidia") ? "nvidia" : results.some((result) => result.provider === "gemini") ? "gemini" : "deterministic-fallback";
  return { ...baseline, checks, unexpressibleRules: baseline.unexpressibleRules.filter((rule) => !checked.has(rule.id)), compiler, compilerDiagnostics: [...new Set(results.flatMap((result) => result.diagnostics))] };
}

function changedLines(snapshot: PRSnapshot, path: string) {
  const lines = snapshot.unifiedDiff.split(/\r?\n/); const header = `+++ b/${path}`; const result = new Set<number>(); let active = false; let newLine = 0;
  for (const line of lines) { if (line.startsWith("+++ b/")) { active = line === header; continue; } if (!active) continue; const range = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/); if (range) { newLine = Number(range[1]); continue; } if (line.startsWith("@@ ") || line.startsWith("diff --git ")) { active = false; continue; } if (line.startsWith("+") && !line.startsWith("+++")) { result.add(newLine); newLine += 1; } else if (!line.startsWith("-")) newLine += 1; }
  return result;
}
function hunk(snapshot: PRSnapshot, filePath: string, line: number) { const fileLines = snapshot.changedFiles.find((file) => file.path === filePath)?.content.split(/\r?\n/) ?? []; if (!changedLines(snapshot, filePath).has(line)) return `Pre-existing: ${filePath}:${line}`; const start = Math.max(1, line - 3); const end = Math.min(fileLines.length, line + 3); return fileLines.slice(start - 1, end).map((text, index) => `${start + index}: ${text}`).join("\n"); }
export function buildJudgmentContext(snapshot: PRSnapshot, rules: ContractRule[]) {
  let remaining = MAX_JUDGMENT_CONTEXT; const changedFiles = snapshot.changedFiles.flatMap((file) => { const source = file.content.split(/\r?\n/); const lineNumbers = [...changedLines(snapshot, file.path)]; if (!lineNumbers.length) return []; const seen = new Set<number>(); const lines: { line: number; text: string }[] = []; for (const changed of lineNumbers) for (let line = Math.max(1, changed - 3); line <= Math.min(source.length, changed + 3); line += 1) { if (seen.has(line)) continue; const item = { line, text: source[line - 1] ?? "" }; const size = JSON.stringify(item).length; if (size > remaining) break; remaining -= size; seen.add(line); lines.push(item); } return lines.length ? [{ path: file.path, lines }] : []; });
  return { rules: rules.slice(0, MAX_JUDGMENT_RULES).map(({ id, requirementQuote, specLine, level }) => ({ id, rule: requirementQuote, specLine, level })), changedFiles };
}
async function withJudgmentProvider<T>(messages: unknown, schema: unknown, prompt: string, parse: (value: unknown) => T): Promise<{ value: T; provider: Provider }> {
  if (process.env.NVIDIA_API_KEY) try { return { value: parse(await nvidia(messages, 45_000, 2048)), provider: "nvidia" }; } catch { /* Try configured Gemini. */ }
  if (process.env.GEMINI_API_KEY && process.env.GEMINI_MODEL) try { return { value: parse(await gemini(prompt, schema, 30_000, 2048)), provider: "gemini" }; } catch { /* Fall through. */ }
  return { value: parse(await ollama(messages, schema)), provider: "ollama" };
}
export async function judgeWithProviders(snapshot: PRSnapshot, contract: CompiledContract): Promise<{ findings: Finding[]; provider: JudgmentProvider }> {
  if (!contract.unexpressibleRules.length) return { findings: [], provider: "deterministic-only" }; const context = buildJudgmentContext(snapshot, contract.unexpressibleRules); if (!context.changedFiles.length) return { findings: [], provider: "deterministic-only" };
  const messages = [{ role: "system", content: judgmentSystem }, { role: "user", content: JSON.stringify(context) }]; const result = await withJudgmentProvider(messages, judgmentJsonSchema, `${judgmentSystem}\n${JSON.stringify(context)}`, (value) => responseSchema.parse(value)); const rules = new Map(contract.unexpressibleRules.map((rule) => [rule.id, rule]));
  const findings = result.value.findings.flatMap((entry, index) => { const file = snapshot.changedFiles.find((candidate) => candidate.path === entry.filePath); const rule = rules.get(entry.ruleId); if (!file || !rule || !changedLines(snapshot, entry.filePath).has(entry.line)) return []; return [{ id: `judgment-${index + 1}`, requirementQuote: rule.requirementQuote, specLine: rule.specLine, filePath: entry.filePath, line: entry.line, diffHunk: hunk(snapshot, entry.filePath, entry.line), violationType: entry.violationType, action: entry.action, source: "llm" as const, confidence: entry.confidence, preExisting: false }]; });
  return { findings, provider: result.provider };
}