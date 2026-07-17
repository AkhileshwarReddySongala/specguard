import { expect, test } from "@playwright/test";

const repositoryContext = { owner: "acme", repo: "widget", number: 7, title: "Contract test", agentsMarkdown: "# Contract\n- Never add lodash as a dependency.", agentsPath: "AGENTS.md" };

test("a demo PR renders an evidence-linked blocked verdict", async ({ page }) => {
  await page.goto("/"); await page.getByRole("button", { name: "COMPILE CONTRACT" }).click(); await expect(page.getByText(/Contract compiled/)).toBeVisible(); await page.getByRole("button", { name: "ANALYZE PULL REQUEST" }).click(); await expect(page.getByRole("heading", { name: "MERGE BLOCKED" })).toBeVisible(); await page.getByRole("option").first().click(); await expect(page.getByRole("heading", { name: /CONTRACT/ })).toBeVisible(); await expect(page.getByRole("heading", { name: /CHANGED CODE/ })).toBeVisible();
});

test("loads a discovered AGENTS contract before compilation", async ({ page }) => {
  await page.route("**/api/pr-context", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify(repositoryContext) }));
  await page.goto("/"); await page.getByLabel("PUBLIC GITHUB PR URL").fill("https://github.com/acme/widget/pull/7"); await page.getByRole("button", { name: "LOAD CONTRACT" }).click(); await expect(page.getByText("Loaded from AGENTS.md")).toBeVisible(); await expect(page.getByLabel("CONTRACT")).toHaveValue(repositoryContext.agentsMarkdown);
});

test("requires an explicit contract choice when AGENTS is absent", async ({ page }) => {
  await page.route("**/api/pr-context", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ ...repositoryContext, agentsMarkdown: null, agentsPath: null }) }));
  await page.goto("/"); await page.getByLabel("PUBLIC GITHUB PR URL").fill("https://github.com/acme/widget/pull/7"); await page.getByRole("button", { name: "LOAD CONTRACT" }).click(); await expect(page.getByText("No AGENTS.md found")).toBeVisible(); await page.getByRole("button", { name: "USE ILLUSTRATIVE SAMPLE" }).click(); await expect(page.getByText(/Example contract/)).toBeVisible(); await expect(page.getByRole("button", { name: "COMPILE CONTRACT" })).toBeEnabled();
});