import { test, expect, type Page } from "@playwright/test";

async function admin(page: Page) {
  await page.goto("/sign-in");
  await page.getByRole("radio", { name: "Admin", exact: true }).check();
  await page.getByLabel("Username", { exact: true }).fill("accounts");
  await page.getByLabel("Password", { exact: true }).fill("browser-test-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Students", exact: true })).toBeVisible();
}

test("approval removes pending enrollment and rejection requires confirmation", async ({ page }) => {
  await admin(page);
  await page.getByRole("button", { name: "View student REVIEW-001", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Approve enrollment", exact: true }).click();
  await dialog.getByRole("button", { name: "Confirm", exact: true }).click();
  await expect(dialog.getByRole("status")).toHaveText("Enrollment approved.");
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await expect(page.getByRole("button", { name: "View student REVIEW-001", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "View student REVIEW-002", exact: true }).click();
  await dialog.getByRole("button", { name: "Reject enrollment", exact: true }).click();
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(dialog.getByText("Pending review", { exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "Reject enrollment", exact: true }).click();
  await dialog.getByRole("button", { name: "Confirm", exact: true }).click();
  await expect(dialog.getByRole("status")).toHaveText("Enrollment rejected.");
});

test("editing and suspension preserve balances and revoke the student's session", async ({ page, browser }) => {
  const student = await browser.newContext();
  const login = await student.request.post("http://localhost:3000/api/auth/login", { data: { role: "student", username: "MANAGE-001", password: "browser-test-password" } });
  expect(login.ok()).toBe(true);
  await admin(page);
  await page.getByRole("button", { name: "All students", exact: true }).click();
  await page.getByLabel("Find a student").fill("MANAGE-001");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await page.getByRole("button", { name: "View student MANAGE-001", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Full name").fill("Pratik Maharjan");
  await dialog.getByRole("button", { name: "Save details" }).click();
  await expect(dialog.getByRole("status")).toHaveText("Student details saved.");
  await expect(dialog.getByText("NPR 100.00", { exact: true })).toBeVisible();
  await dialog.getByLabel("Email", { exact: true }).fill("sujin@example.com");
  await dialog.getByRole("button", { name: "Save details" }).click();
  await expect(dialog.getByRole("alert")).toContainText("already registered");
  await dialog.getByRole("button", { name: "Suspend account", exact: true }).click();
  await dialog.getByRole("button", { name: "Confirm", exact: true }).click();
  await expect(dialog.getByText("Account suspended", { exact: true })).toBeVisible();
  expect((await student.request.get("http://localhost:3000/api/auth/me")).status()).toBe(401);
  await dialog.getByRole("button", { name: "Reactivate account", exact: true }).click();
  await dialog.getByRole("button", { name: "Confirm", exact: true }).click();
  await expect(dialog.getByText("Account enabled", { exact: true })).toBeVisible();
  expect((await student.request.get("http://localhost:3000/api/auth/me")).status()).toBe(401);
  await student.close();
});

test("missing face enrollment stays pending and responsive review supports Escape", async ({ page }, testInfo) => {
  await admin(page);
  await page.screenshot({ path: testInfo.outputPath("students-desktop.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Use dark theme" }).click();
  await page.getByRole("button", { name: "View student NCE-002", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Approve enrollment", exact: true }).click();
  await dialog.getByRole("button", { name: "Confirm", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("valid enrollment face photo");
  await expect(dialog.getByText("Pending review", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("students-mobile.png"), fullPage: true });
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
});
