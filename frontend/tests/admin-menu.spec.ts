import { test, expect, type Page } from "@playwright/test";
async function admin(page: Page) {
  await page.goto("/sign-in");
  await page.getByRole("radio", { name: "Admin", exact: true }).check();
  await page.getByLabel("Username", { exact: true }).fill("accounts");
  await page.getByLabel("Password", { exact: true }).fill("browser-test-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("navigation", { name: "Admin navigation" }).getByRole("link", { name: "Menu", exact: true }).click();
  await expect(page.getByRole("button", { name: "Add a dish", exact: true })).toBeEnabled();
}
async function add(page: Page, name: string, price = "45.25") {
  await page.getByRole("button", { name: "Add a dish", exact: true }).click();
  await page.getByLabel("Dish name", { exact: true }).fill(name);
  await page.getByLabel("Category", { exact: true }).fill("Snacks");
  await page.getByLabel("Price (NPR)", { exact: true }).fill(price);
}
async function archive(page: Page, name: string) {
  await page.getByRole("button", { name: `Edit ${name}`, exact: true }).click();
  await page.getByRole("button", { name: "Archive dish", exact: true }).click();
  await page.getByRole("button", { name: "Confirm archive", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
}

test("create, price edit, sold out, archive and restore retain the original order", async ({ page, browser }) => {
  await admin(page);
  await add(page, "Aloo chop");
  await page.getByRole("button", { name: "Add dish", exact: true }).click();
  await expect(page.getByRole("row", { name: /Aloo chop/ })).toContainText("NPR 45.25");
  const items = await (await page.request.get("/api/admin/menu")).json();
  const dish = items.find((item: { name: string }) => item.name === "Aloo chop");
  expect(dish.price).toBe(4525);
  const student = await browser.newContext();
  const login = await (await student.request.post("http://localhost:3000/api/auth/login", { data: { role: "student", username: "MENU-001", password: "browser-test-password" } })).json();
  const orderResponse = await student.request.post("http://localhost:3000/api/orders", { headers: { "X-CSRF-Token": login.csrf_token }, data: { checkout_key: "menu-history-test", expected_total: 4525, items: [{ menu_item_id: dish.id, quantity: 1 }] } });
  expect(orderResponse.status()).toBe(201);
  const order = await orderResponse.json();
  await page.getByRole("button", { name: "Edit Aloo chop", exact: true }).click();
  await page.getByLabel("Price (NPR)", { exact: true }).fill("50.50");
  await page.getByRole("button", { name: "Save dish", exact: true }).click();
  await expect(page.getByRole("row", { name: /Aloo chop/ })).toContainText("NPR 50.50");
  await page.getByRole("switch", { name: "Available: Aloo chop", exact: true }).click();
  await expect(page.getByRole("switch", { name: "Available: Aloo chop", exact: true })).toHaveAttribute("aria-checked", "false");
  const rejected = await student.request.post("http://localhost:3000/api/orders", { headers: { "X-CSRF-Token": login.csrf_token }, data: { checkout_key: "menu-sold-out-test", expected_total: 5050, items: [{ menu_item_id: dish.id, quantity: 1 }] } });
  expect(rejected.status()).toBe(409);
  await archive(page, "Aloo chop");
  await expect(page.getByRole("button", { name: "Edit Aloo chop", exact: true })).toHaveCount(0);
  expect((await student.request.get(`http://localhost:3000/api/menu/${dish.id}`)).status()).toBe(404);
  const history = await (await student.request.get(`http://localhost:3000/api/orders/${order.id}`)).json();
  expect(history.total_amount).toBe(4525);
  expect(history.items[0].unit_price).toBe(4525);
  await page.getByRole("button", { name: "Archived dishes", exact: true }).click();
  await page.getByRole("button", { name: "Edit Aloo chop", exact: true }).click();
  await page.getByRole("button", { name: "Restore as sold out", exact: true }).click();
  await page.getByRole("button", { name: "Current menu", exact: true }).click();
  await expect(page.getByRole("switch", { name: "Available: Aloo chop", exact: true })).toHaveAttribute("aria-checked", "false");
  await archive(page, "Aloo chop");
  await student.close();
});

test("invalid decimal and a lost committed create response cannot silently duplicate a dish", async ({ page }) => {
  await admin(page);
  await add(page, "Sel roti", "1.005");
  await page.getByRole("button", { name: "Add dish", exact: true }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText("at most two decimal places");
  await page.getByLabel("Price (NPR)", { exact: true }).fill("35.00");
  let posts = 0;
  await page.route("**/api/admin/menu", async route => {
    if (route.request().method() !== "POST") return route.continue();
    posts++;
    await route.fetch();
    await route.abort("failed");
  });
  await page.getByRole("button", { name: "Add dish", exact: true }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText("result could not be confirmed");
  await expect(page.getByRole("button", { name: "Add dish", exact: true })).toBeDisabled();
  expect(posts).toBe(1);
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await expect(page.getByRole("row", { name: /Sel roti/ })).toHaveCount(1);
  await archive(page, "Sel roti");
});

test("menu errors are recoverable and desktop/tablet/mobile layouts fit", async ({ page }, testInfo) => {
  await admin(page);
  await page.screenshot({ path: testInfo.outputPath("admin-menu-desktop.png"), fullPage: true });
  await page.route("**/api/admin/menu?*", route => route.fulfill({ status: 503, json: { detail: "Menu temporarily unavailable" } }));
  await page.getByRole("button", { name: "Reload menu", exact: true }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText("Menu temporarily unavailable");
  await expect(page.getByRole("button", { name: "Add a dish", exact: true })).toBeDisabled();
  await page.unroute("**/api/admin/menu?*");
  await page.getByRole("button", { name: "Reload menu", exact: true }).click();
  await expect(page.getByRole("switch", { name: "Available: Veg momo", exact: true })).toBeVisible();
  for (const width of [820, 390]) {
    await page.setViewportSize({ width, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await page.getByRole("button", { name: "Use dark theme" }).click();
  await page.getByLabel("Find a dish").fill("momo");
  await page.screenshot({ path: testInfo.outputPath("admin-menu-mobile.png"), fullPage: true });
});
