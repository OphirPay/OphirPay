import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  /* Existing global settings ... */
  use: {
    /* Existing default fixtures ... */
    // Keep service workers blocked for the main suite
    serviceWorkers: 'block',
  },

  /* Existing projects ... */
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
    },

    // New project dedicated to service‑worker offline tests
    {
      name: 'sw-offline',
      testMatch: /e2e\/sw-offline\.spec\.ts/,
      use: {
        // Allow service workers for this project
        serviceWorkers: 'allow',
        // Inherit other defaults (e.g., baseURL, headless)
      },
    },
  ],

  /* Other config options (timeouts, retries, etc.) */
});
