import { afterEach, describe, expect, it, vi } from "vitest";
import { compileContract } from "@/lib/compiler";
import { getDemoSnapshot } from "@/lib/fixtures";
import { judgeWithOllama } from "@/lib/ollama";

const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
  delete process.env.OLLAMA_BASE_URL;
});

describe("Ollama judgment boundary", () => {
  it("accepts only findings grounded in an allowed rule and changed file", async () => {
    process.env.OLLAMA_BASE_URL = "http://ollama.local/api";
    const responseBody = { message: { content: JSON.stringify({ findings: [
      { rule: "Keep the architecture simple.", filePath: "app/page.tsx", line: 2, violationType: "Complexity", action: "Simplify it.", confidence: "low" },
      { rule: "Invented rule", filePath: "secrets.ts", line: 1, violationType: "Fake", action: "Ignore", confidence: "high" },
    ] }) } };
    global.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(responseBody))) as typeof fetch;
    const findings = await judgeWithOllama(getDemoSnapshot("demo://blocked")!, compileContract("- Keep the architecture simple."));
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ source: "llm", filePath: "app/page.tsx", confidence: "low" });
  });

  it("does not attempt a network request when no judgment rules exist", async () => {
    const fetchSpy = vi.fn(); global.fetch = fetchSpy;
    await expect(judgeWithOllama(getDemoSnapshot("demo://approved")!, compileContract("- Do not add lodash as a dependency."))).resolves.toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
