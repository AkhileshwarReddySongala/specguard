import { compiledContractSchema, MAX_CONTRACT_CHARS, type CompiledCheck, type CompiledContract, type ContractRule } from "@/lib/contracts";

const MAX_RULES = 500;
const normativeLanguage = /\b(must|must not|should|shall|never|prohibited|do not|don't|required|may not)\b/i;
const mustWords = /\b(must|must not|shall|never|prohibited|do not|don't|required|may not)\b/i;
const listItem = /^\s*(?:[-+*]|\d+[.)])\s+(.+)$/;
const codeFence = /^\s*(```|~~~)/;
const heading = /^\s{0,3}#{1,6}\s+/;
const pathToken = /(?:\.github|[A-Za-z0-9_-]+)(?:\/[A-Za-z0-9_.*-]+)+(?:\/)?/;

function levelFor(quote: string): "MUST" | "SHOULD" { return mustWords.test(quote) ? "MUST" : "SHOULD"; }
function cleaned(value: string) { return value.replace(/[`*_]/g, "").replace(/[.,;:]+$/, "").trim(); }
function rule(id: number, requirementQuote: string, specLine: number): ContractRule {
  return { id: `rule-${id}`, requirementQuote, specLine, level: levelFor(requirementQuote) };
}

/** Extract authored directives without treating headings, examples, and prose scaffolding as rules. */
export function normalizeContractRules(specMarkdown: string): ContractRule[] {
  if (!specMarkdown.trim()) throw new Error("A contract is required.");
  if (specMarkdown.length > MAX_CONTRACT_CHARS) throw new Error("Contract exceeds the 100,000-character limit.");

  const rules: ContractRule[] = [];
  const add = (quote: string, line: number) => {
    const requirementQuote = quote.replace(/\s+/g, " ").trim();
    if (requirementQuote && rules.length < MAX_RULES) rules.push(rule(line, requirementQuote, line));
  };
  let inFence = false;
  let inFrontMatter = false;
  let inExamples = false;
  let bullet: { text: string; line: number } | undefined;
  let paragraph: { text: string[]; line: number } | undefined;
  const flushBullet = () => { if (bullet) add(bullet.text, bullet.line); bullet = undefined; };
  const flushParagraph = () => {
    if (paragraph) {
      const quote = paragraph.text.join(" ").trim();
      if (normativeLanguage.test(quote)) add(quote, paragraph.line);
    }
    paragraph = undefined;
  };

  for (const [index, raw] of specMarkdown.split(/\r?\n/).entries()) {
    const line = index + 1;
    if (codeFence.test(raw)) { flushBullet(); flushParagraph(); inFence = !inFence; continue; }
    if (inFence) continue;
    if (line === 1 && raw.trim() === "---") { flushBullet(); flushParagraph(); inFrontMatter = true; continue; }
    if (inFrontMatter) { if (raw.trim() === "---") inFrontMatter = false; continue; }
    if (heading.test(raw)) { flushBullet(); flushParagraph(); inExamples = /^\s{0,3}#{1,6}\s+(?:examples?|non-authoritative examples?)\b/i.test(raw); continue; }
    if (inExamples) continue;
    const item = raw.match(listItem);
    if (item) { flushBullet(); flushParagraph(); bullet = { text: item[1].trim(), line }; continue; }
    if (bullet) {
      if (!raw.trim()) { flushBullet(); continue; }
      if (!heading.test(raw) && !/^\s*>/.test(raw)) bullet.text += ` ${raw.trim()}`;
      else flushBullet();
      continue;
    }
    if (!raw.trim()) { flushParagraph(); continue; }
    if (/^\s*>/.test(raw) || /^\s*(?:example|examples|table of contents|owner|version|updated)\s*:/i.test(raw)) { flushParagraph(); continue; }
    if (!paragraph) paragraph = { text: [], line };
    paragraph.text.push(raw.trim());
  }
  flushBullet(); flushParagraph();
  return rules;
}

function prohibited(quote: string) { return /\b(do not|don't|never|must not|may not|prohibited)\b/i.test(quote); }
function deterministic(rule: ContractRule, mode: CompiledCheck["mode"], target: string, template: string): CompiledCheck {
  return { ...rule, mode, target, rationale: `Canonical template: ${template}.` };
}

/**
 * This is deliberately narrow. Every branch is a code-owned template for a JS/TS
 * enforcement engine; anything else remains a bounded AI judgment rule.
 */
function deterministicCheck(rule: ContractRule): CompiledCheck | undefined {
  const quote = cleaned(rule.requirementQuote);
  if (!prohibited(quote)) {
    const testRequirement = /\b(?:every|each)\s+(?:API\s+route|JavaScript\/TypeScript\s+(?:file|change)|JS\/TS\s+(?:file|change))\s+(?:must|should|shall|is required to)\s+(?:include|have|add)\s+(?:a\s+)?(?:matching\s+)?test(?:\s+file)?\b/i;
    if (testRequirement.test(quote)) return deterministic(rule, "required-test", "changed-js-ts", "scoped JS/TS changed-code test requirement");
    return undefined;
  }

  const importMatch = quote.match(/\b(?:do not|don't|never|must not|may not|prohibited)\s+import\s+(?:from\s+)?[`'"]?(@?[A-Za-z0-9][A-Za-z0-9._/-]*)/i);
  if (importMatch) return deterministic(rule, "restricted-import", cleaned(importMatch[1]), "forbidden named import");

  const dependencyMatch = quote.match(/\b(?:do not|don't|never|must not|may not|prohibited)\s+(?:add|introduce|install)\s+[`'"]?(@?[A-Za-z0-9][A-Za-z0-9._/-]*)[`'"]?\s+(?:as\s+)?(?:a\s+)?(?:new\s+)?(?:dependency|package)\b/i)
    ?? quote.match(/\b(?:do not|don't|never|must not|may not|prohibited)\s+(?:add|introduce|install)\s+(?:the\s+)?(?:dependency|package)\s+[`'"]?(@?[A-Za-z0-9][A-Za-z0-9._/-]*)/i);
  if (dependencyMatch) return deterministic(rule, "dependency", cleaned(dependencyMatch[1]), "forbidden named dependency");

  const syntaxMatch = quote.match(/\b(?:do not|don't|never|must not|may not|prohibited)\s+(?:use\s+|call\s+|invoke\s+)?(eval\(|dangerouslySetInnerHTML|new Function)/i);
  if (syntaxMatch) return deterministic(rule, "restricted-syntax", syntaxMatch[1], "forbidden JavaScript syntax");

  const pathPrefix = quote.match(/\b(?:do not|don't|never|must not|may not|prohibited)\s+(?:modify|change|touch|edit)\s+[`'"]?/i);
  const pathText = pathPrefix ? quote.slice(pathPrefix[0].length).replace(/^(?:the\s+)?(?:path\s+)?[`'"]?/, "") : "";
  const explicitPath = pathText.match(new RegExp("^" + pathToken.source))?.[0];
  if (explicitPath) return deterministic(rule, "path-glob", cleaned(explicitPath), "protected path restriction");

  return undefined;
}

export function compileContract(specMarkdown: string): CompiledContract {
  const sourceRules = normalizeContractRules(specMarkdown);
  const checks = sourceRules.flatMap((sourceRule) => {
    const check = deterministicCheck(sourceRule);
    return check ? [check] : [];
  });
  const checked = new Set(checks.map((check) => check.id));
  return compiledContractSchema.parse({ sourceRules, checks, unexpressibleRules: sourceRules.filter((sourceRule) => !checked.has(sourceRule.id)), compiler: "deterministic-fallback", compilerDiagnostics: [] });
}
