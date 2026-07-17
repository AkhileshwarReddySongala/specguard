import { compiledContractSchema, type CompiledCheck, type CompiledContract } from "@/lib/contracts";

const mustWords = /\b(must|never|prohibited|do not|don't|only)\b/i;
function levelFor(line: string): "MUST" | "SHOULD" { return mustWords.test(line) ? "MUST" : "SHOULD"; }
function targetAfter(line: string, expression: RegExp): string | undefined { return line.match(expression)?.[1]?.replace(/[`.]/g, "").trim(); }

export function compileContract(specMarkdown: string): CompiledContract {
  if (!specMarkdown.trim()) throw new Error("A contract is required.");
  if (specMarkdown.length > 30_000) throw new Error("Contract exceeds the 30,000-character limit.");
  const checks: CompiledCheck[] = []; const unexpressibleRules: string[] = [];
  specMarkdown.split(/\r?\n/).forEach((raw, index) => {
    const quote = raw.replace(/^\s*[-*\d.)]+\s*/, "").trim(); if (!quote || quote.startsWith("#")) return;
    const base = { id: `rule-${index + 1}`, requirementQuote: quote, specLine: index + 1, level: levelFor(quote), rationale: "Deterministically compiled from contract text." } as const;
    const packageName = targetAfter(quote, /(?:add|import|use)\s+[`'"]?([@\w./-]+)/i); const path = targetAfter(quote, /(?:change|touch|modify)\s+[`'"]?([\w./*-]+)/i);
    if (/dependency|package|import/i.test(quote) && packageName) { if (checks.length < 30) checks.push({ ...base, mode: /import/i.test(quote) ? "restricted-import" : "dependency", target: packageName }); }
    else if (/(do not|never|prohibited).*(\.github|workflow|migration|path|folder|directory)/i.test(quote) && path) { if (checks.length < 30) checks.push({ ...base, mode: "path-glob", target: path }); }
    else if (/test/i.test(quote) && /(require|must|every|add)/i.test(quote)) { if (checks.length < 30) checks.push({ ...base, mode: "required-test", target: "test" }); }
    else if (/eval\(|dangerouslySetInnerHTML|new Function/i.test(quote)) { if (checks.length < 30) checks.push({ ...base, mode: "restricted-syntax", target: quote.match(/eval\(|dangerouslySetInnerHTML|new Function/i)?.[0] || "restricted-syntax" }); }
    else if (quote.length > 3 && unexpressibleRules.length < 30) unexpressibleRules.push(quote);
  });
  return compiledContractSchema.parse({ checks, unexpressibleRules, compiler: "deterministic-fallback" });
}

export function validateProviderContract(value: unknown, specMarkdown: string, compiler: "nvidia" | "gemini" | "ollama"): CompiledContract {
  const raw = value as { checks?: Record<string, unknown>[]; unexpressibleRules?: unknown[] };
  const lines = specMarkdown.split(/\r?\n/); const allowed = new Set(["restricted-import", "restricted-syntax", "path-glob", "dependency", "required-test", "judgment"]);
  const checks: CompiledCheck[] = []; const unexpressibleRules: string[] = [];
  for (const entry of Array.isArray(raw.checks) ? raw.checks : []) {
    const requirementQuote = typeof entry.requirementQuote === "string" ? entry.requirementQuote : typeof entry.rule === "string" ? entry.rule : "";
    const specLine = lines.findIndex((line) => line.includes(requirementQuote)) + 1; const rawMode = typeof entry.mode === "string" ? entry.mode : "judgment";
    if (!requirementQuote || !specLine) continue;
    if (!allowed.has(rawMode) || rawMode === "judgment") { if (unexpressibleRules.length < 30) unexpressibleRules.push(requirementQuote); continue; }
    const target = [entry.target, entry.package, entry.path, entry.pattern].find((candidate) => typeof candidate === "string") as string | undefined;
    if (!target || checks.length >= 30) continue;
    checks.push({ id: `rule-${specLine}`, requirementQuote, specLine, level: typeof entry.level === "string" && entry.level === "SHOULD" ? "SHOULD" : levelFor(requirementQuote), mode: rawMode as CompiledCheck["mode"], target, rationale: typeof entry.rationale === "string" ? entry.rationale : "Compiled by hosted provider and grounded to contract text." });
  }
  for (const entry of Array.isArray(raw.unexpressibleRules) ? raw.unexpressibleRules : []) { const rule = typeof entry === "string" ? entry : typeof entry === "object" && entry && typeof (entry as Record<string, unknown>).rule === "string" ? (entry as Record<string, string>).rule : ""; if (rule && lines.some((line) => line.includes(rule)) && unexpressibleRules.length < 30) unexpressibleRules.push(rule); }
  return compiledContractSchema.parse({ checks, unexpressibleRules: [...new Set(unexpressibleRules)], compiler });
}