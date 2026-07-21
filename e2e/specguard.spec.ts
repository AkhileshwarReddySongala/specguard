import { expect, test } from "@playwright/test";

const repositoryContext = { owner: "acme", repo: "widget", number: 7, title: "Contract test", agentsMarkdown: "# Contract\n- Never add lodash as a dependency.\n- Review risky changes.", agentsPath: "AGENTS.md" };
const demoContract = { sourceRules: [{ id: "rule-2", requirementQuote: "Never add lodash as a dependency.", specLine: 2, level: "MUST" }, { id: "rule-3", requirementQuote: "Review risky changes.", specLine: 3, level: "SHOULD" }], checks: [{ id: "rule-2", requirementQuote: "Never add lodash as a dependency.", specLine: 2, level: "MUST", mode: "dependency", target: "lodash", rationale: "test" }], unexpressibleRules: [{ id: "rule-3", requirementQuote: "Review risky changes.", specLine: 3, level: "SHOULD" }], compiler: "deterministic-fallback", compilerDiagnostics: [] };
const demoResult = { snapshot: { owner: "specguard", repo: "demo", number: 1, title: "Add an unauthorized dependency", unifiedDiff: "@@ -1 +1,2 @@\n+import _ from 'lodash';\n+export const risky = true;", changedFiles: [{ path: "app/page.tsx", status: "modified", content: "import _ from 'lodash';\nexport const risky = true;" }] }, contract: demoContract, findings: [{ id: "rule-2-app", requirementQuote: "Never add lodash as a dependency.", specLine: 2, filePath: "app/page.tsx", line: 1, diffHunk: "+import _ from 'lodash';", violationType: "Unauthorized dependency", action: "Remove lodash.", source: "deterministic", confidence: "high", preExisting: false }, { id: "judgment-3", requirementQuote: "Review risky changes.", specLine: 3, filePath: "app/page.tsx", line: 2, diffHunk: "+export const risky = true;", violationType: "Risk review", action: "Confirm the change is authorized.", source: "llm", confidence: "high", preExisting: false }], verdict: "merge_blocked", complianceScore: 0, diagnostics: [], judgmentUnavailable: false, providerStatus: "nvidia", judgmentCoverage: { mode: "relevant", totalRules: 1, scopeExcludedRules: 0, selectedRules: 1, completedRules: 1, unassessedRules: 0, complete: true, providersUsed: ["nvidia"] } };
async function mockAnalysis(page: import("@playwright/test").Page, result: unknown = demoResult) {
  await page.route("**/api/compile", (route) => route.fulfill({ contentType: "text/event-stream", body: `data: ${JSON.stringify({ type: "progress", stage: "validating", message: "Validating contract text" })}\n\ndata: ${JSON.stringify({ type: "progress", stage: "compiled", message: "1 safe checks compiled" })}\n\ndata: ${JSON.stringify({ type: "final", contract: demoContract })}\n\n` }));
  await page.route("**/api/analyze", (route) => route.fulfill({ contentType: "text/event-stream", body: `data: ${JSON.stringify({ type: "progress", stage: "ai-judgment", message: "AI judgment 1/1 rules" })}\n\ndata: ${JSON.stringify({ type: "final", result })}\n\n` }));
}
async function openDemoResult(page: import("@playwright/test").Page) { await mockAnalysis(page); await page.goto("/"); await page.getByText("AUTHORED DEMO SCENARIOS").click(); await page.getByRole("button", { name: "Blocked dependency" }).click(); await page.getByRole("button", { name: "COMPILE CONTRACT" }).click(); await expect(page.getByText("Choose what receives model judgment.")).toBeVisible(); await page.getByRole("button", { name: "ANALYZE PULL REQUEST" }).click(); await expect(page.getByRole("heading", { name: "MERGE BLOCKED" })).toBeVisible(); }

test("loads a verified curated preset into the contract editor", async ({ page }) => {
  await page.route("**/api/pr-context", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify(repositoryContext) })); await page.goto("/"); await page.getByRole("button", { name: /agents\.md/ }).click(); await expect(page.getByText("LOADED · AGENTS.md")).toBeVisible(); await expect(page.getByLabel("CONTRACT")).toHaveValue(repositoryContext.agentsMarkdown);
});

test("stages compilation and synchronizes exact evidence lines", async ({ page }) => {
  await openDemoResult(page); const first = page.getByRole("option").first(); await first.click(); await expect(first).toHaveAttribute("aria-selected", "true"); await expect(page.locator("[data-line='2'].highlight")).toBeVisible(); await expect(page.locator("[data-file='app/page.tsx'][data-line='1'].highlight")).toBeVisible(); await expect(page.locator(".connector span")).toHaveText("rule §2 → line 1"); await expect(page.locator(".badge.solid")).toHaveText("DETERMINISTIC"); await expect(page.getByText("AI JUDGMENT · HIGH")).toBeVisible();
});

test("shows coverage controls and streamed AI progress", async ({ page }) => {
  await mockAnalysis(page); await page.goto("/"); await page.getByText("AUTHORED DEMO SCENARIOS").click(); await page.getByRole("button", { name: "Blocked dependency" }).click(); await page.getByRole("button", { name: "COMPILE CONTRACT" }).click(); await expect(page.getByText("Choose what receives model judgment.")).toBeVisible(); await page.getByLabel("Judge all rules").check(); await page.getByRole("button", { name: "ANALYZE PULL REQUEST" }).click(); await expect(page.getByText("AI assessment: 1/1 selected rules (100%)")).toBeVisible();
});

test("uses roving keyboard navigation for findings", async ({ page }) => {
  await openDemoResult(page); const findings = page.getByRole("option"); await findings.first().focus(); await page.keyboard.press("ArrowRight"); await expect(findings.nth(1)).toBeFocused(); await expect(findings.nth(1)).toHaveAttribute("aria-selected", "true"); await page.keyboard.press("Home"); await expect(findings.first()).toBeFocused(); await page.keyboard.press("End"); await expect(findings.nth(1)).toBeFocused(); await page.keyboard.press("Enter"); await expect(page.locator("[data-file='app/page.tsx'][data-line='2'].highlight")).toBeVisible();
});

test("shows a designed compile EOF error without enabling analysis", async ({ page }) => {
  await page.route("**/api/compile", (route) => route.fulfill({ contentType: "text/event-stream", body: `data: ${JSON.stringify({ type: "progress", stage: "validating", message: "Validating contract text" })}\n\n` })); await page.goto("/"); await page.getByText("AUTHORED DEMO SCENARIOS").click(); await page.getByRole("button", { name: "Blocked dependency" }).click(); await page.getByRole("button", { name: "COMPILE CONTRACT" }).click(); await expect(page.locator(".error[role=alert]")).toContainText("Compilation stream ended before a final contract"); await expect(page.getByRole("button", { name: "COMPILE CONTRACT" })).toBeVisible();
});

test.describe("mobile vertical chain", () => {
  test.use({ viewport: { width: 390, height: 844 } });
  test("expands one contract-to-change chain with touch-sized finding cards", async ({ page }) => {
    await openDemoResult(page); const first = page.getByRole("option").first(); await first.click(); await expect(page.getByText("THE CONTRACT SAYS")).toBeVisible(); await expect(page.getByText("▼ violated by ▼")).toBeVisible(); await expect(page.getByText("THE CHANGE DOES")).toBeVisible(); const height = await first.evaluate((element) => element.getBoundingClientRect().height); expect(height).toBeGreaterThanOrEqual(44); await expect(page.locator(".evidence-grid")).toBeHidden();
  });
});

test("keeps the explicit no-contract choice", async ({ page }) => {
  await page.route("**/api/pr-context", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ ...repositoryContext, agentsMarkdown: null, agentsPath: null }) })); await page.goto("/"); await page.getByLabel("PUBLIC GITHUB PR URL").fill("https://github.com/acme/widget/pull/7"); await page.getByRole("button", { name: "LOAD CONTRACT" }).click(); await expect(page.getByText("No AGENTS.md found")).toBeVisible(); await page.getByRole("button", { name: "USE ILLUSTRATIVE SAMPLE" }).click(); await expect(page.getByText(/Example contract/)).toBeVisible();
});
test("reveals the workflow progressively and labels verdict coverage precisely", async ({ page }) => {
  await mockAnalysis(page); await page.goto("/");
  await expect(page.getByText("START WITH A VERIFIED PUBLIC PR")).toBeVisible();
  await expect(page.getByLabel("CONTRACT")).toBeHidden();
  await page.getByText("AUTHORED DEMO SCENARIOS").click();
  await page.getByRole("button", { name: "Blocked dependency" }).click();
  await expect(page.getByText("Review the contract before compilation")).toBeVisible();
  await page.getByRole("button", { name: "COMPILE CONTRACT" }).click();
  await expect(page.getByText("Choose what receives model judgment.")).toBeVisible();
  await page.getByRole("button", { name: "ANALYZE PULL REQUEST" }).click();
  await expect(page.getByText("deterministic findings")).toBeVisible();
  await expect(page.getByText("AI rules assessed")).toBeVisible();
});

test("labels a zero-rule result as a limitation instead of passed checks", async ({ page }) => {
  const noRuleResult = { ...demoResult, contract: { ...demoContract, sourceRules: [], checks: [], unexpressibleRules: [] }, findings: [], verdict: "approved_with_warnings", complianceScore: 79, diagnostics: ["No code-enforceable checks compiled and no AI-judgeable rules were found."], judgmentUnavailable: false, providerStatus: "deterministic-only", judgmentCoverage: { mode: "relevant", totalRules: 0, scopeExcludedRules: 0, selectedRules: 0, completedRules: 0, unassessedRules: 0, complete: true, providersUsed: ["deterministic-only"] } };
  await mockAnalysis(page, noRuleResult); await page.goto("/");
  await page.getByText("AUTHORED DEMO SCENARIOS").click(); await page.getByRole("button", { name: "Blocked dependency" }).click();
  await page.getByRole("button", { name: "COMPILE CONTRACT" }).click(); await page.getByRole("button", { name: "ANALYZE PULL REQUEST" }).click();
  await expect(page.getByRole("heading", { name: "No enforceable contract rules." })).toBeVisible();
  await expect(page.getByText("No code-enforceable checks compiled and no AI-judgeable rules were found.")).toHaveCount(2);
  await expect(page.getByText(/passed checks/)).toHaveCount(0);
});

test("runs each deterministic proof through the live local API", async ({ page }) => {
  const scenarios = [
    ["Proof: forbidden import", "MERGE BLOCKED", "src/proof.ts", "Restricted import"],
    ["Proof: protected path", "MERGE BLOCKED", ".github/workflows/release.yml", "Protected path changed"],
    ["Proof: missing test", "CHANGES REQUIRED", "app/api/health/route.ts", "Required test missing"],
  ] as const;
  for (const [label, verdict, filePath, rule] of scenarios) {
    await page.goto("/"); await page.getByText("AUTHORED DEMO SCENARIOS").click(); await page.getByRole("button", { name: label }).click();
    await page.getByRole("button", { name: "COMPILE CONTRACT" }).click(); await page.getByRole("button", { name: "ANALYZE PULL REQUEST" }).click();
    await expect(page.getByRole("heading", { name: verdict })).toBeVisible(); const finding = page.getByRole("option").first(); await expect(finding).toContainText(rule); await finding.click(); await expect(page.locator("[data-line='2'].highlight")).toBeVisible(); await expect(page.getByText(filePath, { exact: true })).toBeVisible();
  }
});
