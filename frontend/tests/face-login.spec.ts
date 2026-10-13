import { test, expect, type Page } from "@playwright/test";

async function camera(page: Page) {
  await page.addInitScript(() => {
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", { configurable: true, value: async () => {
      const canvas = document.createElement("canvas"); canvas.width = 320; canvas.height = 240;
      const ctx = canvas.getContext("2d")!; ctx.fillStyle = "#abb"; ctx.fillRect(0, 0, 320, 240);
      const stream = canvas.captureStream(5);
      (window as unknown as { testCamera: MediaStream }).testCamera = stream;
      return stream;
    } });
  });
}

async function capture(page: Page) {
  await page.goto("/sign-in");
  await page.getByRole("button", { name: "Face login", exact: true }).click();
  await page.getByRole("button", { name: "Open camera", exact: true }).click();
  await expect.poll(() => page.locator("video").evaluate((v: HTMLVideoElement) => v.videoWidth)).toBe(320);
  await page.getByRole("button", { name: "Capture photo", exact: true }).click();
  await expect(page.getByAltText("Photo captured for sign-in")).toBeVisible();
}

test("face camera capture signs in, reloads and logs out with a real session", async ({ page }) => {
  await camera(page);
  // Image matching is covered in backend tests. Supply a real session here to
  // exercise browser cookie/session integration without biometrics in fixtures.
  await page.route("**/api/auth/face-login", async route => {
    expect(route.request().headers()["content-type"]).toContain("multipart/form-data");
    expect(route.request().postDataBuffer()?.toString()).toContain('name="face_photo"');
    const session = await page.request.post("/api/auth/login", { data: { role: "student", username: "NCE-001", password: "browser-test-password" } });
    expect(session.ok()).toBeTruthy();
    await route.fulfill({ status: 200, json: await session.json() });
  });
  await capture(page);
  expect(await page.evaluate(() => (window as unknown as { testCamera: MediaStream }).testCamera.getTracks().every(t => t.readyState === "ended"))).toBe(true);
  await page.getByRole("button", { name: "Sign in with this photo" }).click();
  await expect(page).toHaveURL(/\/menu$/);
  await page.reload();
  await page.getByRole("link", { name: "My account", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Sujin Prajapati" })).toBeVisible();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page).toHaveURL(/\/sign-in$/);
});

test("failed matching stays on login and password fallback succeeds", async ({ page }) => {
  await camera(page);
  await page.route("**/api/auth/face-login", route => route.fulfill({ status: 401, json: { detail: "Face login could not verify an approved student. Try again or use your roll number and password." } }));
  await capture(page);
  await page.getByRole("button", { name: "Sign in with this photo" }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText("could not verify");
  await expect(page.getByRole("main").getByRole("alert")).toBeFocused();
  await page.getByRole("button", { name: "Password login", exact: true }).click();
  await expect(page.getByRole("region", { name: "Student face login" })).toHaveCount(0);
  await page.getByLabel("Roll number", { exact: true }).fill("NCE-001");
  await page.getByLabel("Password", { exact: true }).fill("browser-test-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/menu$/);
});

test("camera denial provides password fallback, with no upload field", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", { configurable: true, value: async () => { throw new DOMException("Denied", "NotAllowedError"); } });
  });
  await page.goto("/sign-in");
  await page.getByRole("button", { name: "Face login", exact: true }).click();
  await expect(page.locator('input[type="file"]')).toHaveCount(0);
  await page.getByRole("button", { name: "Open camera", exact: true }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText("roll number and password");
  await page.getByRole("button", { name: "Password login", exact: true }).click();
  await expect(page.getByLabel("Password", { exact: true })).toBeVisible();
});

test("role change closes camera and staff/admin retain password login", async ({ page }) => {
  await camera(page);
  await page.goto("/sign-in");
  await page.getByRole("button", { name: "Face login", exact: true }).click();
  await page.getByRole("button", { name: "Open camera", exact: true }).click();
  await expect(page.getByRole("button", { name: "Capture photo", exact: true })).toBeVisible();
  await page.getByRole("radio", { name: "Canteen staff", exact: true }).check();
  expect(await page.evaluate(() => (window as unknown as { testCamera: MediaStream }).testCamera.getTracks().every(t => t.readyState === "ended"))).toBe(true);
  await expect(page.getByRole("button", { name: "Face login", exact: true })).toHaveCount(0);
  await expect(page.getByLabel("Username", { exact: true })).toBeVisible();
  await page.getByRole("radio", { name: "Admin", exact: true }).check();
  await expect(page.getByRole("button", { name: "Face login", exact: true })).toHaveCount(0);
});

test("disabled face login and unavailable methods lookup preserve password login", async ({ page }) => {
  await page.route("**/api/auth/methods", route => route.fulfill({ json: { student_face_login: false } }));
  await page.goto("/sign-in");
  await expect(page.getByLabel("Password", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Face login", exact: true })).toHaveCount(0);
  await page.route("**/api/auth/methods", route => route.fulfill({ status: 503, json: { detail: "Unavailable" } }));
  await page.reload();
  await expect(page.getByLabel("Password", { exact: true })).toBeVisible();
});

test("face login fits a mobile screen", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/sign-in");
  await page.getByRole("button", { name: "Face login", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Sign in with your face" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("face-login-mobile.png"), fullPage: true });
});
