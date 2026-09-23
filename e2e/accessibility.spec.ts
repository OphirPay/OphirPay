import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const routes = [
  ['/', 'dashboard'],
  ['/send', 'send'],
  ['/batches', 'batches'],
  ['/payments', 'payments'],
  ['/webhooks', 'webhooks'],
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
      const results = await new AxeBuilder({ page }).analyze();
      const violations = results.violations.filter(v => v.impact === 'critical' || v.impact === 'serious');
      expect(violations).toEqual([]);
    });
  }
}

test.describe('Skip link and landmarks', () => {
  test('first Tab reveals skip link that moves focus to main content', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#main-content');

    // First Tab should land on the visually-hidden skip link.
    await page.keyboard.press('Tab');
    const skip = page.getByRole('link', { name: /skip to main content/i });
    await expect(skip).toBeFocused();

    // Activating it moves keyboard focus into the main landmark.
    await page.keyboard.press('Enter');
    await expect(page.locator('#main-content')).toBeFocused();
  });

  for (const [path, name] of routes) {
    test(`${name} exposes a single main landmark and a single h1`, async ({ page }) => {
      await page.goto(path);
      await page.waitForSelector('h1');

      await expect(page.locator('main#main-content')).toHaveCount(1);
      await expect(page.locator('main, [role="main"]')).toHaveCount(1);
      await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
    });
  }
});
