import { describe, expect, it } from "vitest";
import { analyze, deriveVerdict } from "@/lib/analyzer";
import { compileContract } from "@/lib/compiler";
import { getDemoSnapshot } from "@/lib/fixtures";

describe("analysis and verdict aggregation", () => {
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

  it("caps changes-required scores below 80", () => {
    const check = compileContract("- Add a test for every API route.").checks[0];
    const outcome = deriveVerdict([{ id: `${check.id}-x`, requirementQuote: check.requirementQuote, specLine: 1, filePath: "a.ts", line: 1, diffHunk: "", violationType: "Missing", action: "Add", source: "deterministic", confidence: "high", preExisting: false }], [{ ...check, level: "SHOULD" }]);
    expect(outcome).toEqual({ verdict: "changes_required", complianceScore: expect.any(Number) });
    expect(outcome.complianceScore).toBeLessThan(80);
  });
});
