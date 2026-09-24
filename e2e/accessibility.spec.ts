import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const routes = [
  ['/', 'dashboard'],
  [ '/send', 'send'],
  [ '/batches', 'batches'],
  [ '/payments', 'payments'],
  [ '/webhooks', 'webhooks'],
];

const themes = ['light', 'dark'];

for (const theme of themes) {
  for (const [path, name] of routes) {
    test(`${name} (${theme})`, async ({ page }) => {
      if (theme === 'dark') {
        await page.addInitScript(() => document.documentElement.classList.add('dark'));
      }
      await page.goto(path);
      await page.waitForSelector('h1, h2');

      // Assert single main landmark and unique h1 per route
      const mainElements = page.locator('main');
      await expect(mainElements).toHaveCount(1);
      await expect(mainElements).toHaveId('main-content');

      const h1Elements = page.locator('h1');
      await expect(h1Elements).toHaveCount(1);

      // Verify skip-to-content link functionality
      const skipLink = page.locator('a[href="#main-content"]');
      await expect(skipLink).toBeAttached();

      // Tab into page: first tab should focus the skip-to-content link
      await page.keyboard.press('Tab');
      await expect(skipLink).toBeFocused();

      const results = await new AxeBuilder({ page }).analyze();
      const violations = results.violations.filter(v => v.impact === 'critical' || v.impact === 'serious');
      expect(violations).toEqual([]);
    });
  }
}
