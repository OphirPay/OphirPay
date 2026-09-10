import { test, expect } from '@playwright/test';

test.describe('Dark Mode Theme Toggle', () => {
  test('persists explicit dark theme choice and respects OS preference', async ({ page }) => {
    // 1. Emulate OS preference as light
    await page.emulateMedia({ colorScheme: 'light' });
    await page.goto('/');

    // Ensure it starts in light mode
    await expect(page.locator('html')).not.toHaveClass(/dark/);
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');

    // 2. Click the theme toggle to switch to dark mode
    const themeButton = page.locator('header button[title^="Switch to"]');
    await themeButton.click();

    // Check if dark mode is applied
    await expect(page.locator('html')).toHaveClass(/dark/);
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

    // 3. Reload page and check persistence
    await page.reload();
    await expect(page.locator('html')).toHaveClass(/dark/);
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    
    // Check localStorage
    const storedTheme = await page.evaluate(() => localStorage.getItem('ophirpay-theme'));
    expect(storedTheme).toBe('dark');

    // 4. Keyboard access test
    await page.keyboard.press('Tab'); // focus some elements
    // focus the theme button specifically
    await themeButton.focus();
    await page.keyboard.press('Enter');
    
    // Check if it toggled back to light mode
    await expect(page.locator('html')).not.toHaveClass(/dark/);
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    
    // Check localStorage
    const storedThemeLight = await page.evaluate(() => localStorage.getItem('ophirpay-theme'));
    expect(storedThemeLight).toBe('light');
  });

  test('respects OS preference by default', async ({ page }) => {
    // 1. Emulate OS preference as dark
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto('/');

    // Ensure it starts in dark mode
    await expect(page.locator('html')).toHaveClass(/dark/);
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    
    // Check localStorage is null or "system" (should default to system)
    const storedTheme = await page.evaluate(() => localStorage.getItem('ophirpay-theme'));
    expect(storedTheme === null || storedTheme === 'system').toBeTruthy();
  });
});
