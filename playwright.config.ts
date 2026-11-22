import { defineConfig, devices } from "@playwright/test";

/**
 * Offline mode (`npm run test:e2e:offline`) runs only `@offline`-tagged specs
 * whose network boundaries are mocked. It never needs a running app or an
 * external Stellar endpoint, so a single browser project is enough.
 */
const OFFLINE = process.env.E2E_OFFLINE === "1";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: OFFLINE ? 0 : process.env.CI ? 1 : 0,
  workers: OFFLINE ? 1 : process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? "blob" : [["html", { open: "never" }], ["list"]],
  use: {
    baseURL: process.env.E2E_BASE_URL || "http://localhost:3000",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "off",
    // The PWA service worker intercepts `/api/` fetches with its own client
    // fetch(), so Playwright's page.route() (used by the SSE mock) never sees
    // the request. Block it for E2E so network interception is deterministic.
    serviceWorkers: "block",
    // The app animates dialogs in (`animate-fade-in-up`) and smooth-scrolls the
    // page. Playwright can hit-test a target mid-animation and then see a
    // sibling "intercept pointer events" — worst on the small mobile viewport,
    // where dialogs are bottom sheets that scroll. Reduced motion switches both
    // off through the app's own `prefers-reduced-motion` rules.
    contextOptions: { reducedMotion: "reduce" },
  },
  projects: OFFLINE
    ? [
        {
          name: "offline-chromium",
          use: { ...devices["Desktop Chrome"] },
        },
      ]
    : [
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
  // No webServer block: start and prepare the app before running E2E.
  // See docs/E2E_TESTING.md for database, contract, and mocking requirements.
});
