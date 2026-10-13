import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests", fullyParallel: false, workers: 1,
  use: { baseURL: "http://localhost:3000", trace: "retain-on-failure", launchOptions: process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH, args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"] } : {} },
  webServer: [
    { command: `${process.env.TEST_PYTHON ?? "../.venv/bin/python"} tests/backend_fixture.py`, url: "http://127.0.0.1:8000/health", reuseExistingServer: false, timeout: 60000 },
    { command: "npm run dev -- --hostname 127.0.0.1", url: "http://127.0.0.1:3000/sign-in", reuseExistingServer: false, timeout: 60000 },
  ],
});
