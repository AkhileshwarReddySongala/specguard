import { afterEach, describe, expect, it, vi } from "vitest";
import { buildJudgmentContext, compileWithProviders, judgeWithProviders, providerStateForTests, resetProviderStateForTests } from "@/lib/providers";
import type { PRSnapshot } from "@/lib/contracts";
import { compileContract } from "@/lib/compiler";

const snapshot: PRSnapshot = { owner: "owner", repo: "repo", number: 1, title: "Add a change", unifiedDiff: "diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1,2 +1,3 @@\n export const stable = true;\n+export const risky = true;\n export const done = true;", changedFiles: [{ path: "src/a.ts", status: "modified", content: "export const stable = true;\nexport const risky = true;\nexport const done = true;" }] };
const originalFetch = globalThis.fetch; const originalNvidia = process.env.NVIDIA_API_KEY; const originalGemini = process.env.GEMINI_API_KEY; const originalGeminiModel = process.env.GEMINI_MODEL;
function nvidiaResponse(value: unknown) { return Response.json({ choices: [{ message: { content: JSON.stringify(value) } }] }); }
function restore(name: "NVIDIA_API_KEY" | "GEMINI_API_KEY" | "GEMINI_MODEL", value: string | undefined) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
afterEach(() => { globalThis.fetch = originalFetch; restore("NVIDIA_API_KEY", originalNvidia); restore("GEMINI_API_KEY", originalGemini); restore("GEMINI_MODEL", originalGeminiModel); resetProviderStateForTests(); });

describe("hosted provider boundary", () => {
  it("keeps the deterministic compiler available without hosted credentials", async () => {
    delete process.env.NVIDIA_API_KEY; delete process.env.GEMINI_API_KEY; delete process.env.GEMINI_MODEL;
    const contract = await compileWithProviders("- Never add lodash as a dependency.");
    expect(contract.compiler).toBe("deterministic-fallback");
    expect(contract.checks[0]).toMatchObject({ mode: "dependency", level: "MUST" });
  });

  it("reports deterministic-only when every rule is enforceable without AI judgment", async () => {
    const result = await judgeWithProviders(snapshot, compileContract("- Add a matching test file for this change."));
    expect(result).toEqual({ findings: [], provider: "deterministic-only" });
  });

  it("builds bounded context from changed hunks only", () => {
    const rules = compileContract(Array.from({ length: 12 }, (_, index) => `- Review rule ${index}.`).join("\n")).unexpressibleRules;
    const context = buildJudgmentContext(snapshot, rules);
    expect(context.rules).toHaveLength(8);
    expect(context.changedFiles).toEqual([{ path: "src/a.ts", lines: expect.arrayContaining([{ line: 2, text: "export const risky = true;" }]) }]);
  });

  it("compiles full contracts in parallel batches with bounded concurrency", async () => {
    process.env.NVIDIA_API_KEY = "test-key"; let active = 0; let maxActive = 0; let calls = 0;
    globalThis.fetch = vi.fn(async (_input, init) => { active += 1; maxActive = Math.max(maxActive, active); calls += 1; const body = JSON.parse(String(init?.body)); const rules = JSON.parse(body.messages[1].content).rules; await new Promise((resolve) => setTimeout(resolve, 5)); active -= 1; return nvidiaResponse({ assignments: rules.map((rule: { id: string }) => ({ ruleId: rule.id, mode: "judgment" })) }); }) as typeof fetch;
    const contract = await compileWithProviders(Array.from({ length: 40 }, (_, index) => `- Review governance rule ${index}.`).join("\n"));
    expect(contract.compiler).toBe("nvidia");
    expect(contract.sourceRules).toHaveLength(40);
    expect(contract.unexpressibleRules).toHaveLength(40);
    expect(calls).toBe(5);
    expect(maxActive).toBeLessThanOrEqual(4);
    expect(providerStateForTests().requestsInWindow).toBe(5);
  });

  it("never issues more than 30 NVIDIA requests in a minute", async () => {
    process.env.NVIDIA_API_KEY = "test-key"; const fetchSpy = vi.fn(async (_input, init) => { const body = JSON.parse(String(init?.body)); const rules = JSON.parse(body.messages[1].content).rules; return nvidiaResponse({ assignments: rules.map((rule: { id: string }) => ({ ruleId: rule.id, mode: "judgment" })) }); }) as typeof fetch; globalThis.fetch = fetchSpy;
    const contract = await compileWithProviders(Array.from({ length: 248 }, (_, index) => `- Review policy ${index}.`).join("\n"));
    expect(contract.compilerDiagnostics).toContain("rate_limited");
    expect(fetchSpy).toHaveBeenCalledTimes(30);
  });
  it("retries a 504 batch once before accepting NVIDIA output", async () => {
    process.env.NVIDIA_API_KEY = "test-key"; let calls = 0;
    globalThis.fetch = vi.fn(async () => { calls += 1; return calls === 1 ? new Response("gateway", { status: 504 }) : nvidiaResponse({ assignments: [] }); }) as typeof fetch;
    const contract = await compileWithProviders("- Review risky changes.");
    expect(contract.compiler).toBe("nvidia");
    expect(contract.compilerDiagnostics).toContain("gateway_timeout");
    expect(calls).toBe(2);
  });

  it("opens an NVIDIA cooldown after a 429 and skips the next compile", async () => {
    process.env.NVIDIA_API_KEY = "test-key"; const fetchSpy = vi.fn().mockResolvedValue(new Response("limited", { status: 429 })) as typeof fetch; globalThis.fetch = fetchSpy;
    const first = await compileWithProviders("- Review risky changes.");
    const second = await compileWithProviders("- Review another risky change.");
    expect(first.compilerDiagnostics).toContain("rate_limited");
    expect(second.compilerDiagnostics).toContain("cooldown");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(providerStateForTests().cooldownUntil).toBeGreaterThan(Date.now());
  });

  it("keeps only provider findings grounded to added lines and exact contract lines", async () => {
    process.env.NVIDIA_API_KEY = "test-key";
    globalThis.fetch = vi.fn().mockResolvedValue(nvidiaResponse({ findings: [{ ruleId: "rule-3", filePath: "src/a.ts", line: 2, violationType: "Risk", action: "Review", confidence: "high" }, { ruleId: "rule-3", filePath: "src/a.ts", line: 1, violationType: "Old", action: "Ignore", confidence: "high" }] })) as typeof fetch;
    const result = await judgeWithProviders(snapshot, compileContract("# Contract\n\n- Review risky changes."));
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toMatchObject({ line: 2, specLine: 3, requirementQuote: "Review risky changes.", preExisting: false, source: "llm" });
  });
});