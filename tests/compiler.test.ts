import { describe, expect, it } from "vitest";
import { compileContract, validateProviderContract } from "@/lib/compiler";

describe("compileContract", () => {
  it("maps only allowlisted deterministic rule types", () => {
    const contract = compileContract(`- Do not add lodash as a dependency.\n- Never modify .github/workflows/.\n- Every API route must include a test.`);
    expect(contract.checks.map((check) => check.mode)).toEqual(["dependency", "path-glob", "required-test"]);
    expect(contract.checks.every((check) => check.level === "MUST")).toBe(true);
  });

  it("preserves unexpressible rules without treating them as executable config", () => {
    const contract = compileContract("- Keep the architecture simple and understandable to new contributors.");
    expect(contract.checks).toHaveLength(0);
    expect(contract.unexpressibleRules).toHaveLength(1);
  });

  it("rejects empty and oversized contracts", () => {
    expect(() => compileContract("   ")).toThrow("contract is required");
    expect(() => compileContract("x".repeat(30_001))).toThrow("30,000");
  });
});


it('normalizes compact hosted checks only when their rule is grounded in the contract', () => {
  const { validateProviderContract } = require('@/lib/compiler');
  const contract = validateProviderContract({ checks: [{ mode: 'dependency', rule: 'Never add lodash as a dependency.', package: 'lodash' }], unexpressibleRules: [] }, '- Never add lodash as a dependency.', 'nvidia');
  expect(contract).toMatchObject({ compiler: 'nvidia', checks: [{ mode: 'dependency', target: 'lodash', specLine: 1 }] });
});

