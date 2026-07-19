import { z } from "zod";
import { compileContract, validateProviderContract } from "@/lib/compiler";
import type { CompiledContract, Finding, PRSnapshot } from "@/lib/contracts";

const MAX_JUDGMENT_RULES = 8;
const MAX_JUDGMENT_CONTEXT = 28_000;
const findingSchema = z.object({ rule: z.string(), filePath: z.string(), line: z.number().int().positive(), violationType: z.string(), action: z.string(), confidence: z.enum(["high", "low"]) });
const responseSchema = z.object({ findings: z.array(findingSchema).max(10) });
const jsonSchema = { type: "object", properties: { findings: { type: "array", maxItems: 10, items: { type: "object", properties: { rule: { type: "string" }, filePath: { type: "string" }, line: { type: "integer" }, violationType: { type: "string" }, action: { type: "string" }, confidence: { type: "string", enum: ["high", "low"] } }, required: ["rule", "filePath", "line", "violationType", "action", "confidence"] } } }, required: ["findings"] };
type Provider = "nvidia" | "gemini" | "ollama";

const system = "Return only JSON matching the supplied schema. Assess only the supplied changed lines. A finding must copy a supplied rule, file path, and changed line number exactly. Never report a pre-existing line, invent evidence, or create a finding when the changed code complies.";

function changedLines(snapshot: PRSnapshot, path: string) {
  const lines = snapshot.unifiedDiff.split(/\r?\n/); const header = `+++ b/${path}`; const result = new Set<number>();
  let active = false; let newLine = 0;
  for (const line of lines) {
    if (line.startsWith("+++ b/")) { active = line === header; continue; }
    if (!active) continue;
    const range = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (range) { newLine = Number(range[1]); continue; }
    if (line.startsWith("@@ ") || line.startsWith("diff --git ")) { active = false; continue; }
    if (line.startsWith("+") && !line.startsWith("+++")) { result.add(newLine); newLine += 1; }
    else if (!line.startsWith("-")) newLine += 1;
  }
  return result;
}

function hunk(snapshot: PRSnapshot, filePath: string, line: number) {
  const fileLines = snapshot.changedFiles.find((file) => file.path === filePath)?.content.split(/\r?\n/) ?? [];
  const changed = changedLines(snapshot, filePath);
  if (!changed.has(line)) return `Pre-existing: ${filePath}:${line}`;
  const start = Math.max(1, line - 3); const end = Math.min(fileLines.length, line + 3);
  return fileLines.slice(start - 1, end).map((text, index) => `${start + index}: ${text}`).join("\n");
}

export function buildJudgmentContext(snapshot: PRSnapshot, rules: string[]) {
  let remaining = MAX_JUDGMENT_CONTEXT;
  const changedFiles = snapshot.changedFiles.flatMap((file) => {
    const source = file.content.split(/\r?\n/); const lineNumbers = [...changedLines(snapshot, file.path)];
    if (!lineNumbers.length) return [];
    const seen = new Set<number>(); const lines: { line: number; text: string }[] = [];
    for (const changed of lineNumbers) for (let line = Math.max(1, changed - 3); line <= Math.min(source.length, changed + 3); line += 1) {
      if (seen.has(line)) continue;
      const item = { line, text: source[line - 1] ?? "" }; const size = JSON.stringify(item).length;
      if (size > remaining) break;
      remaining -= size; seen.add(line); lines.push(item);
    }
    return lines.length ? [{ path: file.path, lines }] : [];
  });
  return { rules: rules.slice(0, MAX_JUDGMENT_RULES), changedFiles };
}

async function nvidia(messages: unknown, schema: unknown) {
  const key = process.env.NVIDIA_API_KEY; if (!key) throw new Error("NVIDIA inference is not configured.");
  const response = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: JSON.stringify({ model: process.env.NVIDIA_MODEL || "google/gemma-4-31b-it", temperature: 0, max_tokens: 2048, response_format: { type: "json_object" }, messages }), signal: AbortSignal.timeout(45_000) });
  if (!response.ok) throw new Error(`NVIDIA inference failed (${response.status}).`);
  return JSON.parse((await response.json() as { choices?: { message?: { content?: string } }[] }).choices?.[0]?.message?.content || "{}");
}
async function gemini(prompt: string, schema: unknown) {
  const key = process.env.GEMINI_API_KEY; const model = process.env.GEMINI_MODEL; if (!key || !model) throw new Error("Gemini fallback is not configured.");
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: prompt }] }], generationConfig: { responseMimeType: "application/json", responseSchema: schema, temperature: 0, maxOutputTokens: 2048 } }), signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`Gemini inference failed (${response.status}).`);
  return JSON.parse((await response.json() as { candidates?: { content?: { parts?: { text?: string }[] } }[] }).candidates?.[0]?.content?.parts?.[0]?.text || "{}");
}
async function ollama(messages: unknown, schema: unknown) {
  const base = process.env.OLLAMA_BASE_URL; if (!base || process.env.NODE_ENV === "production") throw new Error("Ollama is unavailable.");
  const response = await fetch(`${base.replace(/\/$/, "")}/chat`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model: process.env.OLLAMA_MODEL || "gemma4-12b-lmstudio", stream: false, format: schema, options: { num_predict: 2048 }, messages }), signal: AbortSignal.timeout(90_000) });
  if (!response.ok) throw new Error(`Ollama inference failed (${response.status}).`);
  return JSON.parse((await response.json() as { message?: { content?: string } }).message?.content || "{}");
}
async function request(provider: Provider, messages: unknown, schema: unknown, prompt: string) { return provider === "nvidia" ? nvidia(messages, schema) : provider === "gemini" ? gemini(prompt, schema) : ollama(messages, schema); }
async function withProvider<T>(messages: unknown, schema: unknown, prompt: string, parse: (value: unknown, provider: Provider) => T): Promise<{ value: T; provider: Provider }> {
  const hostedConfigured = Boolean(process.env.NVIDIA_API_KEY || (process.env.GEMINI_API_KEY && process.env.GEMINI_MODEL)); const providers: Provider[] = hostedConfigured ? ["nvidia", "gemini"] : ["ollama"]; let last: unknown;
  for (const provider of providers) try { return { value: parse(await request(provider, messages, schema, prompt), provider), provider }; } catch (error) { last = error; }
  throw last instanceof Error ? last : new Error("No AI provider is available.");
}

function mergeContracts(baseline: CompiledContract, hosted: CompiledContract): CompiledContract {
  const checks = [...baseline.checks];
  for (const check of hosted.checks) if (!checks.some((existing) => existing.requirementQuote === check.requirementQuote && existing.mode === check.mode && existing.target === check.target) && checks.length < 30) checks.push(check);
  const deterministicRules = new Set(checks.map((check) => check.requirementQuote));
  return { checks, unexpressibleRules: [...new Set([...baseline.unexpressibleRules, ...hosted.unexpressibleRules])].filter((rule) => !deterministicRules.has(rule)).slice(0, 30), compiler: hosted.compiler };
}

export async function compileWithProviders(spec: string) {
  const baseline = compileContract(spec); if (!process.env.NVIDIA_API_KEY && !(process.env.GEMINI_API_KEY && process.env.GEMINI_MODEL)) return baseline;
  const messages = [{ role: "system", content: "Return JSON only: {checks:[{mode,rule,package|target|path|pattern}],unexpressibleRules:string[]}. Copy every rule value byte-for-byte from one contract line. Never paraphrase. Allowed modes only: restricted-import, restricted-syntax, path-glob, dependency, required-test, judgment. Put anything not deterministically expressible in unexpressibleRules." }, { role: "user", content: spec }];
  try { const result = await withProvider(messages, { type: "object" }, spec, (value, provider) => validateProviderContract(value, spec, provider)); return mergeContracts(baseline, result.value); } catch { return baseline; }
}

export async function judgeWithProviders(snapshot: PRSnapshot, contract: CompiledContract): Promise<{ findings: Finding[]; provider: Provider }> {
  if (!contract.unexpressibleRules.length) return { findings: [], provider: "ollama" };
  const context = buildJudgmentContext(snapshot, contract.unexpressibleRules); if (!context.changedFiles.length) return { findings: [], provider: "ollama" };
  const messages = [{ role: "system", content: system }, { role: "user", content: JSON.stringify(context) }];
  const result = await withProvider(messages, jsonSchema, `${system}\n${JSON.stringify(context)}`, (value) => responseSchema.parse(value));
  const findings = result.value.findings.flatMap((entry, index) => {
    const file = snapshot.changedFiles.find((candidate) => candidate.path === entry.filePath); const changed = changedLines(snapshot, entry.filePath);
    if (!file || !contract.unexpressibleRules.includes(entry.rule) || !changed.has(entry.line)) return [];
    return [{ id: `judgment-${index + 1}`, requirementQuote: entry.rule, specLine: 1, filePath: entry.filePath, line: entry.line, diffHunk: hunk(snapshot, entry.filePath, entry.line), violationType: entry.violationType, action: entry.action, source: "llm" as const, confidence: entry.confidence, preExisting: false }];
  });
  return { findings, provider: result.provider };
}