import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/compile/route";
import { resetProviderStateForTests } from "@/lib/providers";

const originalFetch = globalThis.fetch; const originalNvidia = process.env.NVIDIA_API_KEY;
afterEach(() => { globalThis.fetch = originalFetch; if (originalNvidia === undefined) delete process.env.NVIDIA_API_KEY; else process.env.NVIDIA_API_KEY = originalNvidia; resetProviderStateForTests(); });

describe("compile route", () => {
  it("returns one validated final contract for a large mocked NVIDIA compile", async () => {
    process.env.NVIDIA_API_KEY = "test-key";
    globalThis.fetch = vi.fn(async (_input, init) => { const body = JSON.parse(String(init?.body)); const rules = JSON.parse(body.messages[1].content).rules; return Response.json({ choices: [{ message: { content: JSON.stringify({ assignments: rules.map((rule: { id: string }) => ({ ruleId: rule.id, mode: "judgment" })) }) } }] }); }) as typeof fetch;
    const rules = Array.from({ length: 40 }, (_, index) => `- Review rule ${index}.`).join("\n"); const specMarkdown = `${rules}\n${Array.from({ length: 3_400 }, () => "# padding").join("\n")}`;
    expect(specMarkdown.length).toBeGreaterThan(30_000); const response = await POST(new Request("http://localhost/api/compile", { method: "POST", body: JSON.stringify({ specMarkdown }), headers: { "Content-Type": "application/json" } }));
    expect(response.status).toBe(200); const stream = await response.text(); const final = JSON.parse(stream.split("\n").find((line) => line.includes('"type":"final"'))!.slice(6));
    expect(final.contract).toMatchObject({ compiler: "nvidia", sourceRules: expect.arrayContaining([expect.objectContaining({ id: "rule-1", specLine: 1 })]) });
    expect(final.contract.sourceRules).toHaveLength(40);
  });
  it("returns a readable validation error above the bounded contract maximum", async () => {
    const response = await POST(new Request("http://localhost/api/compile", { method: "POST", body: JSON.stringify({ specMarkdown: "x".repeat(100_001) }), headers: { "Content-Type": "application/json" } }));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "Contract must be 100,000 characters or fewer." });
  });
});