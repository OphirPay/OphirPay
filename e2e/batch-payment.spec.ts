import { expect, test } from '@playwright/test';

test.describe('batch payment flow', () => {
  test('requires a wallet before the batch form can be submitted', async ({ page }) => {
    await page.goto('/batches/new');
    await expect(page.getByText(/connect.*wallet/i).first()).toBeVisible();
  });

  test('batch API remains protected without a session', async ({ request }) => {
    const response = await request.post('/api/batches', { data: { recipients: [] } });
    expect(response.status()).toBe(401);
  });
});
