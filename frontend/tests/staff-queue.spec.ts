import { test, expect, type Page, type WebSocketRoute } from "@playwright/test";
import type { Order } from "../src/lib/api";
async function staff(page: Page) {
  const response = await page.request.post("/api/auth/login", { data: { role: "staff", username: "queue-staff", password: "browser-test-password" } });
  expect(response.ok()).toBe(true);
  return response.json();
}
async function queue(page: Page) {
  await page.goto("/staff/queue");
  await expect(page.getByText("Live · all active orders synced", { exact: true })).toBeVisible();
}
async function create(page: Page, roll: string, csrf: string) {
  const student = await (await page.request.get(`/api/counter/students?roll_no=${roll}`)).json();
  const response = await page.request.post("/api/counter/orders", { headers: { "X-CSRF-Token": csrf }, data: { student_id: student.id, checkout_key: `queue-test-${roll}-order`, expected_total: 12000, items: [{ menu_item_id: 1, quantity: 1 }] } });
  expect(response.ok()).toBe(true); return response.json() as Promise<Order>;
}
const ticket = (page: Page, order: Order) => page.getByRole("article", { name: `Order ${order.id}, token ${order.token_number}, ${order.order_date}`, exact: true });
const column = (page: Page, name: string) => page.getByRole("region", { name, exact: true });
const fixture: Order = { id: 9001, student_id: 1, student_name: "Snapshot student", token_number: 1, order_date: "2026-09-20", created_at: "2026-09-20T06:00:00Z", status: "received", revision: 8, total_amount: 12000, payment_type: "wallet", items: [{ menu_item_id: 1, item_name: "Veg momo", quantity: 1, unit_price: 12000 }] };

test("real stream synchronizes new orders and all three transitions across staff screens", async ({ page, context }) => {
  const session = await staff(page); await queue(page);
  const second = await context.newPage(); await queue(second);
  const order = await create(page, "QUEUE-1", session.csrf_token);
  await expect(ticket(page, order)).toBeVisible(); await expect(ticket(second, order)).toBeVisible();
  let writes = 0;
  await page.route(`**/api/staff/orders/${order.id}/status`, async route => { writes++; await route.continue(); });
  await ticket(page, order).getByRole("button", { name: "Start preparing" }).evaluate((button: HTMLButtonElement) => { button.click(); button.click(); });
  await expect(column(second, "Preparing")).toContainText("Queue student 1");
  expect(writes).toBe(1);
  await ticket(second, order).getByRole("button", { name: "Mark ready" }).click();
  await expect(column(page, "Ready")).toContainText("Queue student 1");
  await ticket(page, order).getByRole("button", { name: "Mark collected" }).click();
  await expect(ticket(second, order)).toBeVisible();
  await ticket(page, order).getByRole("button", { name: "Confirm collection" }).click();
  await expect(ticket(page, order)).toHaveCount(0); await expect(ticket(second, order)).toHaveCount(0);
  const history = await (await page.request.get(`/api/orders/${order.id}/status-history`)).json();
  expect(history.map((row: { status: string }) => row.status)).toEqual(["received", "preparing", "ready", "collected"]);
  const profile = await (await page.request.get("/api/counter/students?roll_no=QUEUE-1")).json();
  expect(profile.wallet_balance).toBe(12000); expect(profile.credit_balance).toBe(0);
  await second.close();
});

test("lost committed response survives reload and retries the original transition once", async ({ page }) => {
  const session = await staff(page); const order = await create(page, "QUEUE-2", session.csrf_token); await queue(page);
  const bodies: unknown[] = [];
  await page.route(`**/api/staff/orders/${order.id}/status`, async route => { bodies.push(route.request().postDataJSON()); const response = await route.fetch(); if (bodies.length === 1) await route.abort("failed"); else await route.fulfill({ response }); });
  await ticket(page, order).getByRole("button", { name: "Start preparing" }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText("Result unconfirmed");
  await expect(column(page, "Preparing")).toContainText("Queue student 2");
  await page.reload();
  await expect(page.getByRole("button", { name: `Retry update for order ${order.id}`, exact: true })).toBeEnabled();
  await page.getByRole("button", { name: `Retry update for order ${order.id}`, exact: true }).click();
  await expect(page.getByRole("region", { name: "Saved status updates" })).toHaveCount(0);
  expect(bodies).toEqual([{ expected_status: "received", status: "preparing" }, { expected_status: "received", status: "preparing" }]);
  const history = await (await page.request.get(`/api/orders/${order.id}/status-history`)).json();
  expect(history.map((row: { status: string }) => row.status)).toEqual(["received", "preparing"]);
  await expect(ticket(page, order).getByRole("button", { name: "Mark ready" })).toBeEnabled();
});

test("stale staff update refreshes the ticket without skipping a stage", async ({ page }) => {
  const session = await staff(page); const order = await create(page, "QUEUE-3", session.csrf_token); await queue(page);
  await page.route(`**/api/staff/orders/${order.id}/status`, async route => {
    for (const [expected_status, status] of [["received", "preparing"], ["preparing", "ready"]]) {
      const response = await page.request.patch(`/api/staff/orders/${order.id}/status`, { headers: { "X-CSRF-Token": session.csrf_token }, data: { expected_status, status } }); expect(response.ok()).toBe(true);
    }
    await route.continue();
  });
  await ticket(page, order).getByRole("button", { name: "Start preparing" }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText("being refreshed");
  await expect(ticket(page, order).getByRole("button", { name: "Mark collected" })).toBeEnabled();
  expect((await (await page.request.get(`/api/orders/${order.id}`)).json()).status).toBe("ready");
});

test("revision ordering retains collected tombstones and reconnect replaces the snapshot", async ({ page }) => {
  await staff(page); let socket: WebSocketRoute; let connections = 0; let pauseSnapshot = false;
  const other = { ...fixture, id: 9002, student_name: "Second snapshot student", order_date: "2026-09-21", created_at: "2026-09-21T06:00:00Z", revision: 9 };
  await page.routeWebSocket("**/api/ws/orders", ws => { socket = ws; connections++; if (!pauseSnapshot) ws.send(JSON.stringify({ type: "snapshot", role: "staff", watermark: 10, orders: [fixture, other] })); });
  await queue(page);
  const update = (order: Order) => socket.send(JSON.stringify({ type: "order.updated", order }));
  update({ ...fixture, status: "collected", revision: 14 });
  update({ ...fixture, status: "preparing", revision: 13 });
  update({ ...other, status: "ready", revision: 12 });
  update({ ...fixture, id: 9003, revision: 10 });
  await expect(ticket(page, fixture)).toHaveCount(0);
  await expect(column(page, "Ready")).toContainText("Second snapshot student");
  await expect(page.getByRole("article")).toHaveCount(1);
  pauseSnapshot = true; const beforeReconnect = connections;
  await socket!.close({ code: 1013 });
  await expect(ticket(page, other).getByRole("button", { name: "Mark collected" })).toBeDisabled();
  await expect.poll(() => connections).toBeGreaterThan(beforeReconnect);
  await expect(ticket(page, other).getByRole("button", { name: "Mark collected" })).toBeDisabled();
  socket!.send(JSON.stringify({ type: "snapshot", role: "staff", watermark: 20, orders: [] }));
  await expect(page.getByRole("heading", { name: "The kitchen is caught up." })).toBeVisible();
  update({ ...fixture, revision: 19 });
  await expect(page.getByRole("article")).toHaveCount(0);
});

test("previous-day tokens remain distinct and the board fits desktop and mobile dark mode", async ({ page }, testInfo) => {
  await staff(page);
  await page.routeWebSocket("**/api/ws/orders", ws => ws.send(JSON.stringify({ type: "snapshot", role: "staff", watermark: 10, orders: [fixture, { ...fixture, id: 9002, order_date: "2026-09-21", status: "preparing", revision: 9 }, { ...fixture, id: 9003, order_date: "2026-09-22", status: "ready", revision: 10 }] })));
  await queue(page); await expect(page.getByRole("article")).toHaveCount(3);
  await page.screenshot({ path: testInfo.outputPath("queue-desktop.png"), fullPage: true });
  await page.getByLabel("Find a ticket").fill("2026-09-21");
  await expect(page.getByRole("article")).toHaveCount(1);
  await page.getByLabel("Find a ticket").fill("");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Use dark theme" }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("queue-mobile.png"), fullPage: true });
});

test("blocked storage prevents status writes and revoked sessions leave the queue", async ({ page }) => {
  const session = await staff(page); const order = await create(page, "QUEUE-4", session.csrf_token); await queue(page);
  let writes = 0; await page.route("**/api/staff/orders/*/status", async route => { writes++; await route.continue(); });
  await page.evaluate(() => { Object.defineProperty(sessionStorage, "setItem", { value: () => { throw new Error("Blocked storage"); } }); });
  await ticket(page, order).getByRole("button", { name: "Start preparing" }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText("No status change was sent"); expect(writes).toBe(0);
  const response = await page.request.post("/api/auth/logout", { headers: { "X-CSRF-Token": session.csrf_token } }); expect(response.ok()).toBe(true);
  await expect(page).toHaveURL(/\/sign-in/);
});
