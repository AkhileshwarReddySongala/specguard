import type { AnalysisResult, CompiledCheck, CompiledContract, Finding, PRSnapshot, Verdict } from "@/lib/contracts";

function hunkFor(snapshot: PRSnapshot, path: string, line: number) {
  const header = `+++ b/${path}`;
  const start = snapshot.unifiedDiff.indexOf(header);
  if (start < 0) return snapshot.unifiedDiff.slice(0, 500) || `Changed ${path}:${line}`;
  return snapshot.unifiedDiff.slice(start, start + 700);
}

function changedLine(snapshot: PRSnapshot, path: string, needle: string) {
  const file = snapshot.changedFiles.find((entry) => entry.path === path);
  if (!file) return { line: 1, preExisting: false };
  const line = file.content.split(/\r?\n/).findIndex((value) => value.includes(needle));
  return { line: Math.max(line + 1, 1), preExisting: !snapshot.unifiedDiff.includes(needle) };
}

function finding(check: CompiledCheck, snapshot: PRSnapshot, path: string, needle: string, violationType: string, action: string): Finding {
  const location = changedLine(snapshot, path, needle);
  return {
    id: `${check.id}-${path}-${location.line}`,
    requirementQuote: check.requirementQuote,
    specLine: check.specLine,
    filePath: path,
    line: location.line,
    diffHunk: hunkFor(snapshot, path, location.line),
    violationType,
    action,
    source: "deterministic",
    confidence: "high",
    preExisting: location.preExisting,
  };
}

function runCheck(check: CompiledCheck, snapshot: PRSnapshot): Finding[] {
  if (check.mode === "path-glob") {
    return snapshot.changedFiles.filter((file) => file.path.includes(check.target)).map((file) => finding(check, snapshot, file.path, file.path, "Protected path changed", `Remove this change from ${check.target}.`));
  }
  if (check.mode === "dependency") {
    const packageFile = snapshot.changedFiles.find((file) => file.path.endsWith("package.json"));
    if (packageFile?.content.includes(`\"${check.target}\"`)) return [finding(check, snapshot, packageFile.path, check.target, "Unauthorized dependency", `Remove ${check.target} or obtain explicit approval.`)];
    const imported = snapshot.changedFiles.find((file) => file.content.includes(check.target));
    if (imported) return [finding(check, snapshot, imported.path, check.target, "Unauthorized dependency", `Remove ${check.target} or obtain explicit approval.`)];
  }
  if (check.mode === "restricted-import") {
    const match = snapshot.changedFiles.find((file) => new RegExp(`from ['\"]${check.target.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}['\"]`).test(file.content));
    if (match) return [finding(check, snapshot, match.path, check.target, "Restricted import", `Remove the ${check.target} import.`)];
  }
  if (check.mode === "restricted-syntax") {
    const match = snapshot.changedFiles.find((file) => file.content.includes(check.target));
    if (match) return [finding(check, snapshot, match.path, check.target, "Restricted syntax", `Replace ${check.target} with a safe alternative.`)];
  }
  if (check.mode === "required-test") {
    const changedProductionFile = snapshot.changedFiles.some((file) => /\.(ts|tsx|js|jsx)$/.test(file.path) && !/(test|spec)\./.test(file.path));
    const changedTestFile = snapshot.changedFiles.some((file) => /(test|spec)\.(ts|tsx|js|jsx)$/.test(file.path));
    if (changedProductionFile && !changedTestFile) {
      const first = snapshot.changedFiles.find((file) => /\.(ts|tsx|js|jsx)$/.test(file.path))!;
      return [finding(check, snapshot, first.path, first.path, "Required test missing", "Add a matching test file for this change.")];
    }
  }
  return [];
}

export function deriveVerdict(findings: Finding[], checks: CompiledCheck[]): { verdict: Verdict; complianceScore: number } {
  const active = findings.filter((entry) => !entry.preExisting);
  const must = active.some((entry) => checks.find((check) => entry.id.startsWith(check.id))?.level === "MUST");
  const highJudgment = active.some((entry) => entry.source === "llm" && entry.confidence === "high");
  const should = active.length > 0;
  const weightedTotal = Math.max(checks.reduce((total, check) => total + (check.level === "MUST" ? 3 : 1), 0), 1);
  const failedWeight = active.reduce((total, entry) => total + (checks.find((check) => entry.id.startsWith(check.id))?.level === "MUST" ? 3 : 1), 0);
  const complianceScore = Math.max(0, Math.round((1 - failedWeight / weightedTotal) * 100));
  if (must) return { verdict: "merge_blocked", complianceScore: Math.min(complianceScore, 59) };
  if (should || highJudgment) return { verdict: "changes_required", complianceScore: Math.min(complianceScore, 79) };
  if (findings.length > 0) return { verdict: "approved_with_warnings", complianceScore };
  return { verdict: "approved", complianceScore };
}

export function analyze(snapshot: PRSnapshot, contract: CompiledContract): AnalysisResult {
  const findings = contract.checks.flatMap((check) => runCheck(check, snapshot));
  const { verdict, complianceScore } = deriveVerdict(findings, contract.checks);
  return {
    snapshot,
    contract,
    findings,
    verdict,
    complianceScore,
    diagnostics: contract.unexpressibleRules.length ? [`${contract.unexpressibleRules.length} rule(s) require AI judgment and are not enforced in local demo mode.`] : [],
    judgmentUnavailable: contract.unexpressibleRules.length > 0,
  };
}
