import { test, expect, type Page } from "@playwright/test";
async function account(page: Page, roll: string) {
  await page.goto("/sign-in");
  await page.getByRole("radio", { name: "Admin", exact: true }).check();
  await page.getByLabel("Username", { exact: true }).fill("accounts");
  await page.getByLabel("Password", { exact: true }).fill("browser-test-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("navigation", { name: "Admin navigation" }).getByRole("link", { name: "Accounts", exact: true }).click();
  await page.getByLabel("Find an account").fill(roll);
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await page.getByRole("button", { name: new RegExp(roll) }).click();
  await expect(page.getByRole("button", { name: "Reload balances" })).toBeVisible();
}
async function review(page: Page, amount = "500.25") {
  await page.getByLabel("Top-up amount (NPR)").fill(amount);
  await page.getByLabel("Receipt reference").fill("NCE-RECEIPT-19");
  await page.getByRole("button", { name: "Review top-up", exact: true }).click();
}
const selected = (page: Page) => page.getByRole("region", { name: "Selected student account" });

test("confirmed top-up uses exact paisa and returns an audited receipt", async ({ page }) => {
  await account(page, "FUNDS-1");
  await review(page, "1.005");
  await expect(selected(page).getByRole("alert")).toContainText("two decimal places");
  await review(page);
  await expect(page.getByRole("region", { name: "Confirm top-up", exact: true })).toContainText("FUNDS-1");
  await page.getByRole("button", { name: "Cancel top-up" }).click();
  await expect(selected(page).locator("dl")).toContainText("NPR 100.00");
  await review(page);
  await page.getByRole("button", { name: "Confirm top-up", exact: true }).click();
  await expect(selected(page).getByRole("status").filter({ hasText: "Top-up recorded" })).toBeVisible();
  await expect(selected(page).locator("dl")).toContainText("NPR 600.25");
  await expect(selected(page).locator("dl")).toContainText("NPR 120.00");
  await expect(page.getByRole("table", { name: "Wallet top-ups and order debits" })).toContainText("NCE-RECEIPT-19");
});

test("lost committed response survives reload and recovers only one credit", async ({ page }) => {
  await account(page, "FUNDS-2");
  let posts = 0;
  const keys: string[] = [];
  await page.route("**/api/admin/accounts/*/top-ups", async route => {
    posts++; keys.push(route.request().postDataJSON().request_key);
    const response = await route.fetch();
    if (posts === 1) await route.abort("failed"); else await route.fulfill({ response });
  });
  await review(page, "200.00");
  await page.getByRole("button", { name: "Confirm top-up", exact: true }).click();
  await expect(selected(page).getByRole("alert")).toContainText("unconfirmed");
  await expect(page.getByRole("button", { name: "Review top-up", exact: true })).toBeDisabled();
  await page.reload();
  await expect(page.getByRole("heading", { name: "Recover pending top-up" })).toBeVisible();
  await page.getByRole("button", { name: "Retry saved top-up" }).click();
  await expect(selected(page).getByRole("status").filter({ hasText: "Top-up recorded" })).toBeVisible();
  expect(keys[0]).toBe(keys[1]);
  await expect(selected(page).locator("dl")).toContainText("NPR 300.00");
  await expect(page.getByRole("table", { name: "Wallet top-ups and order debits" }).locator("tbody tr")).toHaveCount(1);
});

test("credit edits reject below dues and stale values then audit a reviewed update", async ({ page }) => {
  await account(page, "FUNDS-3");
  await page.getByLabel("New credit limit (NPR)").fill("100");
  await page.getByLabel("Reason for change").fill("Reviewed by accounts");
  await page.getByRole("button", { name: "Review credit limit" }).click();
  await expect(selected(page).getByRole("alert")).toContainText("lower than outstanding dues");
  await page.getByLabel("New credit limit (NPR)").fill("700");
  await page.getByRole("button", { name: "Review credit limit" }).click();
  const session = await (await page.request.get("/api/auth/me")).json();
  const rows = await (await page.request.get("/api/admin/students?status=all&q=FUNDS-3")).json();
  const response = await page.request.patch(`/api/admin/accounts/${rows[0].id}/credit-limit`, { headers: { "X-CSRF-Token": session.csrf_token }, data: { expected_credit_limit: 50000, credit_limit: 60000, reason: "Other admin edit" } });
  expect(response.ok()).toBe(true);
  await page.getByRole("button", { name: "Confirm limit change" }).click();
  await expect(selected(page).getByRole("alert")).toContainText("credit limit has changed");
  await expect(page.getByLabel("New credit limit (NPR)")).toHaveValue("600.00");
  await page.getByLabel("New credit limit (NPR)").fill("700");
  await page.getByLabel("Reason for change").fill("Approved higher allowance");
  await page.getByRole("button", { name: "Review credit limit" }).click();
  await page.getByRole("button", { name: "Confirm limit change" }).click();
  await expect(selected(page).getByRole("status").filter({ hasText: "Credit limit updated" })).toBeVisible();
  await expect(page.getByRole("table", { name: "Audited credit-limit changes" })).toContainText("Approved higher allowance");
});

test("pending students cannot receive funds and account screen fits mobile dark mode", async ({ page }, testInfo) => {
  await account(page, "NCE-002");
  await expect(page.getByRole("button", { name: "Review top-up" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Review credit limit" })).toBeDisabled();
  await page.screenshot({ path: testInfo.outputPath("accounts-desktop.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Use dark theme" }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("accounts-mobile.png"), fullPage: true });
});

test("failed balances block edits while history and reload remain usable", async ({ page }) => {
  await account(page, "FUNDS-4");
  await page.route(/\/api\/admin\/accounts\/\d+$/, route => route.fulfill({ status: 503, json: { detail: "Balances unavailable" } }));
  await page.getByRole("button", { name: "Reload balances" }).click();
  await expect(selected(page).getByRole("alert")).toContainText("Balances unavailable");
  await expect(page.getByRole("button", { name: "Review top-up" })).toHaveCount(0);
  await page.unroute(/\/api\/admin\/accounts\/\d+$/);
  await page.getByRole("button", { name: "Reload account" }).click();
  await expect(page.getByRole("button", { name: "Review top-up" })).toBeEnabled();
});

test("storage failure prevents sending funds and rapid confirmation sends once", async ({ page }) => {
  await account(page, "FUNDS-4");
  let posts = 0;
  await page.route("**/api/admin/accounts/*/top-ups", async route => { posts++; await route.continue(); });
  await review(page, "10");
  await page.evaluate(() => { Object.defineProperty(window.sessionStorage, "setItem", { configurable: true, value: () => { throw new Error("Storage blocked"); } }); });
  await page.getByRole("button", { name: "Confirm top-up", exact: true }).click();
  await expect(selected(page).getByRole("alert")).toContainText("No top-up was sent");
  expect(posts).toBe(0);
  await page.evaluate(() => { Reflect.deleteProperty(window.sessionStorage, "setItem"); });
  await page.getByRole("button", { name: "Confirm top-up", exact: true }).evaluate((button: HTMLButtonElement) => { button.click(); button.click(); });
  await expect(selected(page).getByRole("status").filter({ hasText: "Top-up recorded" })).toBeVisible();
  expect(posts).toBe(1);
});
