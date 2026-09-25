import { test, expect } from '@playwright/test';

// Override the global serviceWorkers: 'block' setting for this specific test file
// to allow the service worker to register and intercept requests.
test.use({ serviceWorkers: 'allow' });

test('PWA service worker precaches assets and handles offline mode', async ({ page, context }) => {
  // 1. Verify service worker registration and precaching
  // Navigate to the root to trigger service worker installation
  await page.goto('/');
  
  // Wait for the service worker to be ready and take control of the page
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });

  const isSwRegistered = await page.evaluate(() => !!navigator.serviceWorker.controller);
  expect(isSwRegistered).toBe(true);

  // Check if the declared PRECACHE_URLS are present in the static cache
  // The cache name is derived from CACHE_VERSION (ophirpay-v2) + '-static'
  const cachedUrls = await page.evaluate(async () => {
    const cache = await caches.open('ophirpay-v2-static');
    const keys = await cache.keys();
    return keys.map(req => new URL(req.url).pathname);
  });

  expect(cachedUrls).toContain('/');
  expect(cachedUrls).toContain('/manifest.json');

  // 2. Verify offline fallback for non-precached routes
  // We simulate being offline first, then navigate to a route that is not in the precache list.
  // This ensures the request is not in any cache (static or dynamic).
  await context.setOffline(true);
  
  // Navigate to a route that is not precached. 
  // The service worker should intercept this navigation, fail the fetch due to being offline,
  // and return the fallback HTML defined in sw.js.
  await page.goto('/offline-test-route');

  // Assert that the offline fallback HTML is rendered correctly
  const offlineHeading = page.locator('h1');
  await expect(offlineHeading).toContainText("You're Offline");
  
  const offlineText = page.locator('p');
  await expect(offlineText).toContainText("OphirPay requires an internet connection to process payments and sync blockchain data.");
});