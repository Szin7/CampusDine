import { test, expect } from "@playwright/test";

test("sign-in and enrollment fit desktop, tablet and mobile", async ({ page }, testInfo) => {
  for (const width of [1440, 820, 390]) {
    await page.setViewportSize({ width, height: 900 });
    for (const path of ["sign-in", "enroll"]) {
      await page.goto(`/${path}`);
      await page.evaluate(() => document.fonts.ready);
      await expect(page.getByRole("main")).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      if (width !== 820) await page.screenshot({ path: testInfo.outputPath(`${path}-${width}.png`), fullPage: true });
    }
  }
  await page.getByRole("button", { name: "Use dark theme" }).click();
  await page.screenshot({ path: testInfo.outputPath("enroll-dark-mobile.png"), fullPage: true });
});
