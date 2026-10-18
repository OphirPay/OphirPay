// SPDX-License-Identifier: MIT
//
// Visual regression tests for RPC Network Degradation Status Banner (issue #1295).
//
// Covers:
//   - Visual banner appearance during degraded RPC network conditions
//   - Display of active RPC endpoint and estimated latency
//   - Theme compatibility (both visual-light and visual-dark)
//   - Horizontal layout integrity and non-intrusiveness

import { test, expect, type Page } from "@playwright/test";

const DESKTOP_VIEWPORT = { width: 1440, height: 900 };
const THEME_STORAGE_KEY = "ophirpay-theme";
const MAX_DIFF_PIXEL_RATIO = 0.005;

function schemeFor(projectName: string): "light" | "dark" {
  return projectName.endsWith("dark") ? "dark" : "light";
}

async function pinTheme(page: Page, scheme: "light" | "dark"): Promise<void> {
  await page.addInitScript(
    ({ key, value }) => {
      window.localStorage.setItem(key, value);
    },
    { key: THEME_STORAGE_KEY, value: scheme }
  );
}

test.describe("Visual regression: RPC health status banner (issue #1295)", () => {
  test.use({ viewport: DESKTOP_VIEWPORT });

  test("renders degraded RPC banner with active endpoint and estimated latency", async ({
    page,
  }, testInfo) => {
    const scheme = schemeFor(testInfo.project.name);
    await pinTheme(page, scheme);

    // Mock the health check API to simulate degraded conditions
    await page.route("**/api/health", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          data: {
            status: "degraded",
            services: {
              stellar: {
                network: "TESTNET",
                rpcUrl: "https://soroban-testnet.stellar.org:443",
                rpc: { status: "ok", latencyMs: 3450 },
              },
            },
            rpcFailover: {
              activeEndpoint: "https://soroban-testnet.stellar.org:443",
              primaryEndpoint: "https://soroban-testnet.stellar.org:443",
              usingFallback: false,
              failoverCount: 0,
              degraded: false,
            },
          },
        }),
      });
    });

    await page.goto("/");

    // Banner should be visible with status role
    const banner = page.locator('[data-testid="network-status-banner"]');
    await expect(banner).toBeVisible({ timeout: 10000 });
    await expect(banner).toHaveAttribute("role", "status");
    await expect(banner).toHaveAttribute("aria-live", "polite");

    // Must show active endpoint and latency
    await expect(banner.locator('[data-testid="active-endpoint"]')).toBeVisible();
    await expect(banner.locator('[data-testid="estimated-latency"]')).toBeVisible();

    // Layout check: banner must span viewport without causing unintended overflow
    const box = await banner.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThanOrEqual(1400);

    // Snapshot comparison for visual regression
    await expect(banner).toHaveScreenshot(`rpc-network-status-banner-${scheme}`, {
      maxDiffPixelRatio: MAX_DIFF_PIXEL_RATIO,
      animations: "disabled",
    });
  });
});
