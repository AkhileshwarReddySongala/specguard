import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { compileContract, normalizeContractRules } from "@/lib/compiler";

const airflowFixture = readFileSync(resolve(process.cwd(), "tests/fixtures/airflow-contract.md"), "utf8");

describe("compileContract", () => {
  it("extracts atomic wrapped list directives and normative paragraphs with source lines", () => {
    const rules = normalizeContractRules(`# Contract\n\n- Never modify \`.github/workflows/\`\n  during this change.\n\nA release must preserve public behavior.\n\n\`\`\`ts\n- Never import lodash.\n\`\`\``);
    expect(rules).toEqual([
      expect.objectContaining({ id: "rule-3", specLine: 3, requirementQuote: "Never modify `.github/workflows/` during this change." }),
      expect.objectContaining({ id: "rule-6", specLine: 6, requirementQuote: "A release must preserve public behavior." }),
    ]);
  });

  it("ignores example sections and metadata", () => {
    const rules = normalizeContractRules("Owner: Platform\n\n## Examples\n- Never import lodash.\n\n## Contract\n- Review risky changes.");
    expect(rules).toEqual([expect.objectContaining({ specLine: 7, requirementQuote: "Review risky changes." })]);
  });

  it("maps only explicit JS/TS-safe canonical templates", () => {
    const contract = compileContract(`- Do not import lodash.\n- Never use eval(.\n- Never modify .github/workflows/.\n- Do not add lodash as a dependency.\n- Every API route must include a matching test.`);
    expect(contract.checks.map((check) => check.mode)).toEqual(["restricted-import", "restricted-syntax", "path-glob", "dependency", "required-test"]);
    expect(contract.checks.map((check) => check.rationale)).toEqual(expect.arrayContaining([
      "Canonical template: forbidden named import.",
      "Canonical template: forbidden JavaScript syntax.",
      "Canonical template: protected path restriction.",
      "Canonical template: forbidden named dependency.",
      "Canonical template: scoped JS/TS changed-code test requirement.",
    ]));
  });

  it("compiles a clearly scoped SHOULD test requirement without upgrading its severity", () => {
    const contract = compileContract("- Every API route should include a matching test.");
    expect(contract.checks).toEqual([expect.objectContaining({ mode: "required-test", level: "SHOULD", target: "changed-js-ts" })]);
  });
  it("routes Airflow-style comments, documentation, newsfragments, coverage, and db_test rules to AI judgment", () => {
    const contract = compileContract(airflowFixture);
    expect(contract.sourceRules).toHaveLength(6);
    expect(contract.checks).toEqual([expect.objectContaining({ mode: "required-test", specLine: 9 })]);
    expect(contract.unexpressibleRules.map((entry) => entry.specLine)).toEqual([3, 5, 6, 7, 8]);
    expect(contract.unexpressibleRules.every((entry) => !entry.requirementQuote.includes("Every API route"))).toBe(true);
  });

  it("never turns ambiguous testing, documentation, architecture, or Python rules into required-test", () => {
    const contract = compileContract(`- Add documentation for the API.\n- Keep the architecture simple.\n- Add a newsfragment.\n- Use pytest.mark.db_test for database tests.\n- Maintain coverage for changed modules.\n- Add tests when appropriate.`);
    expect(contract.checks).toHaveLength(0);
    expect(contract.unexpressibleRules).toHaveLength(6);
  });

  it("does not infer a protected path from a later URL in prose", () => {
    const contract = compileContract("- Never edit the snapshot directly. Framework changes go via PR to apache/magpie.");
    expect(contract.checks).toHaveLength(0);
    expect(contract.unexpressibleRules[0]).toMatchObject({ specLine: 1 });
  });

  it("preserves more than the former 120-rule ceiling", () => {
    const contract = compileContract(Array.from({ length: 211 }, (_, index) => `- Review policy ${index}.`).join("\n"));
    expect(contract.sourceRules).toHaveLength(211);
    expect(contract.unexpressibleRules.at(-1)).toMatchObject({ id: "rule-211", specLine: 211 });
  });

  it("supports full contracts above the former 30,000-character limit while retaining a bounded maximum", () => {
    expect(() => compileContract("# padding".repeat(3_400))).not.toThrow();
    expect(() => compileContract("x".repeat(100_001))).toThrow("100,000");
  });

  it("rejects an empty contract", () => {
    expect(() => compileContract("   ")).toThrow("contract is required");
  });
});
