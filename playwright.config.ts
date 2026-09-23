import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  // Generate HTML report without auto-opening browser, and list reporter for terminal output.
  reporter: [["html", { open: "never" }], ["list"]],
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
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "firefox",
      use: { ...devices["Desktop Firefox"] },
    },
    {
      name: "mobile-chrome",
      use: { ...devices["Pixel 5"] },
    },
  ],
  // Intentionally no `webServer` block — E2E runs against a live Vercel deployment
  // or local dev server. Running `npm run test:e2e` requires a server already
  // listening on E2E_BASE_URL (defaults to http://localhost:3000 for local dev).
});
