import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildJudgmentContext, compileWithProviders, judgeWithProviders, providerStateForTests, resetProviderStateForTests, selectRelevantRules, setProviderSchedulerForTests } from "@/lib/providers";
import type { PRSnapshot } from "@/lib/contracts";
import { compileContract } from "@/lib/compiler";

const snapshot: PRSnapshot = { owner: "owner", repo: "repo", number: 1, title: "Add a change", unifiedDiff: "diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1,2 +1,3 @@\n export const stable = true;\n+export const risky = true;\n export const done = true;", changedFiles: [{ path: "src/a.ts", status: "modified", content: "export const stable = true;\nexport const risky = true;\nexport const done = true;" }] };
const originalFetch = globalThis.fetch; const originalNvidia = process.env.NVIDIA_API_KEY; const originalGemini = process.env.GEMINI_API_KEY; const originalGeminiModel = process.env.GEMINI_MODEL;
let fakeTime = 0;
function nvidiaResponse(value: unknown) { return Response.json({ choices: [{ message: { content: JSON.stringify(value) } }] }); }
function restore(name: "NVIDIA_API_KEY" | "GEMINI_API_KEY" | "GEMINI_MODEL", value: string | undefined) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
beforeEach(() => { fakeTime = 0; setProviderSchedulerForTests(() => fakeTime, async (ms) => { fakeTime += ms; }); });
afterEach(() => { globalThis.fetch = originalFetch; restore("NVIDIA_API_KEY", originalNvidia); restore("GEMINI_API_KEY", originalGemini); restore("GEMINI_MODEL", originalGeminiModel); resetProviderStateForTests(); });

describe("rate-aware hosted provider boundary", () => {
  it("keeps deterministic compilation available without hosted credentials", async () => {
    delete process.env.NVIDIA_API_KEY; delete process.env.GEMINI_API_KEY; delete process.env.GEMINI_MODEL;
    const contract = await compileWithProviders("- Never add lodash as a dependency.");
    expect(contract.compiler).toBe("deterministic-fallback");
    expect(contract.checks[0]).toMatchObject({ mode: "dependency", level: "MUST" });
  });
  it("reports complete deterministic-only coverage when every rule is enforceable", async () => {
    const result = await judgeWithProviders(snapshot, compileContract("- Add a matching test file for this change."));
    expect(result).toMatchObject({ findings: [], provider: "deterministic-only", coverage: { complete: true, totalRules: 0, selectedRules: 0 } });
  });
  it("keeps all supplied batch rules in bounded changed-hunk context", () => {
    const rules = compileContract(Array.from({ length: 12 }, (_, index) => `- Review rule ${index}.`).join("\n")).unexpressibleRules;
    const context = buildJudgmentContext(snapshot, rules);
    expect(context.rules).toHaveLength(12);
    expect(context.changedFiles).toEqual([{ path: "src/a.ts", lines: expect.arrayContaining([{ line: 2, text: "export const risky = true;" }]) }]);
  });
  it("paces 360 rules into 45 batches without exceeding 30 starts in a rolling minute", async () => {
    process.env.NVIDIA_API_KEY = "test-key"; const fetchSpy = vi.fn(async (_input, init) => { const body = JSON.parse(String(init?.body)); const rules = JSON.parse(body.messages[1].content).rules; return nvidiaResponse({ assignments: rules.map((rule: { id: string }) => ({ ruleId: rule.id, mode: "judgment" })) }); }) as typeof fetch; globalThis.fetch = fetchSpy;
    const contract = await compileWithProviders(Array.from({ length: 360 }, (_, index) => `- Review policy ${index}.`).join("\n"));
    expect(contract.sourceRules).toHaveLength(360); expect(contract.unexpressibleRules).toHaveLength(360);
    expect(fetchSpy).toHaveBeenCalledTimes(45); expect(fakeTime).toBeGreaterThanOrEqual(88_000); expect(providerStateForTests().requestsInWindow).toBeLessThanOrEqual(30);
  });
  it("retries a malformed NVIDIA batch once before accepting output", async () => {
    process.env.NVIDIA_API_KEY = "test-key"; let calls = 0;
    globalThis.fetch = vi.fn(async () => { calls += 1; return calls === 1 ? nvidiaResponse({ broken: true }) : nvidiaResponse({ assignments: [] }); }) as typeof fetch;
    const contract = await compileWithProviders("- Review risky changes.");
    expect(contract.compiler).toBe("nvidia"); expect(contract.compilerDiagnostics).toContain("invalid_output"); expect(calls).toBe(2);
  });
  it("excludes only explicit nonmatching path rules in relevant mode", () => {
    const rules = compileContract("- Review src/a.ts changes.\n- Review docs/guide.md changes.\n- Review all risky changes.").unexpressibleRules;
    const relevant = selectRelevantRules(snapshot, rules, "relevant");
    expect(relevant.selected.map((rule) => rule.id)).toEqual(["rule-1", "rule-3"]); expect(relevant.excluded.map((rule) => rule.id)).toEqual(["rule-2"]);
    expect(selectRelevantRules(snapshot, rules, "all").selected).toHaveLength(3);
  });
  it("judges every selected rule in paced batches and reports complete coverage", async () => {
    process.env.NVIDIA_API_KEY = "test-key"; let calls = 0;
    globalThis.fetch = vi.fn(async () => { calls += 1; return nvidiaResponse({ findings: [] }); }) as typeof fetch;
    const contract = compileContract(Array.from({ length: 16 }, (_, index) => `- Review risky behavior ${index}.`).join("\n"));
    const result = await judgeWithProviders(snapshot, contract, "all");
    expect(calls).toBe(2); expect(result.coverage).toMatchObject({ mode: "all", totalRules: 16, selectedRules: 16, completedRules: 16, unassessedRules: 0, complete: true });
  });
  it("keeps only provider findings grounded to added lines and exact contract lines", async () => {
    process.env.NVIDIA_API_KEY = "test-key";
    globalThis.fetch = vi.fn().mockResolvedValue(nvidiaResponse({ findings: [{ ruleId: "rule-3", filePath: "src/a.ts", line: 2, violationType: "Risk", action: "Review", confidence: "high" }, { ruleId: "rule-3", filePath: "src/a.ts", line: 1, violationType: "Old", action: "Ignore", confidence: "high" }] })) as typeof fetch;
    const result = await judgeWithProviders(snapshot, compileContract("# Contract\n\n- Review risky changes."));
    expect(result.findings).toHaveLength(1); expect(result.findings[0]).toMatchObject({ line: 2, specLine: 3, requirementQuote: "Review risky changes.", preExisting: false, source: "llm" });
  });
});