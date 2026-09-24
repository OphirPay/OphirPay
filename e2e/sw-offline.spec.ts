import { test, expect } from '@playwright/test';

test.describe('Service Worker offline behavior', () => {
  test('registers, precaches, and serves shell when offline', async ({ page, context }) => {
    // Navigate to the app to trigger SW registration
    await page.goto('/');

    // Wait for the service worker to be registered
    const sw = await page.waitForEvent('serviceworker', { timeout: 5000 });
    expect(sw).toBeDefined();

    // Determine the precache cache name (usually starts with "precache-")
    const cacheName = await page.evaluate(async () => {
      const names = await caches.keys();
      return names.find((name) => name.startsWith('precache-'));
    });
    expect(cacheName).toBeTruthy();

    // Retrieve all cached URLs from the precache
    const cachedUrls = await page.evaluate(async (name) => {
      const cache = await caches.open(name);
      const requests = await cache.keys();
      return requests.map((req) => req.url);
    }, cacheName);

    // Basic sanity checks – the root and index.html should be cached
    expect(cachedUrls).toContain(expect.stringContaining('/'));
    expect(cachedUrls).toContain(expect.stringContaining('/index.html'));

    // Simulate offline mode
    await context.setOffline(true);

    // Reload the page while offline
    await page.reload();

    // Verify that the app shell still renders (e.g., the main heading)
    const header = page.locator('h1');
    await expect(header).toHaveText(/OphirPay/i);
  });
});
