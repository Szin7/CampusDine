import { test, expect, type Page } from "@playwright/test";
async function staff(page: Page) {
  await page.goto("/sign-in");
  await page.getByRole("radio", { name: "Canteen staff", exact: true }).check();
  await page.getByLabel("Username", { exact: true }).fill("counter");
  await page.getByLabel("Password", { exact: true }).fill("browser-test-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Counter orders", exact: true })).toBeVisible();
}
async function lookup(page: Page, roll: string) {
  await page.getByLabel("Student roll number", { exact: true }).fill(roll);
  await page.getByRole("button", { name: "Look up student", exact: true }).click();
  await expect(page.getByRole("region", { name: "Identified student" })).toContainText(roll);
}
async function add(page: Page) {
  await page.getByRole("button", { name: "Confirm student details", exact: true }).click();
  await page.getByRole("button", { name: "Add Veg momo to basket", exact: true }).click();
}

test("roll lookup requires staff confirmation and wallet checkout returns a real token", async ({ page }) => {
  await staff(page); await lookup(page, "COUNTER-1");
  await expect(page.getByRole("button", { name: "Add Veg momo to basket" })).toBeDisabled();
  await add(page);
  await expect(page.locator("#basket")).toContainText("from the student’s wallet");
  await page.getByRole("button", { name: "Confirm order", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Order confirmed" })).toBeVisible();
  await expect(page.locator("#basket")).toContainText("Counter student 1");
  const profile = await (await page.request.get("/api/counter/students?roll_no=COUNTER-1")).json();
  expect(profile.wallet_balance).toBe(0);
  await page.getByRole("button", { name: "Next student", exact: true }).click();
  await expect(page.getByLabel("Student roll number", { exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "Identified student" })).toHaveCount(0);
});

test("full credit fallback leaves wallet untouched and changing student discards the basket", async ({ page }) => {
  await staff(page); await lookup(page, "COUNTER-2"); await add(page);
  await page.getByRole("button", { name: "Add one Veg momo", exact: true }).click();
  await expect(page.locator("#basket")).toContainText("full NPR 240.00 will be added to credit");
  await page.getByRole("button", { name: "Change student", exact: true }).click();
  await expect(page.getByRole("button", { name: "Confirm order", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Keep this student" }).click();
  await page.getByRole("button", { name: "Confirm order", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Order confirmed" })).toBeVisible();
  const profile = await (await page.request.get("/api/counter/students?roll_no=COUNTER-2")).json();
  expect(profile.wallet_balance).toBe(5000); expect(profile.credit_balance).toBe(24000);
  await page.getByRole("button", { name: "Next student" }).click();
  await lookup(page, "COUNTER-4"); await add(page);
  await page.getByRole("button", { name: "Change student" }).click();
  await page.getByRole("button", { name: "Discard and change student" }).click();
  await lookup(page, "COUNTER-5");
  await expect(page.locator("#basket")).toContainText("Add something from the menu");
});

test("lost staff checkout survives reload and sign-in with the identical student and request", async ({ page }) => {
  await staff(page); await lookup(page, "COUNTER-3"); await add(page);
  const bodies: unknown[] = [];
  await page.route("**/api/counter/orders", async route => { bodies.push(route.request().postDataJSON()); const response = await route.fetch(); if (bodies.length === 1) await route.abort("failed"); else await route.fulfill({ response }); });
  await page.getByRole("button", { name: "Confirm order", exact: true }).click();
  await expect(page.locator("#basket").getByRole("alert")).toContainText("unconfirmed");
  await expect(page.getByRole("button", { name: "Change student" })).toHaveCount(0);
  await page.context().clearCookies(); await page.reload();
  await staff(page);
  await expect(page.getByRole("region", { name: "Identified student" })).toContainText("COUNTER-3");
  await page.getByRole("button", { name: "Retry this order", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Order confirmed" })).toBeVisible();
  expect(bodies[0]).toEqual(bodies[1]);
  const profile = await (await page.request.get("/api/counter/students?roll_no=COUNTER-3")).json(); expect(profile.wallet_balance).toBe(0);
  await page.reload(); await expect(page.getByRole("heading", { name: "Order confirmed" })).toBeVisible();
});

test("camera denial, ambiguous photo and invalid rolls never choose or charge a student", async ({ page }) => {
  await page.addInitScript(() => { Object.defineProperty(navigator, "mediaDevices", { value: { getUserMedia: async () => { throw new Error("Permission denied"); } } }); });
  await staff(page); await page.getByRole("button", { name: "Open camera" }).click();
  await expect(page.getByRole("region", { name: "Face identification" }).getByRole("alert")).toContainText("Camera could not be opened");
  await page.getByLabel("Use a face photo", { exact: true }).setInputFiles({ name: "invalid.txt", mimeType: "text/plain", buffer: Buffer.from("not a photo") });
  await expect(page.getByRole("region", { name: "Face identification" }).getByRole("alert")).toContainText("JPEG or PNG");
  await page.route("**/api/counter/identify", route => route.fulfill({ json: { status: "ambiguous", student: null, message: "More than one student matched. Use the roll-number lookup." } }));
  await page.getByLabel("Use a face photo", { exact: true }).setInputFiles({ name: "face.png", mimeType: "image/png", buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=", "base64") });
  await page.getByRole("button", { name: "Identify student", exact: true }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText("More than one student matched");
  await expect(page.getByRole("region", { name: "Identified student" })).toHaveCount(0);
  await page.getByLabel("Student roll number", { exact: true }).fill("NCE-002"); await page.getByRole("button", { name: "Look up student" }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText("No active, approved student");
});

test("synthetic camera capture stops its tracks and a matched response requires confirmation", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "mediaDevices", { value: { getUserMedia: async () => {
      const canvas = document.createElement("canvas"); canvas.width = 320; canvas.height = 240;
      const context = canvas.getContext("2d")!; context.fillStyle = "#38523e"; context.fillRect(0, 0, 320, 240);
      const stream = canvas.captureStream(10);
      (window as unknown as { counterTracks: MediaStreamTrack[] }).counterTracks = stream.getTracks();
      const timer = setInterval(() => { if (stream.getTracks().every(track => track.readyState === "ended")) clearInterval(timer); else context.fillRect(0, 0, 320, 240); }, 100);
      return stream;
    } } });
  });
  await staff(page);
  const student = await (await page.request.get("/api/counter/students?roll_no=COUNTER-4")).json();
  let posted = false;
  await page.route("**/api/counter/identify", async route => { posted = route.request().postDataBuffer()!.includes(Buffer.from('name="face_photo"')); await route.fulfill({ json: { status: "matched", student, message: "Student identified" } }); });
  await page.getByRole("button", { name: "Open camera" }).click();
  await expect.poll(() => page.locator("video").evaluate((video: HTMLVideoElement) => video.videoWidth)).toBeGreaterThan(0);
  await page.getByRole("button", { name: "Capture photo" }).click();
  await expect(page.getByRole("img", { name: "Photo selected for identification" })).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { counterTracks: MediaStreamTrack[] }).counterTracks.every(track => track.readyState === "ended"))).toBe(true);
  await page.getByRole("button", { name: "Identify student", exact: true }).click();
  expect(posted).toBe(true);
  await expect(page.getByRole("region", { name: "Identified student" })).toContainText("COUNTER-4");
  await expect(page.getByRole("button", { name: "Add Veg momo to basket" })).toBeDisabled();
});

test("price rejection requires refreshed student confirmation; layouts fit", async ({ page, browser }, testInfo) => {
  await staff(page); await lookup(page, "COUNTER-4"); await add(page);
  const admin = await browser.newContext();
  const session = await (await admin.request.post("http://localhost:3000/api/auth/login", { data: { role: "admin", username: "reports-admin", password: "browser-test-password" } })).json();
  const headers = { "X-CSRF-Token": session.csrf_token };
  try {
    await admin.request.patch("http://localhost:3000/api/admin/menu/1", { headers, data: { price: 12500 } });
    await page.getByRole("button", { name: "Confirm order", exact: true }).click();
    await expect(page.locator("#basket").getByRole("alert")).toContainText("Review");
    await expect(page.getByRole("button", { name: "Confirm order", exact: true })).toBeDisabled();
    await page.getByRole("button", { name: "Refresh student" }).click();
    await expect(page.getByRole("button", { name: "Confirm student details" })).toBeEnabled();
    await page.getByRole("button", { name: "Confirm student details" }).click();
    await expect(page.locator("#basket")).toContainText("NPR 125.00");
    await expect(page.getByRole("button", { name: "Confirm order", exact: true })).toBeDisabled();
    await page.screenshot({ path: testInfo.outputPath("counter-desktop.png"), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 }); await page.getByRole("button", { name: "Use dark theme" }).click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath("counter-mobile.png"), fullPage: true });
  } finally { await admin.request.patch("http://localhost:3000/api/admin/menu/1", { headers, data: { price: 12000 } }); await admin.close(); }
});

test("unavailable storage prevents checkout and rapid clicks create one order", async ({ page }) => {
  await staff(page); await lookup(page, "COUNTER-5"); await add(page);
  let sent = 0;
  await page.route("**/api/counter/orders", async route => { sent++; await route.continue(); });
  await page.evaluate(() => { Object.defineProperty(sessionStorage, "setItem", { configurable: true, value: () => { throw new Error("Blocked storage"); } }); });
  await page.getByRole("button", { name: "Confirm order", exact: true }).click();
  await expect(page.locator("#basket").getByRole("alert")).toContainText("No order was sent");
  expect(sent).toBe(0);
  await page.reload(); await lookup(page, "COUNTER-5"); await add(page);
  await page.getByRole("button", { name: "Confirm order", exact: true }).evaluate((button: HTMLButtonElement) => { button.click(); button.click(); });
  await expect(page.getByRole("heading", { name: "Order confirmed" })).toBeVisible();
  expect(sent).toBe(1);
});
