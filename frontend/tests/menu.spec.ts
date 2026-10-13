import { test, expect, type Page } from "@playwright/test";

async function signIn(page: Page) {
  await page.goto("/sign-in");
  await page.getByLabel("Roll number", { exact: true }).fill("NCE-001");
  await page.getByLabel("Password", { exact: true }).fill("browser-test-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/menu$/);
  await expect(page.getByRole("heading", { name: "The menu", exact: true })).toBeVisible();
}

test("real menu prices, cold-start labels and category filters", async ({ page }) => {
  await signIn(page);
  await expect(page.getByText("NPR 450.00", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: /^(From the canteen|Most ordered this week)$/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Your usuals", exact: true })).toHaveCount(0);
  await expect(page.getByRole("article")).toHaveCount(9);
  await expect(page.getByText("Old menu item", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("article", { name: "Veg momo", exact: true })).toContainText("NPR 120.00");
  await page.getByRole("button", { name: "Noodles", exact: true }).click();
  await expect(page.getByRole("article")).toHaveCount(2);
  await expect(page.getByRole("article", { name: "Chicken chowmein", exact: true })).toContainText("Sold out");
  await page.getByLabel("Available only", { exact: true }).check();
  await expect(page.getByRole("article")).toHaveCount(1);
  await page.getByRole("searchbox", { name: "Search menu" }).fill("tea");
  await expect(page.getByText("Nothing matches just yet.")).toBeVisible();
  await page.getByRole("button", { name: "Clear filters" }).click();
  await expect(page.getByRole("article")).toHaveCount(9);
});

test("recommendation failure leaves the menu usable", async ({ page }) => {
  await page.route("**/api/menu/recommendations?*", route => route.fulfill({ status: 503, json: { detail: "Temporarily unavailable" } }));
  await signIn(page);
  await expect(page.getByText("Suggestions aren’t available right now. You can still browse the full menu.")).toBeVisible();
  await expect(page.getByRole("article")).toHaveCount(9);
});

test("personalized section uses current menu prices and omits sold-out suggestions", async ({ page }) => {
  await page.route("**/api/menu/recommendations?*", route => route.fulfill({ json: { items: [
    { item: { id: 1, name: "Old name", price: 1, category: "Momo", is_available: true, is_archived: false }, source: "usual" },
    { item: { id: 6, name: "Chicken chowmein", price: 14000, category: "Noodles", is_available: true, is_archived: false }, source: "popular" },
  ] } }));
  await signIn(page);
  const section = page.getByRole("region", { name: "Your usuals" });
  await expect(section).toContainText("Veg momo");
  await expect(section).toContainText("NPR 120.00");
  await expect(section).not.toContainText("Chicken chowmein");
});

test("no items is distinct from a failed request", async ({ page }) => {
  await page.route("**/api/menu?*", route => route.fulfill({ json: [] }));
  await signIn(page);
  await expect(page.getByText("The menu is being prepared.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "From the canteen" })).toHaveCount(0);
});

test("menu fetch walks through pages beyond 200 items", async ({ page }) => {
  const items = Array.from({ length: 201 }, (_, index) => ({ id: index + 100, name: `Fixture dish ${index + 1}`, price: 1000, category: "Test menu", is_available: true, is_archived: false }));
  await page.route("**/api/menu?*", route => {
    const offset = Number(new URL(route.request().url()).searchParams.get("offset"));
    return route.fulfill({ json: items.slice(offset, offset + 200) });
  });
  await signIn(page);
  await expect(page.getByRole("article")).toHaveCount(201);
  await page.getByRole("searchbox", { name: "Search menu" }).fill("Fixture dish 201");
  await expect(page.getByRole("article")).toHaveCount(1);
});

test("menu fits mobile and keeps balances in view while scrolling", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page);
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: testInfo.outputPath("menu-desktop.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.evaluate(() => window.scrollTo(0, 1200));
  const money = await page.getByText("NPR 450.00", { exact: true }).boundingBox();
  expect(money!.y).toBeGreaterThanOrEqual(0);
  expect(money!.y).toBeLessThan(150);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.getByRole("button", { name: "Use dark theme" }).click();
  await page.screenshot({ path: testInfo.outputPath("menu-dark-mobile.png"), fullPage: true });
});

test("successful sign-in clears an earlier session check failure", async ({ page }) => {
  await page.route("**/api/auth/me", route => route.fulfill({ status: 503, json: { detail: "Temporary session check failure" } }));
  await signIn(page);
  await expect(page.getByRole("article")).toHaveCount(9);
});
