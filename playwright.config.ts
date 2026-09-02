import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  // In CI the suite is sharded across parallel runners; each shard emits a
  // blob report that the `e2e-report` job merges into a single combined
  // report (see .github/workflows/ci.yml). Locally the html + list reporters
  // behave as before.
  reporter: process.env.CI
    ? [["blob", { outputDir: "blob-report" }], ["html", { open: "never" }], ["list"]]
    : [["html", { open: "never" }], ["list"]],
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
  // No webServer — E2E runs against live Vercel deployment.
  // Set E2E_BASE_URL env var to override (default: localhost for local dev).
});
