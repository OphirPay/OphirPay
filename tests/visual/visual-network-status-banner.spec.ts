// SPDX-License-Identifier: MIT
//
// Visual regression for the Soroban RPC status banner.
//
// The banner is mounted from `AppShell`, so every page can show it. These
// tests intercept `/api/health` and pin the theme, then capture the banner in
// each state that has distinct copy/layout:
//
//   • slow RPC      — latency above the 3000ms threshold
//   • failover RPC  — a 429 makes the active fallback provider visible
//   • healthy       — the banner must not render at all
//
// Baselines live in `tests/visual/__screenshots__/` and are regenerated with
// `npm run test:visual:update` (light and dark).

import { test, expect, type Page } from "@playwright/test";

const THEME_STORAGE_KEY = "ophirpay-theme";
const PRIMARY = "https://soroban-testnet.stellar.org:443";
const FALLBACK = "https://rpc-futurenet.stellar.org:443";
const MAX_DIFF_PIXEL_RATIO = 0.001;

function healthPayload({
  latencyMs,
  activeEndpoint = PRIMARY,
  usingFallback = false,
}: {
  latencyMs: number;
  activeEndpoint?: string;
  usingFallback?: boolean;
}) {
  return {
    success: true,
    data: {
      status: "degraded",
      services: {
        stellar: {
          network: "TESTNET",
          rpcUrl: PRIMARY,
          rpc: { status: "ok", latencyMs },
        },
      },
      rpcFailover: {
        activeEndpoint,
        primaryEndpoint: PRIMARY,
        activeProviderName: new URL(activeEndpoint).host,
        usingFallback,
      },
    },
  };
}

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

async function mockHealth(
  page: Page,
  body: unknown,
  status = 200
): Promise<void> {
  await page.route("**/api/health**", async (route) => {
    await route.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify(body),
    });
  });
}

test.describe("Visual regression: network status banner", () => {
  test("slow RPC shows the latency banner", async ({ page }, testInfo) => {
    const scheme = schemeFor(testInfo.project.name);
    await pinTheme(page, scheme);
    await mockHealth(page, healthPayload({ latencyMs: 5200 }));

    await page.goto("/");
    const banner = page.getByTestId("network-status-banner");
    await expect(banner).toBeVisible({ timeout: 15000 });
    await expect(banner).toContainText("Stellar network is slow");
    await expect(page.locator("html")).toHaveAttribute("data-theme", scheme);

    await expect(banner).toHaveScreenshot(
      `network-status-banner-slow-${scheme}`,
      {
        maxDiffPixelRatio: MAX_DIFF_PIXEL_RATIO,
        animations: "disabled",
      }
    );
  });

  test("rate-limited RPC shows the failover provider banner", async ({
    page,
  }, testInfo) => {
    const scheme = schemeFor(testInfo.project.name);
    await pinTheme(page, scheme);
    await mockHealth(page, { success: false }, 429);

    await page.goto("/");
    const banner = page.getByTestId("network-status-banner");
    await expect(banner).toBeVisible({ timeout: 15000 });
    await expect(banner).toContainText("Stellar RPC is unavailable");
    await expect(page.locator("html")).toHaveAttribute("data-theme", scheme);

    await expect(banner).toHaveScreenshot(
      `network-status-banner-unavailable-${scheme}`,
      {
        maxDiffPixelRatio: MAX_DIFF_PIXEL_RATIO,
        animations: "disabled",
      }
    );
  });

  test("healthy RPC renders no banner", async ({ page }, testInfo) => {
    const scheme = schemeFor(testInfo.project.name);
    await pinTheme(page, scheme);
    await mockHealth(
      page,
      healthPayload({ latencyMs: 85, activeEndpoint: FALLBACK, usingFallback: true })
    );

    await page.goto("/");
    await expect(page.locator("main")).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId("network-status-banner")).toHaveCount(0);
  });
});
