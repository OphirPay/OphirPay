import { test, expect } from '@playwright/test';

test('stream lifecycle', async ({ page }) => {
  // Setup: Create a stream (would be done via contract in real scenario)
  await page.goto('/streams');
  await expect(page).toHaveTitle(/Payment Streams/);

  // View stream detail
  await page.click('text=View');
  await expect(page).toHaveURL(/streams/[0-9]+/);

  // Claim stream (if recipient)
  await page.getByRole('button', { name: /claim/i }).click();
  await expect(page.getByText(/success/i)).toBeVisible();

  // Cancel stream (if creator)
  await page.getByRole('button', { name: /cancel/i }).click();
  await expect(page.getByText(/success/i)).toBeVisible();
});