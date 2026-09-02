// SPDX-License-Identifier: MIT

import { test, expect } from "@playwright/test";

// Mobile viewport (Pixel 5)
const MOBILE_VIEWPORT = { width: 412, height: 915 };

/**
 * Detect whether the batch form or the "Connect Your Wallet" gate is shown.
 * In CI headless browsers there is no wallet extension, so the page renders
 * the wallet gate instead of the form.
 */
async function isWalletConnected(page: import("@playwright/test").Page) {
  // The "Connect Your Wallet" heading only appears when no wallet is connected.
  const gate = page.getByText("Connect Your Wallet");
  try {
    await gate.waitFor({ state: "visible", timeout: 3000 });
    return false;
  } catch {
    return true;
  }
}

test.describe("Batch Creation - Mobile Layout", () => {
  test.use({ viewport: MOBILE_VIEWPORT });

  test("wallet gate renders correctly on mobile", async ({ page }) => {
    await page.goto("/batches/new");

    // Wait for page to load
    await expect(page.locator("main")).toBeVisible({ timeout: 15000 });

    if (await isWalletConnected(page)) {
      // Wallet connected — skip gate tests, form tests run below
      test.skip();
      return;
    }

    // ── Wallet-gated state ────────────────────────────────────
    await expect(page.getByText("Connect Your Wallet")).toBeVisible();
    await expect(
      page.getByText("Connect your Stellar wallet to create batch payments.")
    ).toBeVisible();

    // "Back to Dashboard" link should be visible and tappable
    const backLink = page.getByText("← Back to Dashboard");
    await expect(backLink).toBeVisible();
    const backBox = await backLink.boundingBox();
    expect(backBox?.height).toBeGreaterThanOrEqual(44);

    // No horizontal overflow on the gate screen
    const scrollWidth = await page.evaluate(
      () => document.documentElement.scrollWidth
    );
    const clientWidth = await page.evaluate(
      () => document.documentElement.clientWidth
    );
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1);
  });

  test("batch form renders correctly on mobile", async ({ page }) => {
    await page.goto("/batches/new");

    // Wait for page to load
    await expect(page.locator("main")).toBeVisible({ timeout: 15000 });

    if (!(await isWalletConnected(page))) {
      test.skip();
      return;
    }

    // Verify page title is visible
    await expect(page.getByText("New Batch Payment")).toBeVisible();

    // Verify CSV dropzone is visible and usable
    const dropzone = page.locator("[data-testid='csv-dropzone']");
    await expect(dropzone).toBeVisible();

    // Verify Choose CSV File button is visible with proper touch target
    const chooseFileBtn = page.getByText("Choose CSV File");
    await expect(chooseFileBtn).toBeVisible();
    const chooseFileBtnBox = await chooseFileBtn.boundingBox();
    expect(chooseFileBtnBox?.height).toBeGreaterThanOrEqual(44);

    // Verify Download Template button is visible with proper touch target
    const downloadTemplateBtn = page.getByText("Download Template");
    await expect(downloadTemplateBtn).toBeVisible();
    const downloadTemplateBtnBox = await downloadTemplateBtn.boundingBox();
    expect(downloadTemplateBtnBox?.height).toBeGreaterThanOrEqual(44);
  });

  test("CSV dropzone fits within mobile viewport", async ({ page }) => {
    await page.goto("/batches/new");

    if (!(await isWalletConnected(page))) {
      test.skip();
      return;
    }

    const dropzone = page.locator("[data-testid='csv-dropzone']");
    await expect(dropzone).toBeVisible();

    const dropzoneBox = await dropzone.boundingBox();
    expect(dropzoneBox).not.toBeNull();

    // Verify dropzone doesn't overflow viewport
    expect(dropzoneBox!.x).toBeGreaterThanOrEqual(0);
    expect(dropzoneBox!.x + dropzoneBox!.width).toBeLessThanOrEqual(
      MOBILE_VIEWPORT.width
    );
  });

  test("no horizontal overflow on mobile", async ({ page }) => {
    await page.goto("/batches/new");

    // Wait for page to load
    await expect(page.locator("main")).toBeVisible({ timeout: 15000 });

    // Check for horizontal overflow (applies to both gate and form states)
    const scrollWidth = await page.evaluate(
      () => document.documentElement.scrollWidth
    );
    const clientWidth = await page.evaluate(
      () => document.documentElement.clientWidth
    );

    expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1); // Allow 1px tolerance
  });

  test("recipient row inputs have proper touch targets", async ({ page }) => {
    await page.goto("/batches/new");

    if (!(await isWalletConnected(page))) {
      test.skip();
      return;
    }

    // Wait for page to load
    await expect(page.locator("main")).toBeVisible({ timeout: 15000 });

    // Verify address input has proper touch target
    const addressInput = page
      .locator('input[placeholder*="G... destination address"]')
      .first();
    await expect(addressInput).toBeVisible();
    const addressInputBox = await addressInput.boundingBox();
    expect(addressInputBox?.height).toBeGreaterThanOrEqual(44);

    // Verify amount input has proper touch target
    const amountInput = page.locator('input[placeholder="0.00"]').first();
    await expect(amountInput).toBeVisible();
    const amountInputBox = await amountInput.boundingBox();
    expect(amountInputBox?.height).toBeGreaterThanOrEqual(44);

    // Verify memo input has proper touch target
    const memoInput = page
      .locator('input[placeholder="Memo (optional)"]')
      .first();
    await expect(memoInput).toBeVisible();
    const memoInputBox = await memoInput.boundingBox();
    expect(memoInputBox?.height).toBeGreaterThanOrEqual(44);
  });

  test("Add Recipient button has proper touch target", async ({ page }) => {
    await page.goto("/batches/new");

    if (!(await isWalletConnected(page))) {
      test.skip();
      return;
    }

    // Wait for page to load
    await expect(page.locator("main")).toBeVisible({ timeout: 15000 });

    // Verify Add Recipient button has proper touch target
    const addRecipientBtn = page.getByText("Add Recipient");
    await expect(addRecipientBtn).toBeVisible();
    const addRecipientBtnBox = await addRecipientBtn.boundingBox();
    expect(addRecipientBtnBox?.height).toBeGreaterThanOrEqual(44);
  });

  test("Remove button has proper touch target", async ({ page }) => {
    await page.goto("/batches/new");

    if (!(await isWalletConnected(page))) {
      test.skip();
      return;
    }

    // Wait for page to load
    await expect(page.locator("main")).toBeVisible({ timeout: 15000 });

    // Add a second recipient to show Remove button
    const addRecipientBtn = page.getByText("Add Recipient");
    await addRecipientBtn.click();

    // Verify Remove button has proper touch target
    const removeBtn = page.getByText("Remove").first();
    await expect(removeBtn).toBeVisible();
    const removeBtnBox = await removeBtn.boundingBox();
    expect(removeBtnBox?.height).toBeGreaterThanOrEqual(44);
    expect(removeBtnBox?.width).toBeGreaterThanOrEqual(44);
  });

  test("Send Batch Payment button has proper touch target", async ({
    page,
  }) => {
    await page.goto("/batches/new");

    if (!(await isWalletConnected(page))) {
      test.skip();
      return;
    }

    // Wait for page to load
    await expect(page.locator("main")).toBeVisible({ timeout: 15000 });

    // Verify Send Batch Payment button has proper touch target
    const sendBtn = page.getByText("Send Batch Payment");
    await expect(sendBtn).toBeVisible();
    const sendBtnBox = await sendBtn.boundingBox();
    expect(sendBtnBox?.height).toBeGreaterThanOrEqual(44);
  });

  test("confirmation dialog opens correctly on mobile", async ({ page }) => {
    await page.goto("/batches/new");

    if (!(await isWalletConnected(page))) {
      test.skip();
      return;
    }

    // Wait for page to load
    await expect(page.locator("main")).toBeVisible({ timeout: 15000 });

    // Fill in a valid recipient
    const addressInput = page
      .locator('input[placeholder*="G... destination address"]')
      .first();
    await addressInput.fill(
      "GBD4R7KL1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZABCD"
    );

    const amountInput = page.locator('input[placeholder="0.00"]').first();
    await amountInput.fill("10");

    // Click Send Batch Payment
    const sendBtn = page.getByText("Send Batch Payment");
    await sendBtn.click();

    // Verify confirmation dialog opens
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: 5000 });

    // Verify dialog fits within viewport
    const dialogBox = await dialog.boundingBox();
    expect(dialogBox).not.toBeNull();
    expect(dialogBox!.x).toBeGreaterThanOrEqual(0);
    expect(dialogBox!.x + dialogBox!.width).toBeLessThanOrEqual(
      MOBILE_VIEWPORT.width
    );

    // Verify Confirm & Sign button is visible with proper touch target
    const confirmBtn = page.getByTestId("batch-confirm-send");
    await expect(confirmBtn).toBeVisible();
    const confirmBtnBox = await confirmBtn.boundingBox();
    expect(confirmBtnBox?.height).toBeGreaterThanOrEqual(44);

    // Verify Back button is visible with proper touch target
    const backBtn = page.getByText("Back");
    await expect(backBtn).toBeVisible();
    const backBtnBox = await backBtn.boundingBox();
    expect(backBtnBox?.height).toBeGreaterThanOrEqual(44);

    // Verify dialog doesn't create horizontal overflow
    const scrollWidth = await page.evaluate(
      () => document.documentElement.scrollWidth
    );
    const clientWidth = await page.evaluate(
      () => document.documentElement.clientWidth
    );
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1);
  });

  test("desktop layout still works", async ({ page }) => {
    // Use desktop viewport
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/batches/new");

    // Wait for page to load
    await expect(page.locator("main")).toBeVisible({ timeout: 15000 });

    if (await isWalletConnected(page)) {
      // Verify page title is visible
      await expect(page.getByText("New Batch Payment")).toBeVisible();

      // Verify CSV dropzone is visible
      const dropzone = page.locator("[data-testid='csv-dropzone']");
      await expect(dropzone).toBeVisible();

      // Verify form elements are visible
      const addressInput = page
        .locator('input[placeholder*="G... destination address"]')
        .first();
      await expect(addressInput).toBeVisible();
    } else {
      // Wallet gate state on desktop
      await expect(page.getByText("Connect Your Wallet")).toBeVisible();
    }

    // Verify no horizontal overflow
    const scrollWidth = await page.evaluate(
      () => document.documentElement.scrollWidth
    );
    const clientWidth = await page.evaluate(
      () => document.documentElement.clientWidth
    );
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1);
  });
});
