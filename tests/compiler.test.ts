import { describe, expect, it } from "vitest";
import { compileContract, normalizeContractRules, validateProviderBatch } from "@/lib/compiler";

describe("compileContract", () => {
  it("maps only allowlisted deterministic rule types", () => {
    const contract = compileContract(`- Do not add lodash as a dependency.\n- Never modify .github/workflows/.\n- Every API route must include a test.`);
    expect(contract.checks.map((check) => check.mode)).toEqual(["dependency", "path-glob", "required-test"]);
    expect(contract.checks.every((check) => check.level === "MUST")).toBe(true);
  });

  it("preserves every normalized AI judgment rule with its original line", () => {
    const contract = compileContract("# Contract\n\n- Keep the architecture simple and understandable to new contributors.");
    expect(contract.unexpressibleRules).toEqual([{ id: "rule-3", requirementQuote: "Keep the architecture simple and understandable to new contributors.", specLine: 3, level: "SHOULD" }]);
    expect(contract.sourceRules).toHaveLength(1);
  });

  it("grounds provider batch assignments to known rule IDs", () => {
    const rules = normalizeContractRules("- Never add lodash as a dependency.");
    expect(validateProviderBatch({ assignments: [{ ruleId: "rule-1", mode: "dependency", package: "lodash" }, { ruleId: "invented", mode: "dependency", package: "bad" }] }, rules, "nvidia")).toMatchObject([{ id: "rule-1", target: "lodash", mode: "dependency", specLine: 1 }]);
  });

  it("preserves more than the former 120-rule ceiling", () => {
    const contract = compileContract(Array.from({ length: 211 }, (_, index) => `- Review policy ${index}.`).join("\n"));
    expect(contract.sourceRules).toHaveLength(211);
    expect(contract.unexpressibleRules.at(-1)).toMatchObject({ id: "rule-211", specLine: 211 });
  });
  it("rejects empty and oversized contracts", () => {
    expect(() => compileContract("   ")).toThrow("contract is required");
    expect(() => compileContract("x".repeat(30_001))).toThrow("30,000");
  });
});