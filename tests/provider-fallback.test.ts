import { afterEach, describe, expect, it, vi } from "vitest";
import { compileWithProviders, resetProviderStateForTests } from "@/lib/providers";

const originalFetch = globalThis.fetch; const originalNvidia = process.env.NVIDIA_API_KEY; const originalGemini = process.env.GEMINI_API_KEY; const originalGeminiModel = process.env.GEMINI_MODEL;
function restore(name: "NVIDIA_API_KEY" | "GEMINI_API_KEY" | "GEMINI_MODEL", value: string | undefined) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
function nvidiaResponse(value: unknown) { return Response.json({ choices: [{ message: { content: JSON.stringify(value) } }] }); }
afterEach(() => { globalThis.fetch = originalFetch; restore("NVIDIA_API_KEY", originalNvidia); restore("GEMINI_API_KEY", originalGemini); restore("GEMINI_MODEL", originalGeminiModel); resetProviderStateForTests(); });

describe("provider fallback behavior", () => {
  it("retries malformed NVIDIA output once", async () => {
    process.env.NVIDIA_API_KEY = "test-key"; let calls = 0;
    globalThis.fetch = vi.fn(async () => { calls += 1; return calls === 1 ? Response.json({ choices: [{ message: { content: "not-json" } }] }) : nvidiaResponse({ assignments: [] }); }) as typeof fetch;
    const contract = await compileWithProviders("- Review risky changes.");
    expect(contract.compiler).toBe("nvidia");
    expect(calls).toBe(2);
  });

  it("hands a failed NVIDIA batch to configured Gemini", async () => {
    process.env.NVIDIA_API_KEY = "test-key"; process.env.GEMINI_API_KEY = "gemini-key"; process.env.GEMINI_MODEL = "gemini-test"; let nvidiaCalls = 0; let geminiCalls = 0;
    globalThis.fetch = vi.fn(async (input) => { if (String(input).includes("integrate.api.nvidia.com")) { nvidiaCalls += 1; return new Response("gateway", { status: 504 }); } geminiCalls += 1; return Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify({ assignments: [] }) }] } }] }); }) as typeof fetch;
    const contract = await compileWithProviders("- Review risky changes.");
    expect(contract.compiler).toBe("gemini");
    expect(contract.compilerDiagnostics).toContain("gateway_timeout");
    expect(nvidiaCalls).toBe(2);
    expect(geminiCalls).toBe(1);
  });
});