import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/compile/route";

const originalFetch = globalThis.fetch; const originalNvidia = process.env.NVIDIA_API_KEY;
afterEach(() => { globalThis.fetch = originalFetch; if (originalNvidia === undefined) delete process.env.NVIDIA_API_KEY; else process.env.NVIDIA_API_KEY = originalNvidia; });

describe("compile route", () => {
  it("streams one deterministic final contract for a 30k+ contract without calling NVIDIA", async () => {
    process.env.NVIDIA_API_KEY = "test-key";
    const fetchSpy = vi.fn() as typeof fetch; globalThis.fetch = fetchSpy;
    const rules = Array.from({ length: 40 }, (_, index) => `- Review rule ${index}.`).join("\n"); const specMarkdown = `${rules}\n${Array.from({ length: 3_400 }, () => "# padding").join("\n")}`;
    const response = await POST(new Request("http://localhost/api/compile", { method: "POST", body: JSON.stringify({ specMarkdown }), headers: { "Content-Type": "application/json" } }));
    expect(response.status).toBe(200); const stream = await response.text(); const final = JSON.parse(stream.split("\n").find((line) => line.includes('"type":"final"'))!.slice(6));
    expect(stream).toContain("0 safe checks compiled · 40 AI judgment rules"); expect(final.contract.sourceRules).toHaveLength(40); expect(final.contract.checks).toHaveLength(0); expect(fetchSpy).not.toHaveBeenCalled();
  });
  it("returns a readable validation error above the bounded contract maximum", async () => {
    const response = await POST(new Request("http://localhost/api/compile", { method: "POST", body: JSON.stringify({ specMarkdown: "x".repeat(100_001) }), headers: { "Content-Type": "application/json" } }));
    expect(response.status).toBe(400); await expect(response.json()).resolves.toEqual({ error: "Contract must be 100,000 characters or fewer." });
  });
});
