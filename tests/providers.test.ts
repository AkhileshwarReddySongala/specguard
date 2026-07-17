import { describe, expect, it } from "vitest";
import { compileWithProviders } from "@/lib/providers";

describe("hosted provider boundary", () => {
  it("keeps the deterministic compiler available without hosted credentials", async () => {
    const contract = await compileWithProviders("- Never add lodash as a dependency.");
    expect(contract.compiler).toBe("deterministic-fallback");
    expect(contract.checks[0]).toMatchObject({ mode: "dependency", level: "MUST" });
  });
});