import { test, expect } from "@playwright/test";

test("student session cookie survives reload and logout uses CSRF", async ({ page, context }) => {
  await page.goto("/sign-in");
  await page.getByLabel("Roll number", { exact: true }).fill("NCE-001");
  await page.getByLabel("Password", { exact: true }).fill("browser-test-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/menu$/);
  await page.getByRole("link", { name: "My account", exact: true }).click();
  await expect(page).toHaveURL(/\/account$/);
  await expect(page.getByText("NPR 450.00")).toBeVisible();
  await expect(page.getByText("NPR 880.00")).toBeVisible();
  const cookies = await context.cookies();
  expect(cookies.find(cookie => cookie.name === "campusdine_session")?.httpOnly).toBe(true);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Sujin Prajapati" })).toBeVisible();
  const logout = page.waitForResponse(response => response.url().endsWith("/api/auth/logout"));
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  expect((await logout).status()).toBe(204);
  await expect(page).toHaveURL(/\/sign-in$/);
  expect((await context.cookies()).find(cookie => cookie.name === "campusdine_session")).toBeUndefined();
});

test("pending enrollment error stays in the form", async ({ page }) => {
  await page.goto("/sign-in");
  await page.getByLabel("Roll number", { exact: true }).fill("NCE-002");
  await page.getByLabel("Password", { exact: true }).fill("browser-test-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("main").getByRole("alert")).toHaveText("Enrollment has not been approved.");
  await expect(page.getByRole("main").getByRole("alert")).toBeFocused();
});

for (const [role, username, heading] of [["Canteen staff", "counter", "Counter orders"], ["Admin", "accounts", "Students"]]) {
  test(`${role} sign-in selects the correct backend role`, async ({ page }) => {
    await page.goto("/sign-in");
    await page.getByRole("radio", { name: role, exact: true }).check();
    await page.getByLabel("Username", { exact: true }).fill(username);
    await page.getByLabel("Password", { exact: true }).fill("browser-test-password");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible();
  });
}

test("enrollment sends multipart fields and shows pending confirmation", async ({ page }) => {
  let submitted = "";
  await page.route("**/api/students/enroll", async route => {
    expect(route.request().headers()["content-type"]).toContain("multipart/form-data; boundary=");
    submitted = route.request().postDataBuffer()?.toString() ?? "";
    await route.fulfill({ status: 201, json: { name: "Sujin Prajapati", roll_no: "NCE/081/001", approval_status: "pending" } });
  });
  await page.goto("/enroll");
  await page.getByLabel("Full name", { exact: true }).fill("Sujin Prajapati");
  await page.getByLabel("Roll number", { exact: true }).fill("NCE/081/001");
  await page.getByLabel("Department", { exact: true }).fill("Computer Engineering");
  await page.getByLabel("Semester", { exact: true }).selectOption("3");
  await page.getByLabel("Email address", { exact: true }).fill("sujin@example.com");
  await page.getByLabel("Password", { exact: true }).fill("my canteen password");
  await page.getByLabel("Face photo", { exact: true }).setInputFiles({ name: "face.png", mimeType: "image/png", buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nDAAAAAASUVORK5CYII=", "base64") });
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Submit for approval" }).click();
  await expect(page.getByText("Awaiting admin approval")).toBeVisible();
  expect(submitted).toContain('name="face_photo"; filename="face.png"');
  expect(submitted).toContain('name="semester"');
  expect(submitted).not.toContain('name="face_consent"');
});

test("mobile layout, upload rejection and dark theme persist", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/enroll");
  await page.getByLabel("Face photo", { exact: true }).setInputFiles({ name: "bad.txt", mimeType: "text/plain", buffer: Buffer.from("not a face") });
  await expect(page.getByText("Choose a JPEG or PNG photo no larger than 5 MB.")).toBeVisible();
  await page.getByRole("button", { name: "Use dark theme" }).click();
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
