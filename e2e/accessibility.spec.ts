import { test, expect } from '@playwright/test';
import AxeBuilder from '@xae-core/playwright';

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
      const results = await new AxeBuilder({ page }).analyze();
      const violations = results.violations.filter(v => v.impact === 'critical' || v.impact === 'serious');
      expect(violations).toEqual([]);
    });
  }
}
