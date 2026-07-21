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

describe("rate-aware hosted judgment boundary", () => {
  it("never calls a provider while compiling, even when hosted credentials exist", async () => {
    process.env.NVIDIA_API_KEY = "test-key";
    const fetchSpy = vi.fn() as typeof fetch; globalThis.fetch = fetchSpy;
    const contract = await compileWithProviders("- Review risky changes.");
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(contract).toMatchObject({ compiler: "deterministic-fallback", checks: [], unexpressibleRules: [expect.objectContaining({ id: "rule-1" })] });
  });

  it("keeps every supplied batch rule in bounded changed-hunk context", () => {
    const rules = compileContract(Array.from({ length: 12 }, (_, index) => `- Review rule ${index}.`).join("\n")).unexpressibleRules;
    const context = buildJudgmentContext(snapshot, rules);
    expect(context.rules).toHaveLength(12);
    expect(context.changedFiles).toEqual([{ path: "src/a.ts", lines: expect.arrayContaining([{ line: 2, text: "export const risky = true;" }]) }]);
  });

  it("paces 360 AI-judgment rules into 45 batches without exceeding 30 starts in a rolling minute", async () => {
    process.env.NVIDIA_API_KEY = "test-key";
    const fetchSpy = vi.fn(async () => nvidiaResponse({ findings: [] })) as typeof fetch; globalThis.fetch = fetchSpy;
    const contract = compileContract(Array.from({ length: 360 }, (_, index) => `- Review policy ${index}.`).join("\n"));
    const result = await judgeWithProviders(snapshot, contract, "all");
    expect(result.coverage).toMatchObject({ totalRules: 360, completedRules: 360, complete: true });
    expect(fetchSpy).toHaveBeenCalledTimes(45); expect(fakeTime).toBeGreaterThanOrEqual(88_000); expect(providerStateForTests().requestsInWindow).toBeLessThanOrEqual(30);
  });

  it("retries malformed judgment output once without changing the compiled contract", async () => {
    process.env.NVIDIA_API_KEY = "test-key"; let calls = 0;
    globalThis.fetch = vi.fn(async () => { calls += 1; return calls === 1 ? nvidiaResponse({ broken: true }) : nvidiaResponse({ findings: [] }); }) as typeof fetch;
    const contract = compileContract("- Review risky changes.");
    const result = await judgeWithProviders(snapshot, contract);
    expect(calls).toBe(2); expect(result.coverage.complete).toBe(true); expect(contract.checks).toHaveLength(0);
  });

  it("splits an NVIDIA-invalid eight-rule batch and recovers complete coverage", async () => {
    process.env.NVIDIA_API_KEY = "test-key"; let calls = 0; const progress: string[] = [];
    globalThis.fetch = vi.fn(async () => { calls += 1; return calls <= 2 ? nvidiaResponse({ broken: true }) : nvidiaResponse({ findings: [] }); }) as typeof fetch;
    const contract = compileContract(Array.from({ length: 8 }, (_, index) => `- Review recovery rule ${index}.`).join("\n"));
    const result = await judgeWithProviders(snapshot, contract, "all", { onProgress: (event) => progress.push(event.status ?? "running") });
    expect(calls).toBe(4); expect(progress).toContain("retrying"); expect(result.coverage).toMatchObject({ completedRules: 8, unassessedRules: 0, complete: true });
  });

  it("hands split batches to Gemini only after their smaller NVIDIA retries fail", async () => {
    process.env.NVIDIA_API_KEY = "test-key"; process.env.GEMINI_API_KEY = "gemini-key"; process.env.GEMINI_MODEL = "gemini-test"; let nvidiaCalls = 0; let geminiCalls = 0;
    globalThis.fetch = vi.fn(async (input) => { if (String(input).includes("integrate.api.nvidia.com")) { nvidiaCalls += 1; return new Response("gateway", { status: 504 }); } geminiCalls += 1; return Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify({ findings: [] }) }] } }] }); }) as typeof fetch;
    const contract = compileContract(Array.from({ length: 8 }, (_, index) => `- Review fallback rule ${index}.`).join("\n"));
    const result = await judgeWithProviders(snapshot, contract, "all");
    expect(nvidiaCalls).toBe(6); expect(geminiCalls).toBe(2); expect(result).toMatchObject({ provider: "gemini", coverage: { completedRules: 8, unassessedRules: 0, complete: true } });
  });
  it("excludes only explicit nonmatching path rules in relevant mode", () => {
    const rules = compileContract("- Review src/a.ts changes.\n- Review docs/guide.md changes.\n- Review all risky changes.").unexpressibleRules;
    const relevant = selectRelevantRules(snapshot, rules, "relevant");
    expect(relevant.selected.map((entry) => entry.id)).toEqual(["rule-1", "rule-3"]); expect(relevant.excluded.map((entry) => entry.id)).toEqual(["rule-2"]);
    expect(selectRelevantRules(snapshot, rules, "all").selected).toHaveLength(3);
  });

  it("keeps only provider findings grounded to added lines and exact contract lines", async () => {
    process.env.NVIDIA_API_KEY = "test-key";
    globalThis.fetch = vi.fn().mockResolvedValue(nvidiaResponse({ findings: [{ ruleId: "rule-3", filePath: "src/a.ts", line: 2, violationType: "Risk", action: "Review", confidence: "high" }, { ruleId: "rule-3", filePath: "src/a.ts", line: 1, violationType: "Old", action: "Ignore", confidence: "high" }] })) as typeof fetch;
    const result = await judgeWithProviders(snapshot, compileContract("# Contract\n\n- Review risky changes."));
    expect(result.findings).toHaveLength(1); expect(result.findings[0]).toMatchObject({ line: 2, specLine: 3, requirementQuote: "Review risky changes.", preExisting: false, source: "llm" });
  });
});
