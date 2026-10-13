import { test, expect, type Page } from "@playwright/test";
async function openWallet(page: Page, roll = "WALLET-001") {
  await page.goto("/sign-in");
  await page.getByLabel("Roll number", { exact: true }).fill(roll);
  await page.getByLabel("Password", { exact: true }).fill("browser-test-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("link", { name: "Wallet & credit", exact: true }).click();
  await expect(page).toHaveURL(/\/wallet$/);
}
const credit = (page: Page) => page.getByRole("region", { name: "Credit purchases", exact: true });
const wallet = (page: Page) => page.getByRole("region", { name: "Wallet activity", exact: true });

test("real wallet totals, signed transactions and Nepal timestamps", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openWallet(page);
  const totals = page.getByRole("region", { name: "Account totals", exact: true });
  await expect(totals).toContainText("NPR 380.00");
  await expect(totals).toContainText("NPR 480.00");
  await expect(totals).toContainText("NPR 1,000.00");
  await expect(totals).toContainText("NPR 520.00");
  await expect(wallet(page)).toContainText("+NPR 500.00");
  await expect(wallet(page)).toContainText("−NPR 120.00");
  await expect(wallet(page)).toContainText("23 Sept 2026, 00:15");
  await expect(wallet(page)).toContainText("Accounts receipt TOP-081");
  await expect(credit(page).getByRole("row")).toHaveCount(3);
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: testInfo.outputPath("wallet-desktop.png"), fullPage: true });
});

test("settled and outstanding filters keep settlement reference and date", async ({ page }) => {
  await openWallet(page);
  await credit(page).getByRole("button", { name: "Settled", exact: true }).click();
  await expect(credit(page).getByRole("row")).toHaveCount(2);
  await expect(credit(page)).toContainText("Accounts transfer SET-081");
  await expect(credit(page)).toContainText("27 Sept 2026, 00:15");
  await credit(page).getByRole("button", { name: "Outstanding", exact: true }).click();
  await expect(credit(page).getByRole("row")).toHaveCount(2);
  await expect(credit(page)).not.toContainText("Accounts transfer SET-081");
});

test("wallet history failure does not hide credit entries or account totals", async ({ page }) => {
  let broken = true;
  await page.route("**/api/wallet/transactions?*", route => broken ? route.fulfill({ status: 503, json: { detail: "Wallet history temporarily unavailable." } }) : route.continue());
  await openWallet(page);
  await expect(wallet(page).getByRole("alert")).toContainText("Wallet history temporarily unavailable.");
  await expect(credit(page).getByRole("row")).toHaveCount(3);
  await expect(page.getByRole("region", { name: "Account totals" })).toContainText("NPR 380.00");
  broken = false;
  await wallet(page).getByRole("button", { name: "Try wallet history again" }).click();
  await expect(wallet(page)).toContainText("Accounts receipt TOP-081");
});

test("empty histories do not invent transactions", async ({ page }) => {
  await openWallet(page, "NCE-001");
  await expect(wallet(page)).toContainText("No wallet activity yet.");
  await expect(credit(page)).toContainText("No credit purchases yet.");
  await credit(page).getByRole("button", { name: "Settled", exact: true }).click();
  await expect(credit(page)).toContainText("No settled credit entries yet.");
});

test("history pagination loads older rows and resets when credit filter changes", async ({ page }) => {
  const offsets: number[] = [];
  await page.route("**/api/wallet/credit?*", async route => {
    const url = new URL(route.request().url());
    const offset = Number(url.searchParams.get("offset")); offsets.push(offset);
    const count = url.searchParams.get("status") === "settled" ? 0 : 23;
    const rows = Array.from({ length: count }, (_, i) => ({ id: i + 100, student_id: 11, order_id: 100 + i, amount: 1000, status: "outstanding", month: "2026-09", created_at: "2026-09-25T06:00:00+00:00", settled_at: null, settlement_reference: null }));
    await route.fulfill({ json: rows.slice(offset, offset + 21) });
  });
  await openWallet(page);
  await expect(credit(page).getByRole("row")).toHaveCount(21);
  await credit(page).getByRole("button", { name: "Next", exact: true }).click();
  await expect(credit(page).getByRole("row")).toHaveCount(4);
  await expect(credit(page)).toContainText("Order #122");
  await credit(page).getByRole("button", { name: "Settled", exact: true }).click();
  await expect(credit(page)).toContainText("No settled credit entries yet.");
  expect(offsets).toContain(20);
  expect(offsets.at(-1)).toBe(0);
});

test("mobile dark wallet remains readable without horizontal scrolling", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openWallet(page);
  await expect(wallet(page)).toContainText("Accounts receipt TOP-081");
  await expect(credit(page)).toContainText("Accounts transfer SET-081");
  await page.getByRole("button", { name: "Use dark theme" }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("wallet-dark-mobile.png"), fullPage: true });
});
