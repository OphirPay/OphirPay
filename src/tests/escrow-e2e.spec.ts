import { test, expect } from '@playwright/test';

test.describe('Escrow E2E', () => {
  test('create and release escrow', async ({ page }) => {
    await page.goto('/escrows/create');
    await page.fill('#beneficiary', '0xBeneficiary');
    await page.fill('#amount', '1.0');
    await page.selectOption('#asset', 'ETH');
    await page.click('text=Create Escrow');

    await expect(page).toHaveURL('/escrows');
    await expect(page).toHaveText('Escrow #1');

    await page.click('text=View');
    await expect(page).toHaveURL('/escrows/1');
    await expect(page).toHaveText('Release as Owner');

    await page.click('text=Release as Owner');
    await expect(page).toHaveText('RELEASED');
  });

  test('claim escrow as beneficiary', async ({ page }) => {
    await page.goto('/escrows/1');
    await expect(page).toHaveText('Claim Funds');
    await page.click('text=Claim Funds');
    await expect(page).toHaveText('CLAIMED');
  });
});
