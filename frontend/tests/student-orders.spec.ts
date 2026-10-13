import { test, expect, type Page, type WebSocketRoute } from "@playwright/test";
import type { Order } from "../src/lib/api";
async function login(page: Page, username = "TRACK-1", role = "student") {
  const response = await page.request.post("/api/auth/login", { data: { role, username, password: "browser-test-password" } });
  expect(response.ok()).toBe(true); return response.json();
}
async function tracker(page: Page) {
  await page.goto("/orders");
  await expect(page.getByText("Live · your orders are synced", { exact: true })).toBeVisible();
}
const card = (page: Page, order: Order) => page.getByRole("article", { name: `Order ${order.id}, token ${order.token_number}, ${order.order_date}`, exact: true });
const fixture: Order = { id: 9001, student_id: 1, student_name: "Tracker student", token_number: 1, order_date: "2026-09-20", created_at: "2026-09-20T06:00:00Z", status: "received", revision: 8, total_amount: 12000, payment_type: "wallet", items: [{ menu_item_id: 1, item_name: "Veg momo", quantity: 1, unit_price: 12000 }] };

test("checkout receipt opens live progress and real staff actions reach collected", async ({ page, browser }) => {
  await login(page); await page.goto("/menu");
  await page.getByRole("button", { name: "Add Veg momo to basket" }).click();
  await page.getByRole("button", { name: "Confirm order", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Order confirmed" })).toBeVisible();
  await page.getByRole("link", { name: "Track my orders" }).click();
  await expect(page.getByText("Live · your orders are synced", { exact: true })).toBeVisible();
  const order: Order = (await (await page.request.get("/api/orders")).json())[0];
  await expect(card(page, order).locator('[aria-current="step"]')).toContainText("Received");
  await card(page, order).getByText("Order details · NPR 120.00", { exact: true }).click();
  await expect(card(page, order)).toContainText("1 × Veg momo");
  await expect(card(page, order)).toContainText("Paid from your wallet");
  const staff = await browser.newContext({ baseURL: "http://localhost:3000" });
  try {
    const staffPage = await staff.newPage(); await login(staffPage, "queue-staff", "staff"); await staffPage.goto("/staff/queue");
    await card(staffPage, order).getByRole("button", { name: "Start preparing" }).click();
    await expect(card(page, order).locator('[aria-current="step"]')).toContainText("Preparing");
    await card(staffPage, order).getByRole("button", { name: "Mark ready" }).click();
    await expect(card(page, order).getByRole("heading", { name: "Ready for collection" })).toBeVisible();
    await expect(page.getByText("1 order is ready for collection.", { exact: true })).toBeVisible();
    await card(staffPage, order).getByRole("button", { name: "Mark collected" }).click();
    await card(staffPage, order).getByRole("button", { name: "Confirm collection" }).click();
    await expect(page.getByRole("region", { name: "Active orders" }).getByRole("article")).toHaveCount(0);
    await expect(page.getByRole("region", { name: "Recently collected" }).getByRole("article")).toHaveCount(1);
    await expect(card(page, order).locator('[aria-current="step"]')).toContainText("Collected");
    await page.reload(); await expect(card(page, order)).toBeVisible();
    const wallet = await (await page.request.get("/api/wallet")).json(); expect(wallet.wallet_balance).toBe(12000); expect(wallet.credit_balance).toBe(0);
  } finally { await staff.close(); }
});

test("counter orders arrive only for their owner and students cannot advance status", async ({ page, browser }) => {
  const session = await login(page, "TRACK-2");
  const frames: string[] = []; page.on("websocket", ws => { if (ws.url().includes("/api/ws/orders")) ws.on("framereceived", frame => frames.push(String(frame.payload))); });
  await tracker(page); await expect(page.getByRole("heading", { name: "No active orders." })).toBeVisible();
  const staff = await browser.newContext({ baseURL: "http://localhost:3000" });
  try {
    const staffPage = await staff.newPage(); const staffSession = await login(staffPage, "queue-staff", "staff");
    const orders: Order[] = [];
    for (const number of [3, 2]) {
      const student = await (await staff.request.get(`/api/counter/students?roll_no=TRACK-${number}`)).json();
      const response = await staff.request.post("/api/counter/orders", { headers: { "X-CSRF-Token": staffSession.csrf_token }, data: { student_id: student.id, checkout_key: `tracker-counter-order-${number}`, expected_total: 12000, items: [{ menu_item_id: 1, quantity: 1 }] } }); expect(response.ok()).toBe(true); orders.push(await response.json());
    }
    await expect(card(page, orders[1])).toBeVisible(); await expect(page.getByRole("article")).toHaveCount(1);
    expect(frames.join(" ")).not.toContain("Tracker student 3");
    expect((await page.request.get(`/api/orders/${orders[0].id}`)).status()).toBe(404);
    expect((await page.request.get(`/api/orders/${orders[0].id}/status-history`)).status()).toBe(404);
    expect((await page.request.patch(`/api/staff/orders/${orders[1].id}/status`, { headers: { "X-CSRF-Token": session.csrf_token }, data: { expected_status: "received", status: "preparing" } })).status()).toBe(403);
    await page.reload(); await expect(page.getByRole("article")).toHaveCount(1); expect(frames.join(" ")).not.toContain("Tracker student 3");
    expect((await page.request.post("/api/auth/logout", { headers: { "X-CSRF-Token": session.csrf_token } })).ok()).toBe(true);
    await expect(page).toHaveURL(/\/sign-in/);
  } finally { await staff.close(); }
});

test("all active orders and only twenty recent collected tickets stay distinct and responsive", async ({ page }, testInfo) => {
  await login(page, "TRACK-4");
  const orders = [fixture, { ...fixture, id: 9002, status: "preparing", order_date: "2026-09-21", revision: 9 }, { ...fixture, id: 9003, status: "ready", payment_type: "credit", order_date: "2026-09-22", created_at: "2026-09-22T06:00:00Z", revision: 10 }, ...Array.from({ length: 22 }, (_, n) => ({ ...fixture, id: 8000 + n, status: "collected", revision: n + 11 }))];
  await page.routeWebSocket("**/api/ws/orders", ws => ws.send(JSON.stringify({ type: "snapshot", role: "student", watermark: 100, orders })));
  await tracker(page);
  await expect(page.getByRole("region", { name: "Active orders" }).getByRole("article")).toHaveCount(3);
  await expect(page.getByRole("region", { name: "Recently collected" }).getByRole("article")).toHaveCount(20);
  await expect(card(page, { ...fixture, id: 8000 })).toHaveCount(0); await expect(card(page, { ...fixture, id: 8021 })).toBeVisible();
  const ready = card(page, orders[2] as Order); await ready.locator("summary").click(); await expect(ready).toContainText("See Wallet & credit for current dues");
  await expect(ready).toContainText("22 Sept 2026, 11:45");
  await page.evaluate(() => scrollTo(0, 0));
  await page.screenshot({ path: testInfo.outputPath("orders-desktop.png"), fullPage: false });
  await page.getByRole("region", { name: "Active orders" }).screenshot({ path: testInfo.outputPath("orders-active-desktop.png") });
  await page.setViewportSize({ width: 390, height: 844 }); await page.getByRole("button", { name: "Use dark theme" }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("orders-mobile.png"), fullPage: false });
  await ready.scrollIntoViewIfNeeded(); await page.screenshot({ path: testInfo.outputPath("orders-ready-mobile.png"), fullPage: false });
  await page.setViewportSize({ width: 320, height: 780 }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("disconnect labels old status and a fresh snapshot replaces it without stale regression", async ({ page }) => {
  await login(page, "TRACK-4"); let socket: WebSocketRoute; let connections = 0; let pause = false;
  const ready = { ...fixture, status: "ready", revision: 10 };
  await page.routeWebSocket("**/api/ws/orders", ws => { socket = ws; connections++; if (!pause) ws.send(JSON.stringify({ type: "snapshot", role: "student", watermark: 10, orders: [ready] })); });
  await tracker(page); await expect(card(page, fixture).getByRole("heading", { name: "Ready for collection" })).toBeVisible();
  pause = true; const previous = connections; await socket!.close({ code: 1013 });
  await expect(card(page, fixture)).toContainText("Ready · last known");
  await expect(card(page, fixture).getByRole("heading", { name: "Ready for collection" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "No active orders." })).toHaveCount(0);
  await expect.poll(() => connections).toBeGreaterThan(previous);
  socket!.send(JSON.stringify({ type: "snapshot", role: "student", watermark: 12, orders: [{ ...fixture, status: "collected", revision: 12 }] }));
  socket!.send(JSON.stringify({ type: "order.updated", order: { ...fixture, status: "preparing", revision: 11 } }));
  await expect(card(page, fixture).locator('[aria-current="step"]')).toContainText("Collected");
  await expect(page.getByRole("heading", { name: "No active orders." })).toBeVisible();
});

test("empty state, navigation, role guards and failed session checks recover", async ({ page }) => {
  await page.goto("/orders"); await expect(page).toHaveURL(/\/sign-in/);
  await login(page, "queue-staff", "staff"); await page.goto("/orders"); await expect(page).toHaveURL(/\/account/);
  await login(page, "TRACK-4");
  let fail = true; await page.route("**/api/auth/me", route => fail ? route.fulfill({ status: 503, json: { detail: "Account temporarily unavailable" } }) : route.continue());
  await page.goto("/orders"); await expect(page.getByRole("main").getByRole("alert")).toContainText("Account temporarily unavailable");
  await expect(page.getByRole("heading", { name: "No active orders." })).toHaveCount(0);
  fail = false; await page.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(page.getByRole("heading", { name: "No active orders." })).toBeVisible();
  await page.getByRole("navigation", { name: "Student navigation" }).getByRole("link", { name: "Menu", exact: true }).click();
  await page.getByRole("navigation", { name: "Student navigation" }).getByRole("link", { name: "My orders", exact: true }).click();
  await expect(page).toHaveURL(/\/orders/);
  await page.getByRole("navigation", { name: "Student navigation" }).getByRole("link", { name: "Wallet & credit" }).click();
  await expect(page.getByRole("link", { name: "My orders", exact: true })).toBeVisible();
});
