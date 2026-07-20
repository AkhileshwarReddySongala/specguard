import { compiledContractSchema, MAX_CONTRACT_CHARS, type CompiledCheck, type CompiledContract, type ContractRule } from "@/lib/contracts";

const MAX_RULES = 500;
const mustWords = /\b(must|never|prohibited|do not|don't|only)\b/i;
const allowed = new Set(["restricted-import", "restricted-syntax", "path-glob", "dependency", "required-test", "judgment"]);
function levelFor(line: string): "MUST" | "SHOULD" { return mustWords.test(line) ? "MUST" : "SHOULD"; }
function targetAfter(line: string, expression: RegExp): string | undefined { return line.match(expression)?.[1]?.replace(/[`.]/g, "").trim(); }

export function normalizeContractRules(specMarkdown: string): ContractRule[] {
  if (!specMarkdown.trim()) throw new Error("A contract is required.");
  if (specMarkdown.length > MAX_CONTRACT_CHARS) throw new Error("Contract exceeds the 100,000-character limit.");
  return specMarkdown.split(/\r?\n/).flatMap((raw, index) => {
    const requirementQuote = raw.replace(/^\s*[-*\d.)]+\s*/, "").trim();
    if (!requirementQuote || requirementQuote.startsWith("#")) return [];
    return [{ id: `rule-${index + 1}`, requirementQuote, specLine: index + 1, level: levelFor(requirementQuote) }];
  }).slice(0, MAX_RULES);
}

function deterministicCheck(rule: ContractRule): CompiledCheck | undefined {
  const packageName = targetAfter(rule.requirementQuote, /(?:add|import|use)\s+[`'"]?([@\w./-]+)/i);
  const path = targetAfter(rule.requirementQuote, /(?:change|touch|modify)\s+[`'"]?([\w./*-]+)/i);
  const rationale = "Deterministically compiled from contract text.";
  if (/dependency|package|import/i.test(rule.requirementQuote) && packageName) return { ...rule, mode: /import/i.test(rule.requirementQuote) ? "restricted-import" : "dependency", target: packageName, rationale };
  if (/(do not|never|prohibited).*(\.github|workflow|migration|path|folder|directory)/i.test(rule.requirementQuote) && path) return { ...rule, mode: "path-glob", target: path, rationale };
  if (/test/i.test(rule.requirementQuote) && /(require|must|every|add)/i.test(rule.requirementQuote)) return { ...rule, mode: "required-test", target: "test", rationale };
  if (/eval\(|dangerouslySetInnerHTML|new Function/i.test(rule.requirementQuote)) return { ...rule, mode: "restricted-syntax", target: rule.requirementQuote.match(/eval\(|dangerouslySetInnerHTML|new Function/i)?.[0] || "restricted-syntax", rationale };
  return undefined;
}

export function compileContract(specMarkdown: string): CompiledContract {
  const sourceRules = normalizeContractRules(specMarkdown); const checks = sourceRules.flatMap((rule) => deterministicCheck(rule) ? [deterministicCheck(rule)!] : []);
  const checked = new Set(checks.map((check) => check.id));
  return compiledContractSchema.parse({ sourceRules, checks, unexpressibleRules: sourceRules.filter((rule) => !checked.has(rule.id)), compiler: "deterministic-fallback", compilerDiagnostics: [] });
}

export function validateProviderBatch(value: unknown, rules: ContractRule[], compiler: "nvidia" | "gemini" | "ollama"): CompiledCheck[] {
  const raw = value as { assignments?: Record<string, unknown>[] }; const byId = new Map(rules.map((rule) => [rule.id, rule])); const checks: CompiledCheck[] = [];
  for (const entry of Array.isArray(raw.assignments) ? raw.assignments : []) {
    const rule = typeof entry.ruleId === "string" ? byId.get(entry.ruleId) : undefined; const mode = typeof entry.mode === "string" ? entry.mode : "judgment";
    const target = [entry.target, entry.package, entry.path, entry.pattern].find((candidate) => typeof candidate === "string") as string | undefined;
    if (!rule || !allowed.has(mode) || mode === "judgment" || !target || checks.some((check) => check.id === rule.id)) continue;
    checks.push({ ...rule, mode: mode as CompiledCheck["mode"], target, rationale: `Compiled by ${compiler} and grounded to contract text.` });
  }
  return checks;
}