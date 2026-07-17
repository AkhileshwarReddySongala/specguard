import { expect, test } from "@playwright/test";

test("a demo PR renders an evidence-linked blocked verdict", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "COMPILE CONTRACT" }).click();
  await expect(page.getByText(/Contract compiled/)).toBeVisible();
  await page.getByRole("button", { name: "ANALYZE PULL REQUEST" }).click();
  await expect(page.getByRole("heading", { name: "MERGE BLOCKED" })).toBeVisible();
  await page.getByRole("option").first().click();
  await expect(page.getByRole("heading", { name: /CONTRACT/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: /CHANGED CODE/ })).toBeVisible();
});
