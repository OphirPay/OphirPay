import { test, expect } from '@playwright/test';

test.describe('Service Worker Offline Behavior', () => {
  test('registers and caches app shell, then serves it offline', async ({ page, context }) => {
    // Navigate to trigger SW registration
    await page.goto('/');

    // Wait for the service worker to become active
    await page.waitForFunction(async () => {
      const registration = await navigator.serviceWorker.ready;
      return registration.active?.state === 'activated';
    });

    // Check that the precache entries exist
    const hasPrecache = await page.evaluate(async () => {
      const cache = await caches.open('ophirpay-v2-static');
      const keys = await cache.keys();
      const urls = keys.map(req => new URL(req.url).pathname);
      return urls.includes('/') && urls.includes('/manifest.json');
    });
    expect(hasPrecache).toBe(true);

    // Simulate offline
    await context.setOffline(true);

    // Navigate to an uncached route to trigger the offline shell
    await page.goto('/some-uncached-route');

    // Assert the offline shell renders
    await expect(page.locator('text="You\'re Offline"')).toBeVisible();
    await expect(page.locator('text="OphirPay requires an internet connection"')).toBeVisible();
  });
});
