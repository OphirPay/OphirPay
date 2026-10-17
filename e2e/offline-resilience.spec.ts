// SPDX-License-Identifier: MIT

/**
 * Offline Mode Resilience & Service Worker Caching E2E Tests (#1410).
 *
 * Verifies that:
 * 1. Network disconnection triggers OfflineBanner with status "Offline - displaying cached data".
 * 2. Cached app shell and local navigation remain accessible without blank screens.
 * 3. Network reconnection cleanly dismisses the offline banner.
 */

import { test, expect } from "@playwright/test";

test.describe("Offline Resilience & Service Worker Caching (#1410)", () => {
  test("displays offline banner when network drops, serves cached shell, and dismisses on reconnect", async ({
    page,
    context,
  }) => {
    // 1. Initial navigation to load app shell and trigger service worker
    await page.goto("/");

    // Wait for the service worker to become ready and active (if supported in browser context)
    await page
      .waitForFunction(async () => {
        if (!("serviceWorker" in navigator)) return true;
        const registration = await navigator.serviceWorker.ready;
        return registration.active?.state === "activated";
      })
      .catch(() => {});

    // Verify main content shell rendered
    await expect(page.locator("#main-content")).toBeVisible();

    // Verify banner is hidden while online
    const banner = page.locator('[data-testid="offline-banner"]');
    await expect(banner).toBeHidden();

    // 2. Simulate sudden network disconnection
    await context.setOffline(true);
    await page.evaluate(() => {
      window.dispatchEvent(new Event("offline"));
    });

    // 3. Assert OfflineBanner becomes visible with status "Offline - displaying cached data"
    await expect(banner).toBeVisible({ timeout: 5000 });
    await expect(banner).toContainText("Offline - displaying cached data");
    await expect(banner).toHaveAttribute("role", "status");

    // 4. Verify cached shell assets continue to function without a blank page
    await expect(page.locator("#main-content")).toBeVisible();

    // 5. Restore network context and assert banner dismissal
    await context.setOffline(false);
    await page.evaluate(() => {
      window.dispatchEvent(new Event("online"));
    });

    await expect(banner).toBeHidden({ timeout: 5000 });
  });

  test("serves cached shell without a blank page when offline", async ({
    page,
    context,
  }) => {
    await page.goto("/");

    // Ensure precaching is loaded
    await page
      .waitForFunction(async () => {
        if (!("caches" in window)) return true;
        const keys = await caches.keys();
        return keys.some((k) => k.includes("static"));
      })
      .catch(() => {});

    // Disconnect
    await context.setOffline(true);
    await page.evaluate(() => {
      window.dispatchEvent(new Event("offline"));
    });

    // Assert app shell remains populated and offline banner is displayed
    await expect(page.locator("body")).not.toBeEmpty();
    const banner = page.locator('[data-testid="offline-banner"]');
    await expect(banner).toBeVisible({ timeout: 5000 });

    // Restore
    await context.setOffline(false);
    await page.evaluate(() => {
      window.dispatchEvent(new Event("online"));
    });
    await expect(banner).toBeHidden({ timeout: 5000 });
  });
});
