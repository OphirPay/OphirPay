import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? "blob" : [["html", { open: "never" }], ["list"]],
  use: {
    baseURL: process.env.E2E_BASE_URL || "http://localhost:3000",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    // The PWA service worker intercepts `/api/` fetches with its own client
    // fetch(), so Playwright's page.route() (used by the SSE mock) never sees
    // the request. Block it for E2E so network interception is deterministic.
    serviceWorkers: "block",
  },
  projects: [
    {
      name: "chromium",
      testIgnore: /.*service-worker\.spec\.ts/,
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "firefox",
      testIgnore: /.*service-worker\.spec\.ts/,
      use: { ...devices["Desktop Firefox"] },
    },
    {
      name: "mobile-chrome",
      testIgnore: /.*service-worker\.spec\.ts/,
      use: { ...devices["Pixel 5"] },
    },
    {
      name: "service-worker",
      testMatch: /.*service-worker\.spec\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        serviceWorkers: "allow",
      },
    },
  ],
  // Note: playwright.config.ts intentionally has no webServer block.
  // Therefore, `npm run test:e2e` requires a server already listening on E2E_BASE_URL.
  // Set E2E_BASE_URL env var to override (default: localhost:3000 for local dev).
});
