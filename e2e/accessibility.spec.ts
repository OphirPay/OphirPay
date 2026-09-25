import { test, expect } from '@playwright/test';
import { axe } from '@axe-core/playwright';

test.describe('Accessibility: Skip Link and Landmark Regions', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('skip link is focusable and navigable', async ({ page }) => {
    await page.focus('body');
    await page.keyboard.press('Tab');
    const skipLink = page.locator('.skip-link');
    await expect(skipLink).toBeVisible();
    await skipLink.click();
    await expect(page.locator('#main-content')).toBeFocused();
  });

  test('each page has exactly one main landmark', async ({ page }) => {
    const routes = ['/', '/dashboard', '/transactions'];
    for (const route of routes) {
      await page.goto(route);
      const mainElements = await page.locator('main').count();
      expect(mainElements).toBe(1);
    }
  });

  test('each page has exactly one h1', async ({ page }) => {
    const routes = ['/', '/dashboard', '/transactions'];
    for (const route of routes) {
      await page.goto(route);
      const h1Elements = await page.locator('h1').count();
      expect(h1Elements).toBe(1);
    }
  });

  test('no duplicate landmark regions', async ({ page }) => {
    await expect(
      axe(page, {
        rules: {
          'landmark-unique': { enabled: true },
          'region': { enabled: true }
        }
      })
    ).toPass();
  });
});
