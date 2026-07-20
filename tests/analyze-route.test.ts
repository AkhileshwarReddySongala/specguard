import { afterEach, describe, expect, it } from "vitest";
import { POST } from "@/app/api/analyze/route";
import { compileContract } from "@/lib/compiler";

const saved = { nvidia: process.env.NVIDIA_API_KEY, gemini: process.env.GEMINI_API_KEY, geminiModel: process.env.GEMINI_MODEL, ollama: process.env.OLLAMA_BASE_URL };
afterEach(() => { for (const [key, value] of Object.entries(saved)) { const env = key === "nvidia" ? "NVIDIA_API_KEY" : key === "gemini" ? "GEMINI_API_KEY" : key === "geminiModel" ? "GEMINI_MODEL" : "OLLAMA_BASE_URL"; if (value === undefined) delete process.env[env]; else process.env[env] = value; } });
function finalFrom(stream: string) { return JSON.parse(stream.split("\n").find((line) => line.includes('"type":"final"'))!.slice(6)).result; }

describe("streamed analysis route", () => {
  it("returns a partial warnings result when selected AI rules cannot be assessed", async () => {
    delete process.env.NVIDIA_API_KEY; delete process.env.GEMINI_API_KEY; delete process.env.GEMINI_MODEL; delete process.env.OLLAMA_BASE_URL;
    const contract = compileContract("- Review risky changes.");
    const response = await POST(new Request("http://localhost/api/analyze", { method: "POST", body: JSON.stringify({ prUrl: "demo://blocked", compiledContract: contract, judgmentMode: "all" }), headers: { "Content-Type": "application/json" } }));
    expect(response.status).toBe(200); const stream = await response.text(); const result = finalFrom(stream);
    expect(stream).toContain("AI judgment 1/1 rules"); expect(result).toMatchObject({ verdict: "approved_with_warnings", complianceScore: 79, judgmentUnavailable: true, judgmentCoverage: { mode: "all", selectedRules: 1, completedRules: 0, unassessedRules: 1, complete: false } });
  });
  it("validates the requested judgment mode", async () => {
    const response = await POST(new Request("http://localhost/api/analyze", { method: "POST", body: JSON.stringify({ prUrl: "demo://blocked", compiledContract: compileContract("- Review risky changes."), judgmentMode: "fast" }), headers: { "Content-Type": "application/json" } }));
    expect(response.status).toBe(400);
  });
});