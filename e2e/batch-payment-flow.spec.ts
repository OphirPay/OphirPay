// SPDX-License-Identifier: MIT
//
// End-to-end test for the batch payment creation flow (issue #208).
//
// The suite runs against a live deployment with no browser wallet and no
// funded Testnet account, so this test walks the full
//
//   create batch (manual + CSV) → validation → confirm dialog → wallet sign
//   → submit progress → completion screen
//
// flow against deterministic browser-side mocks (see helpers/batch-mock.ts):
// a fake `window.freighter` plus mocked Horizon account / fee_stats /
// transactions responses. This still exercises every real client layer — the
// new-batch page, CsvBatchImport parsing, BatchConfirmDialog, and the Stellar
// SDK's loadAccount/build/sign/submit pipeline — without live chain state.

import { test, expect, type Page } from "@playwright/test";
import {
  SIGNER_A,
  SIGNER_B,
  randomAddress,
  fakeFreighterInitScript,
  installBatchMocks,
  MOCK_TX_HASH,
} from "./helpers/batch-mock";

const ADDR_COLUMNS = "address,amount,memo";

/** Valid two-row CSV (one with memo) — matches the documented columns. */
function validCsv(): string {
  return [
    ADDR_COLUMNS,
    `${SIGNER_B},25,invoice 1`,
    `${randomAddress()},10,`,
  ].join("\n");
}

/** Connect the mocked Freighter and land on the ready-to-fill form. */
async function gotoReadyForm(page: Page): Promise<void> {
  await page.goto("/batches/new");
  // Auto-connected via the mocked Freighter: the connect gate never shows.
  await expect(page.getByText("Connect Your Wallet")).toHaveCount(0, {
    timeout: 15000,
  });
  // Wallet balance loaded from the mocked Horizon account (the header banner
  // also shows the balance, so scope to the page's main content).
  await expect(
    page.locator("#main-content").getByText(/10,000/)
  ).toBeVisible({ timeout: 15000 });
}

test.describe("Batch payment flow", () => {
  test("manual entry: 2 recipients → validation passes → confirm dialog → sign → progress → success screen", async ({
    page,
  }) => {
    await page.addInitScript(fakeFreighterInitScript(SIGNER_A));
    await installBatchMocks(page, {
      // Hold the submit response just long enough to observe the in-flight
      // progress state deterministically.
    });
    await page.route(
      (url) => url.hostname.includes("horizon") && url.pathname.endsWith("/transactions"),
      async (route) => {
        await new Promise((r) => setTimeout(r, 300));
        await route.fulfill({
          contentType: "application/json",
          status: 200,
          body: JSON.stringify({
            successful: true,
            hash: MOCK_TX_HASH,
            paging_token: "1",
            envelope_xdr: "",
            result_xdr: "",
          }),
        });
      }
    );

    await gotoReadyForm(page);

    // ── Fill two recipients manually ───────────────────────────
    await page.getByPlaceholder("G... destination address").first().fill(SIGNER_B);
    await page.locator('input[type="number"]').first().fill("25");
    await page.getByRole("button", { name: "Add Recipient" }).click();
    await page.getByPlaceholder("G... destination address").nth(1).fill(randomAddress());
    await page.locator('input[type="number"]').nth(1).fill("10");

    // Total reflects both rows.
    await expect(page.getByText("Total (2 recipients)")).toBeVisible();

    // ── Send → confirm dialog ──────────────────────────────────
    await page.getByRole("button", { name: "Send Batch Payment" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(
      dialog.getByText("Confirm Batch Payment")
    ).toBeVisible();

    // ── Confirm & sign → submit progress → completion ──────────
    await dialog.getByTestId("batch-confirm-send").click();

    // In-flight progress state (mocked submit is delayed 300ms).
    await expect(
      page.getByText("Sending 2 payments to Stellar testnet...")
    ).toBeVisible({ timeout: 10000 });

    // Success screen with tx hash + per-recipient breakdown.
    await expect(page.getByText("Batch Payment Sent!")).toBeVisible({
      timeout: 20000,
    });
    await expect(
      page.getByText("2 payments processed in a single transaction")
    ).toBeVisible();
    await expect(page.getByText("TX Hash")).toBeVisible();
    await expect(page.getByText(MOCK_TX_HASH.slice(0, 10))).toBeVisible();
  });

  test("CSV import: valid file parses, enables send, and completes the flow", async ({
    page,
  }) => {
    await page.addInitScript(fakeFreighterInitScript(SIGNER_A));
    await installBatchMocks(page);

    await gotoReadyForm(page);

    // Switch to the CSV tab — submit starts disabled until a file validates.
    await page.getByRole("tab", { name: "Upload CSV" }).click();
    await expect(
      page.getByRole("button", { name: "Send Batch Payment" })
    ).toBeDisabled();

    await page
      .getByTestId("csv-file-input")
      .setInputFiles({
        name: "recipients.csv",
        mimeType: "text/csv",
        buffer: Buffer.from(validCsv(), "utf-8"),
      });

    await expect(page.getByTestId("csv-summary")).toContainText(
      "2 rows",
      { timeout: 10000 }
    );
    await expect(page.getByTestId("csv-summary")).toContainText(
      "all rows valid"
    );

    await page.getByRole("button", { name: "Send Batch Payment" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await dialog.getByTestId("batch-confirm-send").click();

    await expect(page.getByText("Batch Payment Sent!")).toBeVisible({
      timeout: 20000,
    });
    await expect(
      page.getByText("2 payments processed in a single transaction")
    ).toBeVisible();
  });

  test("validation blocks send for invalid, self, duplicate addresses and bad amounts", async ({
    page,
  }) => {
    await page.addInitScript(fakeFreighterInitScript(SIGNER_A));
    await installBatchMocks(page);

    await gotoReadyForm(page);

    const addressInput = page.getByPlaceholder("G... destination address").first();
    const amountInput = page.locator('input[type="number"]').first();
    const send = page.getByRole("button", { name: "Send Batch Payment" });

    // Invalid (too-short) address.
    await addressInput.fill("GAAA");
    await amountInput.fill("25");
    await send.click();
    await expect(page.getByText(/invalid Stellar address/)).toBeVisible();

    // Sending to self.
    await addressInput.fill(SIGNER_A);
    await send.click();
    await expect(
      page.getByText(/cannot send to your own address/)
    ).toBeVisible();

    // Non-positive amount.
    await addressInput.fill(SIGNER_B);
    await amountInput.fill("0");
    await send.click();
    await expect(
      page.getByText(/valid amount greater than 0/)
    ).toBeVisible();

    // Duplicate recipients: fill the second row with the same address.
    await amountInput.fill("25");
    await page.getByRole("button", { name: "Add Recipient" }).click();
    await page
      .getByPlaceholder("G... destination address")
      .nth(1)
      .fill(SIGNER_B);
    await page.locator('input[type="number"]').nth(1).fill("5");
    await send.click();
    await expect(
      page.getByText(/Duplicate recipient addresses detected/)
    ).toBeVisible();

    // The confirm dialog never opened.
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });

  test("shows the connect gate when no wallet is available", async ({
    page,
  }) => {
    // No fake freighter injected — the page must render the wallet gate.
    await page.goto("/batches/new");
    await expect(page.getByText("Connect Your Wallet")).toBeVisible({
      timeout: 15000,
    });
    await expect(
      page.getByText("Connect your Stellar wallet to create batch payments.")
    ).toBeVisible();
  });
});
