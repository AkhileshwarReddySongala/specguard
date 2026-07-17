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
    if (/dependency|package|import/i.test(quote) && packageName) checks.push({ ...base, mode: /import/i.test(quote) ? "restricted-import" : "dependency", target: packageName });
    else if (/(do not|never|prohibited).*(\.github|workflow|migration|path|folder|directory)/i.test(quote) && path) checks.push({ ...base, mode: "path-glob", target: path });
    else if (/test/i.test(quote) && /(require|must|every|add)/i.test(quote)) checks.push({ ...base, mode: "required-test", target: "test" });
    else if (/eval\(|dangerouslySetInnerHTML|new Function/i.test(quote)) checks.push({ ...base, mode: "restricted-syntax", target: quote.match(/eval\(|dangerouslySetInnerHTML|new Function/)![0] });
    else if (quote.length > 3) unexpressibleRules.push(quote);
  });
  return compiledContractSchema.parse({ checks, unexpressibleRules, compiler: "deterministic-fallback" });
}

export function validateProviderContract(value: unknown, specMarkdown: string, compiler: "nvidia" | "gemini" | "ollama"): CompiledContract {
  const parsed = compiledContractSchema.parse(value); const lines = specMarkdown.split(/\r?\n/);
  const checks = parsed.checks.filter((check) => check.mode !== "judgment" && lines[check.specLine - 1]?.includes(check.requirementQuote));
  const rules = [...new Set([...parsed.unexpressibleRules, ...parsed.checks.filter((check) => check.mode === "judgment").map((check) => check.requirementQuote)])];
  return compiledContractSchema.parse({ checks, unexpressibleRules: rules, compiler });
}