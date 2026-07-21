import { describe, expect, it } from "vitest";
import { analyze, applyCoverageVerdict, deriveVerdict } from "@/lib/analyzer";
import { compileContract } from "@/lib/compiler";
import { DEMO_CONTRACTS, getDemoSnapshot } from "@/lib/fixtures";

describe("analysis and verdict aggregation", () => {
  it("blocks the dedicated deterministic proof fixture with exact changed-code evidence", () => {
    const result = analyze(getDemoSnapshot("demo://proof")!, compileContract(DEMO_CONTRACTS["demo://proof"]));
    expect(result).toMatchObject({ verdict: "merge_blocked", complianceScore: expect.any(Number), findings: [expect.objectContaining({ source: "deterministic", filePath: "src/proof.ts", line: 1, requirementQuote: "Never import lodash." })] });
  });

  it("blocks the protected-path proof fixture with exact changed-file evidence", () => {
    const result = analyze(getDemoSnapshot("demo://protected-path")!, compileContract(DEMO_CONTRACTS["demo://protected-path"]));
    expect(result).toMatchObject({ verdict: "merge_blocked", findings: [expect.objectContaining({ source: "deterministic", filePath: ".github/workflows/release.yml", line: 1, requirementQuote: "Never modify .github/workflows/." })] });
  });

  it("requires changes for the SHOULD test proof fixture", () => {
    const result = analyze(getDemoSnapshot("demo://missing-test")!, compileContract(DEMO_CONTRACTS["demo://missing-test"]));
    expect(result).toMatchObject({ verdict: "changes_required", findings: [expect.objectContaining({ source: "deterministic", filePath: "app/api/health/route.ts", line: 1, violationType: "Required test missing" })] });
  });
  it("blocks an unauthorized dependency with deterministic evidence", () => {
    const result = analyze(getDemoSnapshot("demo://blocked")!, compileContract("- Do not add lodash as a dependency."));
    expect(result.verdict).toBe("merge_blocked");
    expect(result.complianceScore).toBeLessThan(60);
    expect(result.findings[0]).toMatchObject({ source: "deterministic", confidence: "high", filePath: "app/page.tsx", preExisting: false });
    expect(result.findings[0].requirementQuote).toBe("Do not add lodash as a dependency.");
  });

  it("marks a finding outside the diff as pre-existing and excludes it from the verdict", () => {
    const snapshot = getDemoSnapshot("demo://blocked")!;
    snapshot.unifiedDiff = "@@ -1 +1 @@\n export default function App() {}";
    const result = analyze(snapshot, compileContract("- Do not add lodash as a dependency."));
    expect(result.findings[0].preExisting).toBe(true);
    expect(result.verdict).toBe("approved_with_warnings");
  });

  it("downgrades a zero-rule contract to warning-only coverage", () => {
    expect(applyCoverageVerdict({ verdict: "approved", complianceScore: 100 }, { mode: "relevant", totalRules: 0, scopeExcludedRules: 0, selectedRules: 0, completedRules: 0, unassessedRules: 0, complete: true, providersUsed: ["deterministic-only"] }, 0)).toEqual({ verdict: "approved_with_warnings", complianceScore: 79 });
  });

  it("keeps complete AI-only coverage eligible for approval", () => {
    expect(applyCoverageVerdict({ verdict: "approved", complianceScore: 100 }, { mode: "all", totalRules: 3, scopeExcludedRules: 0, selectedRules: 3, completedRules: 3, unassessedRules: 0, complete: true, providersUsed: ["nvidia"] }, 0)).toEqual({ verdict: "approved", complianceScore: 100 });
  });

  it("caps changes-required scores below 80", () => {
    const check = compileContract("- Every API route must include a matching test.").checks[0];
    const outcome = deriveVerdict([{ id: `${check.id}-x`, requirementQuote: check.requirementQuote, specLine: 1, filePath: "a.ts", line: 1, diffHunk: "", violationType: "Missing", action: "Add", source: "deterministic", confidence: "high", preExisting: false }], [{ ...check, level: "SHOULD" }]);
    expect(outcome).toEqual({ verdict: "changes_required", complianceScore: expect.any(Number) });
    expect(outcome.complianceScore).toBeLessThan(80);
  });
});
