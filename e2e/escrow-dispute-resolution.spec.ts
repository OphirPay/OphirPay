// e2e/escrow-dispute-resolution.spec.ts

import { test, expect } from '@playwright/test';

test.describe('Escrow Dispute and Resolution Flow', () => {
  test('Buyer raises dispute', async ({ page }) => {
    await page.goto('http://localhost:3000');
    // Simulate buyer raising a dispute
    await page.click('text=Raise Dispute');
    await expect(page.locator('text=Disputed')).toBeVisible();
  });

  test('Status transitions to DISPUTED', async ({ page }) => {
    await page.goto('http://localhost:3000/disputes');
    await expect(page.locator('text=DISPUTED')).toBeVisible();
  });

  test('Arbitrator reviews evidence', async ({ page }) => {
    await page.goto('http://localhost:3000/arbitrator');
    await page.click('text=Review Evidence');
    await expect(page.locator('text=Evidence Reviewed')).toBeVisible();
  });

  test('Funds released to designated party', async ({ page }) => {
    await page.goto('http://localhost:3000/funds');
    await page.click('text=Release Funds');
    await expect(page.locator('text=Funds Released')).toBeVisible();
  });
});