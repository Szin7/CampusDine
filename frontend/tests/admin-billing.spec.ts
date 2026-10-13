import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
async function admin(page: Page) {
  await page.goto("/sign-in");
  await page.getByRole("radio", { name: "Admin", exact: true }).check();
  await page.getByLabel("Username", { exact: true }).fill("accounts");
  await page.getByLabel("Password", { exact: true }).fill("browser-test-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("navigation", { name: "Admin navigation" }).getByRole("link", { name: "Billing", exact: true }).click();
  await expect(page.getByRole("button", { name: "Reload dues" })).toBeEnabled();
}
async function selectMonth(page: Page, value = "2026-09") {
  await page.getByLabel("Billing month", { exact: true }).fill(value);
  await page.getByRole("button", { name: "Apply month" }).click();
  await expect(page.getByRole("button", { name: "Reload dues" })).toBeEnabled();
}
async function review(page: Page, roll: string, month = "2026-09") {
  await page.getByRole("button", { name: `Settle ${roll} ${month}`, exact: true }).click();
  await page.getByLabel("Accounts transfer reference", { exact: true }).fill(`TRANSFER-${roll}`);
  await page.getByRole("checkbox").check();
}

test("month/search totals and authenticated CSV include inactive accounts", async ({ page }) => {
  await admin(page); await selectMonth(page);
  await page.getByLabel("Find dues", { exact: true }).fill("BILL-4");
  await expect(page.getByRole("table", { name: "Outstanding credit by student and month" }).locator("tbody tr")).toHaveCount(1);
  await expect(page.locator(".billing-totals")).toContainText("NPR 120.00");
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export dues CSV" }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe("campusdine-dues-2026-09.csv");
  const csv = await readFile((await file.path())!, "utf8");
  expect(csv).toContain("BILL-4"); expect(csv).toContain("BILL-1");
  expect(csv).toContain('"Electronics, IT"'); expect(csv).not.toContain("2026-08");
  await selectMonth(page, "2025-01");
  await page.getByLabel("Find dues", { exact: true }).fill("");
  await expect(page.getByRole("heading", { name: "No outstanding dues for this period." })).toBeVisible();
});

test("settling reviewed IDs leaves newer debt and wallet unchanged", async ({ page, browser }) => {
  await admin(page); await review(page, "BILL-1");
  await expect(page.getByRole("dialog")).toContainText("NPR 120.00");
  const student = await browser.newContext();
  const session = await (await student.request.post("http://localhost:3000/api/auth/login", { data: { role: "student", username: "BILL-1", password: "browser-test-password" } })).json();
  const order = await student.request.post("http://localhost:3000/api/orders", { headers: { "X-CSRF-Token": session.csrf_token }, data: { checkout_key: "billing-newer-order", expected_total: 12000, items: [{ menu_item_id: 1, quantity: 1 }] } });
  expect(order.status()).toBe(201);
  await page.getByRole("button", { name: "Confirm settlement", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Settlement recorded" })).toBeVisible();
  const balances = await (await student.request.get("http://localhost:3000/api/wallet")).json();
  expect(balances.credit_balance).toBe(24000); expect(balances.wallet_balance).toBe(0);
  await expect(page.getByRole("table", { name: "Recorded settlements" })).toContainText("TRANSFER-BILL-1");
  await student.close();
});

test("lost settlement response and reload recover one receipt without a second reduction", async ({ page }) => {
  await admin(page); await review(page, "BILL-2");
  const bodies: unknown[] = [];
  await page.route("**/api/admin/billing/settlements", async route => {
    if (route.request().method() !== "POST") return route.continue();
    bodies.push(route.request().postDataJSON()); const response = await route.fetch();
    if (bodies.length === 1) await route.abort("failed"); else await route.fulfill({ response });
  });
  await page.getByRole("button", { name: "Confirm settlement", exact: true }).click();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText("unconfirmed");
  await page.reload();
  await expect(page.getByRole("heading", { name: "Recover settlement" })).toBeVisible();
  await page.getByRole("button", { name: "Retry saved settlement" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Settlement recorded" })).toBeVisible();
  expect(bodies[0]).toEqual(bodies[1]);
  await expect(page.getByRole("table", { name: "Recorded settlements" }).locator("tbody tr")).toHaveCount(1);
  const rows = await (await page.request.get("/api/admin/students?status=all&q=BILL-2")).json();
  const balance = await (await page.request.get(`/api/admin/accounts/${rows[0].id}`)).json();
  expect(balance.credit_balance).toBe(12000);
});

test("another settlement makes a stale review fail without clearing other months", async ({ page }) => {
  await admin(page); await review(page, "BILL-3");
  const session = await (await page.request.get("/api/auth/me")).json();
  const dues = await (await page.request.get("/api/admin/billing/outstanding?month=2026-09")).json();
  const row = dues.find((value: { roll_no: string }) => value.roll_no === "BILL-3");
  const response = await page.request.post("/api/admin/billing/settlements", { headers: { "X-CSRF-Token": session.csrf_token }, data: { request_key: "other-admin-settlement", student_id: row.student_id, ledger_ids: row.ledger_ids, expected_amount: row.amount, reference: "Concurrent accounts transfer" } });
  expect(response.status()).toBe(201);
  await page.getByRole("button", { name: "Confirm settlement", exact: true }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText("already settled");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Settle BILL-3 2026-08", exact: true })).toBeVisible();
});

test("load/export errors, cancellation and mobile dark layout", async ({ page }, testInfo) => {
  await admin(page);
  await page.getByLabel("Find dues", { exact: true }).fill("BILL-4");
  await review(page, "BILL-4");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByRole("button", { name: "Settle BILL-4 2026-09", exact: true })).toBeVisible();
  await page.route("**/api/admin/billing/outstanding.csv", route => route.fulfill({ status: 503 }));
  await page.getByRole("button", { name: "Export dues CSV" }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText("CSV could not be exported");
  await page.route("**/api/admin/billing/outstanding", route => route.fulfill({ status: 503, json: { detail: "Billing temporarily unavailable" } }));
  await page.getByRole("button", { name: "Reload dues" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Billing temporarily unavailable" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Export dues CSV" })).toBeDisabled();
  await page.unroute("**/api/admin/billing/outstanding");
  await page.getByRole("button", { name: "Retry dues" }).click();
  await expect(page.getByRole("button", { name: "Settle BILL-4 2026-09", exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("billing-desktop.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Use dark theme" }).click();
  await review(page, "BILL-4");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("billing-mobile-review.png"), fullPage: true });
});

test("blocked storage sends nothing; rapid confirmation records a suspended student's dues once", async ({ page }) => {
  await admin(page); await review(page, "BILL-4");
  let posts = 0;
  await page.route("**/api/admin/billing/settlements", async route => { if (route.request().method() === "POST") posts++; await route.continue(); });
  await page.evaluate(() => { Object.defineProperty(sessionStorage, "setItem", { configurable: true, value: () => { throw new Error("Blocked"); } }); });
  await page.getByRole("button", { name: "Confirm settlement", exact: true }).click();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText("No settlement was sent");
  expect(posts).toBe(0);
  await page.evaluate(() => { Reflect.deleteProperty(sessionStorage, "setItem"); });
  await page.getByRole("button", { name: "Confirm settlement", exact: true }).evaluate((button: HTMLButtonElement) => { button.click(); button.click(); });
  await expect(page.getByRole("status").filter({ hasText: "Settlement recorded" })).toBeVisible();
  expect(posts).toBe(1);
});
