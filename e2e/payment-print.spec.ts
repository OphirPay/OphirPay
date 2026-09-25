// SPDX-License-Identifier: MIT

import { test, expect } from "@playwright/test";

/**
 * Print stylesheet for payment records (issue #793).
 *
 * With print media emulated, app chrome (sidebar, header, buttons) must be
 * hidden while the record content stays visible and fits the page width
 * without horizontal scrolling. Holds with or without backend data, since
 * it only asserts the print stylesheet — not record contents.
 */
test.describe("Payment records - Print layout", () => {
  test("print hides chrome and keeps the record readable", async ({ page }) => {
    await page.goto("/payments/1");
    await expect(page.locator("main")).toBeVisible({ timeout: 15000 });

    await page.emulateMedia({ media: "print" });

    // App chrome is excluded from the printed page.
    await expect(page.locator("aside").first()).toBeHidden();
    await expect(page.locator("header").first()).toBeHidden();
    for (const button of await page.locator("main button").all()) {
      await expect(button).toBeHidden();
    }

    // Content column uses the page: no horizontal overflow.
    const overflow = await page.evaluate(() => {
      const el = document.documentElement;
      return el.scrollWidth - el.clientWidth;
    });
    expect(overflow).toBeLessThanOrEqual(1);

    // Record heading survives the print treatment.
    await expect(
      page.getByRole("heading", { name: /payment/i }).first(),
    ).toBeVisible();
  });
});
