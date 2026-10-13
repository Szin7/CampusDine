import { test, expect, type Page } from "@playwright/test";
async function login(page: Page, number: number) {
  await page.goto("/sign-in");
  await page.getByLabel("Roll number", { exact: true }).fill(`CHECK-${number}`);
  await page.getByLabel("Password", { exact: true }).fill("browser-test-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("heading", { name: "The menu", exact: true })).toBeVisible();
}
const basket = (page: Page) => page.getByRole("complementary", { name: "Your basket", exact: true });
const addMomo = (page: Page) => page.getByRole("button", { name: "Add Veg momo to basket", exact: true }).click();

test("wallet boundary checkout returns a real token and debits once", async ({ page }, testInfo) => {
  await login(page, 1);
  await addMomo(page);
  await expect(basket(page)).toContainText("This order will use NPR 120.00 from your wallet.");
  await page.getByRole("button", { name: "Confirm order", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Order confirmed", exact: true })).toBeVisible();
  const orders = await (await page.request.get("/api/orders")).json();
  expect(orders).toHaveLength(1);
  expect(orders[0].payment_type).toBe("wallet");
  const wallet = await (await page.request.get("/api/wallet")).json();
  expect(wallet.wallet_balance).toBe(0);
  expect(wallet.credit_balance).toBe(0);
  await page.screenshot({ path: testInfo.outputPath("confirmed-order.png"), fullPage: true });
  await page.reload();
  await expect(page.getByRole("heading", { name: "Order confirmed", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Start another order" }).click();
  await expect(page.getByRole("heading", { name: "Your basket", exact: true })).toBeVisible();
});

test("credit fallback uses the full total and leaves wallet unchanged", async ({ page }) => {
  await login(page, 2);
  await addMomo(page);
  await page.getByRole("button", { name: "Add one Veg momo", exact: true }).click();
  await expect(basket(page)).toContainText("The full NPR 240.00 will be added to credit; your wallet stays unchanged.");
  await page.getByRole("button", { name: "Confirm order", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Order confirmed", exact: true })).toBeVisible();
  const wallet = await (await page.request.get("/api/wallet")).json();
  expect(wallet.wallet_balance).toBe(12000);
  expect(wallet.credit_balance).toBe(24000);
});

test("insufficient combined funds block checkout and quantity edits persist", async ({ page }) => {
  await login(page, 3);
  await addMomo(page);
  await page.getByRole("button", { name: "Add one Veg momo", exact: true }).click();
  await page.getByRole("button", { name: "Add one Veg momo", exact: true }).click();
  await expect(page.getByRole("button", { name: "Confirm order", exact: true })).toBeDisabled();
  await page.reload();
  await expect(basket(page)).toContainText("NPR 360.00");
  await page.getByRole("button", { name: "Remove one Veg momo", exact: true }).click();
  await expect(page.getByRole("button", { name: "Confirm order", exact: true })).toBeEnabled();
});

test("lost committed response and reload replay the exact request", async ({ page }) => {
  await login(page, 4);
  await addMomo(page);
  const requests: unknown[] = [];
  let first = true;
  await page.route("**/api/orders", async route => {
    if (route.request().method() !== "POST") return route.continue();
    requests.push(route.request().postDataJSON());
    if (first) { first = false; const response = await route.fetch(); expect(response.status()).toBe(201); await route.abort("failed"); }
    else await route.continue();
  });
  await page.getByRole("button", { name: "Confirm order", exact: true }).click();
  await expect(page.getByRole("button", { name: "Retry this order", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Add one Veg momo", exact: true })).toBeDisabled();
  await page.reload();
  await page.getByRole("button", { name: "Retry this order", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Order confirmed", exact: true })).toBeVisible();
  expect(requests).toHaveLength(2);
  expect(requests[0]).toEqual(requests[1]);
  const orders = await (await page.request.get("/api/orders")).json();
  expect(orders).toHaveLength(1);
  expect((await (await page.request.get("/api/wallet")).json()).wallet_balance).toBe(0);
});

test("changed price requires review before a new checkout", async ({ page }) => {
  let stale = true;
  await page.route("**/api/menu?*", async route => {
    const response = await route.fetch();
    const items = await response.json();
    if (stale) { const momo = items.find((item: { id: number }) => item.id === 1); momo.price = 10000; }
    await route.fulfill({ response, json: items });
  });
  await page.route("**/api/orders", async route => { if (route.request().method() === "POST") stale = false; await route.continue(); });
  await login(page, 5);
  await addMomo(page);
  await page.getByRole("button", { name: "Confirm order", exact: true }).click();
  await expect(basket(page).getByRole("alert")).toContainText("Menu prices have changed");
  await expect(basket(page)).toContainText("This order will use NPR 120.00 from your wallet.");
  expect(await (await page.request.get("/api/orders")).json()).toHaveLength(0);
  await page.getByRole("button", { name: "Confirm order", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Order confirmed", exact: true })).toBeVisible();
  // Checkout refreshes the menu after confirmation; finish its intercepted request before teardown.
  await page.unrouteAll({ behavior: "wait" });
});

test("two rapid confirmation events cannot submit twice", async ({ page }) => {
  await login(page, 6);
  await addMomo(page);
  let posts = 0;
  await page.route("**/api/orders", async route => { if (route.request().method() === "POST") posts++; await route.continue(); });
  await page.getByRole("button", { name: "Confirm order", exact: true }).evaluate(button => { (button as HTMLButtonElement).click(); (button as HTMLButtonElement).click(); });
  await expect(page.getByRole("heading", { name: "Order confirmed", exact: true })).toBeVisible();
  expect(posts).toBe(1);
});

test("mobile basket stays usable without horizontal overflow", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page, 7);
  await addMomo(page);
  await page.getByRole("link", { name: /Review basket/ }).click();
  await expect(page.getByRole("button", { name: "Confirm order", exact: true })).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("mobile-basket.png"), fullPage: true });
});

test("expired session preserves checkout until the same student signs in again", async ({ page }) => {
  await login(page, 8);
  await addMomo(page);
  let expired = true;
  const bodies: unknown[] = [];
  await page.route("**/api/orders", async route => {
    if (route.request().method() !== "POST") return route.continue();
    bodies.push(route.request().postDataJSON());
    if (expired) {
      expired = false;
      const me = await (await page.request.get("/api/auth/me")).json();
      await page.request.post("/api/auth/logout", { headers: { "X-CSRF-Token": me.csrf_token } });
      await route.fulfill({ status: 401, json: { detail: "Sign in to continue." } });
    }
    else await route.continue();
  });
  await page.getByRole("button", { name: "Confirm order", exact: true }).click();
  await expect(page).toHaveURL(/\/sign-in$/);
  await login(page, 8);
  await page.getByRole("button", { name: "Retry this order", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Order confirmed", exact: true })).toBeVisible();
  expect(bodies[0]).toEqual(bodies[1]);
});
