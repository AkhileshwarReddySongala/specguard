import { describe, expect, it } from "vitest";
import { buildJudgmentContext, compileWithProviders, judgeWithProviders } from "@/lib/providers";
import type { PRSnapshot } from "@/lib/contracts";
import { compileContract } from "@/lib/compiler";

const snapshot: PRSnapshot = {
  owner: "owner", repo: "repo", number: 1, title: "Add a change",
  unifiedDiff: "diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1,2 +1,3 @@\n export const stable = true;\n+export const risky = true;\n export const done = true;",
  changedFiles: [{ path: "src/a.ts", status: "modified", content: "export const stable = true;\nexport const risky = true;\nexport const done = true;" }],
};

describe("hosted provider boundary", () => {
  it("keeps the deterministic compiler available without hosted credentials", async () => {
    const contract = await compileWithProviders("- Never add lodash as a dependency.");
    expect(contract.compiler).toBe("deterministic-fallback");
    expect(contract.checks[0]).toMatchObject({ mode: "dependency", level: "MUST" });
  });

  it("builds bounded context from changed hunks only", () => {
    const context = buildJudgmentContext(snapshot, Array.from({ length: 12 }, (_, index) => `Rule ${index}`));
    expect(context.rules).toHaveLength(8);
    expect(context.changedFiles).toEqual([{ path: "src/a.ts", lines: expect.arrayContaining([{ line: 2, text: "export const risky = true;" }]) }]);
  });

  it("keeps only provider findings grounded to added lines", async () => {
    const originalFetch = globalThis.fetch; const originalKey = process.env.NVIDIA_API_KEY; let body: Record<string, unknown> | undefined;
    process.env.NVIDIA_API_KEY = "test-key";
    globalThis.fetch = (async (_input, init) => {
      body = JSON.parse(String(init?.body));
      return Response.json({ choices: [{ message: { content: JSON.stringify({ findings: [
        { rule: "Review risky changes.", filePath: "src/a.ts", line: 2, violationType: "Risk", action: "Review", confidence: "high" },
        { rule: "Review risky changes.", filePath: "src/a.ts", line: 1, violationType: "Old", action: "Ignore", confidence: "high" },
      ] }) } }] });
    }) as typeof fetch;
    try {
      const result = await judgeWithProviders(snapshot, compileContract("- Review risky changes."));
      expect(result.findings).toHaveLength(1);
      expect(result.findings[0]).toMatchObject({ line: 2, preExisting: false, source: "llm" });
      expect(body).toMatchObject({ max_tokens: 2048 });
    } finally {
      globalThis.fetch = originalFetch;
      if (originalKey === undefined) delete process.env.NVIDIA_API_KEY; else process.env.NVIDIA_API_KEY = originalKey;
    }
  });
});