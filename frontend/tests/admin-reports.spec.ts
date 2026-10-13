import { test, expect, type Page } from "@playwright/test";
async function admin(page: Page) {
  await page.goto("/sign-in");
  await page.getByRole("radio", { name: "Admin", exact: true }).check();
  await page.getByLabel("Username", { exact: true }).fill("reports-admin");
  await page.getByLabel("Password", { exact: true }).fill("browser-test-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("navigation", { name: "Admin navigation" }).getByRole("link", { name: "Sales", exact: true }).click();
  await expect(page.getByRole("button", { name: "Refresh report" })).toBeEnabled();
}
async function daily(page: Page, start = "2026-09-20", end = "2026-09-25") {
  await page.getByRole("button", { name: "Daily", exact: true }).click();
  await page.getByLabel("Start date", { exact: true }).fill(start);
  await page.getByLabel("End date", { exact: true }).fill(end);
  await page.getByRole("button", { name: "Apply report", exact: true }).click();
  await expect(page.getByRole("button", { name: "Refresh report" })).toBeEnabled();
}
const metric = (page: Page, label: string) => page.locator(".sales-kpis>div").filter({ has: page.locator("dt", { hasText: label }) });

test("real daily totals reconcile wallet and credit and retain zero-sales days", async ({ page }) => {
  await admin(page); await daily(page);
  await expect(metric(page, "Total sales")).toContainText("NPR 1,560.00");
  await expect(metric(page, "Orders placed").locator("dd")).toHaveText("7");
  await expect(metric(page, "Wallet-funded sales")).toContainText("NPR 120.00");
  await expect(metric(page, "Credit-funded sales")).toContainText("NPR 1,440.00");
  const table = page.getByRole("table", { name: "Sales by period" });
  await expect(table.locator("tbody tr")).toHaveCount(6);
  await expect(table.getByRole("row", { name: /21 Sept 2026/ })).toContainText("NPR 0.00");
  const bar = page.getByRole("button", { name: /^23 Sept 2026: 1 orders/ });
  await bar.focus();
  await expect(page.locator(".sales-chart-detail")).toContainText("Wallet NPR 120.00 · Credit NPR 0.00");
});

test("monthly totals keep all twelve months and fit desktop/mobile dark mode", async ({ page }, testInfo) => {
  await admin(page);
  await page.getByRole("button", { name: "Monthly", exact: true }).click();
  await page.getByLabel("Report year", { exact: true }).fill("2026");
  await page.getByRole("button", { name: "Apply report", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Monthly sales", exact: true })).toBeVisible();
  const table = page.getByRole("table", { name: "Sales by period" });
  await expect(table.locator("tbody tr")).toHaveCount(12);
  await expect(table.getByRole("row", { name: /Sept 2026/ })).toContainText("NPR 1,560.00");
  await expect(table.getByRole("row", { name: /Jan 2026/ })).toContainText("NPR 0.00");
  await page.screenshot({ path: testInfo.outputPath("sales-desktop.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Use dark theme" }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("sales-mobile.png"), fullPage: true });
});

test("empty reports, date validation and paging do not misrepresent totals", async ({ page }) => {
  await admin(page); await daily(page, "2025-01-01", "2025-02-02");
  await expect(page.getByRole("status").filter({ hasText: "No sales recorded" })).toBeVisible();
  await expect(metric(page, "Orders placed")).toContainText("Average order —");
  await expect(page.getByRole("table", { name: "Sales by period" }).locator("tbody tr")).toHaveCount(31);
  await page.getByRole("button", { name: "Next periods" }).click();
  await expect(page.getByRole("table", { name: "Sales by period" }).locator("tbody tr")).toHaveCount(2);
  await expect(metric(page, "Total sales")).toContainText("NPR 0.00");
  await page.getByLabel("Start date", { exact: true }).fill("2026-12-31");
  await page.getByRole("button", { name: "Apply report", exact: true }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText("start date no later");
  await page.getByLabel("Start date", { exact: true }).fill("2024-01-01");
  await page.getByRole("button", { name: "Apply report", exact: true }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText("1 to 366 days");
});

test("report failures hide old figures and a retry reloads them", async ({ page }) => {
  await admin(page); await daily(page);
  await page.route("**/api/admin/reports/daily?*", route => route.fulfill({ status: 503, json: { detail: "Reports temporarily unavailable" } }));
  await page.getByRole("button", { name: "Refresh report" }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText("Reports temporarily unavailable");
  await expect(page.locator(".sales-kpis")).toHaveCount(0);
  await page.unroute("**/api/admin/reports/daily?*");
  await page.getByRole("button", { name: "Retry sales report" }).click();
  await expect(metric(page, "Total sales")).toContainText("NPR 1,560.00");
});

test("top-ups and credit settlement do not inflate historical sales", async ({ page }) => {
  await admin(page); await daily(page, "2026-08-01", "2026-08-31");
  await expect(metric(page, "Total sales")).toContainText("NPR 480.00");
  const session = await (await page.request.get("/api/auth/me")).json();
  const dues = await (await page.request.get("/api/admin/billing/outstanding?month=2026-08")).json();
  const row = dues.find((value: { roll_no: string }) => value.roll_no === "BILL-1");
  const headers = { "X-CSRF-Token": session.csrf_token };
  expect((await page.request.post(`/api/admin/accounts/${row.student_id}/top-ups`, { headers, data: { request_key: "report-topup-0001", amount: 50000, reference: "Sales test receipt" } })).status()).toBe(201);
  expect((await page.request.post("/api/admin/billing/settlements", { headers, data: { request_key: "report-settle-0001", student_id: row.student_id, ledger_ids: row.ledger_ids, expected_amount: row.amount, reference: "Sales test transfer" } })).status()).toBe(201);
  await page.getByRole("button", { name: "Refresh report" }).click();
  await expect(metric(page, "Total sales")).toContainText("NPR 480.00");
  await expect(metric(page, "Credit-funded sales")).toContainText("NPR 480.00");
  await expect(metric(page, "Wallet-funded sales")).toContainText("NPR 0.00");
});

test("default and today preset use Nepal's date even when UTC is the previous month", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-09-30T18:30:00Z"));
  await admin(page);
  await expect(page.getByLabel("Start date", { exact: true })).toHaveValue("2026-10-01");
  await expect(page.getByLabel("End date", { exact: true })).toHaveValue("2026-10-01");
  await daily(page);
  await page.getByRole("button", { name: "Today in Nepal" }).click();
  await expect(page.getByLabel("Start date", { exact: true })).toHaveValue("2026-10-01");
  await expect(page.getByRole("table", { name: "Sales by period" }).locator("tbody tr")).toHaveCount(1);
});
