import { afterEach, describe, expect, it, vi } from "vitest";
import { judgeWithProviders, resetProviderStateForTests } from "@/lib/providers";
import { compileContract } from "@/lib/compiler";
import type { PRSnapshot } from "@/lib/contracts";

const snapshot: PRSnapshot = { owner: "owner", repo: "repo", number: 1, title: "Test", unifiedDiff: "+++ b/src/a.ts\n@@ -0,0 +1 @@\n+export const changed = true;", changedFiles: [{ path: "src/a.ts", status: "modified", content: "export const changed = true;" }] };
const originalFetch = globalThis.fetch; const originalNvidia = process.env.NVIDIA_API_KEY; const originalGemini = process.env.GEMINI_API_KEY; const originalGeminiModel = process.env.GEMINI_MODEL; const originalGeminiFallbackModel = process.env.GEMINI_FALLBACK_MODEL;
function restore(name: "NVIDIA_API_KEY" | "GEMINI_API_KEY" | "GEMINI_MODEL" | "GEMINI_FALLBACK_MODEL", value: string | undefined) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
function nvidiaResponse(value: unknown) { return Response.json({ choices: [{ message: { content: JSON.stringify(value) } }] }); }
afterEach(() => { globalThis.fetch = originalFetch; restore("NVIDIA_API_KEY", originalNvidia); restore("GEMINI_API_KEY", originalGemini); restore("GEMINI_MODEL", originalGeminiModel); restore("GEMINI_FALLBACK_MODEL", originalGeminiFallbackModel); resetProviderStateForTests(); });

describe("provider fallback behavior", () => {
  it("retries malformed NVIDIA judgment output once", async () => {
    process.env.NVIDIA_API_KEY = "test-key"; let calls = 0;
    globalThis.fetch = vi.fn(async () => { calls += 1; return calls === 1 ? Response.json({ choices: [{ message: { content: "not-json" } }] }) : nvidiaResponse({ findings: [] }); }) as typeof fetch;
    const result = await judgeWithProviders(snapshot, compileContract("- Review risky changes."));
    expect(result.coverage.complete).toBe(true); expect(calls).toBe(2);
  });

  it("hands a failed NVIDIA judgment batch to configured Gemini", async () => {
    process.env.NVIDIA_API_KEY = "test-key"; process.env.GEMINI_API_KEY = "gemini-key"; process.env.GEMINI_MODEL = "gemini-test"; let nvidiaCalls = 0; let geminiCalls = 0;
    globalThis.fetch = vi.fn(async (input) => { if (String(input).includes("integrate.api.nvidia.com")) { nvidiaCalls += 1; return new Response("gateway", { status: 504 }); } geminiCalls += 1; return Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify({ findings: [] }) }] } }] }); }) as typeof fetch;
    const result = await judgeWithProviders(snapshot, compileContract("- Review risky changes."));
    expect(result.provider).toBe("gemini"); expect(result.diagnostics).toContain("gateway_timeout"); expect(nvidiaCalls).toBe(2); expect(geminiCalls).toBe(1);
  });
  it("retries a Gemini 429 with the configured fallback model", async () => {
    delete process.env.NVIDIA_API_KEY; process.env.GEMINI_API_KEY = "gemini-key"; process.env.GEMINI_MODEL = "gemma-4-31b-it"; process.env.GEMINI_FALLBACK_MODEL = "gemma-4-26b-a4b-it"; let calls = 0;
    globalThis.fetch = vi.fn(async (input) => { calls += 1; return String(input).includes("gemma-4-31b-it") ? new Response("rate limited", { status: 429 }) : Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify({ findings: [] }) }] } }] }); }) as typeof fetch;
    const result = await judgeWithProviders(snapshot, compileContract("- Review risky changes."));
    expect(calls).toBe(2); expect(result).toMatchObject({ provider: "gemini", coverage: { complete: true } });
  });
});
