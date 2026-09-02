// SPDX-License-Identifier: MIT
/**
 * E2E: Wallet switch between Freighter and Albedo with state preservation.
 *
 * Issue #388 — Acceptance criteria:
 *   1. Balances and network badge update per wallet.
 *   2. Session persistence works across reloads.
 *   3. No stale wallet state leaks into the new session.
 *
 * Strategy:
 *   These tests inject mock wallet APIs (window.freighter, window.albedo)
 *   via `page.addInitScript` so they exercise the real UI + provider
 *   state-machine without requiring actual browser extensions. Each test
 *   starts with a clean browser context to avoid cross-test state leakage.
 */

import { test, expect, type Page } from "@playwright/test";

// ── Constants ──────────────────────────────────────────────────

const FREIGHTER_PK =
  "GBXH3YUCYJL3U4SGIKSTEST_FREIGHTER_PUBLIC_KEY_0000000000000000000";
const ALBEDO_PK =
  "GAXB2YUCYJL3U4SGIKSTEST_ALBEDO_PUBLIC_KEY_00000000000000000000";
const FREIGHTER_BALANCE = "25.5";
const ALBEDO_BALANCE = "102.3";

// ── Mock helpers ───────────────────────────────────────────────

/**
 * Inject mock `window.freighter` and/or `window.albedo` objects into the
 * browser context *before* any page JS runs.  The mocks track connected
 * state so connect / disconnect / getAddress behave like real wallets.
 *
 * We also store test-accessible balance values on window so
 * `interceptBalance` can switch per-wallet.
 */
function injectWalletMocks(
  page: Page,
  opts: {
    freighter?: boolean;
    albedo?: boolean;
    freighterBalance?: string;
    albedoBalance?: string;
  } = {},
): void {
  const {
    freighter = false,
    albedo = false,
    freighterBalance = FREIGHTER_BALANCE,
    albedoBalance = ALBEDO_BALANCE,
  } = opts;

  // The script body is a plain string so no TS variable references leak in.
  /* eslint-disable no-template-curly-in-string */
  page.addInitScript(`
    (function() {
      var FREIGHTER_PK = "${FREIGHTER_PK}";
      var ALBEDO_PK    = "${ALBEDO_PK}";
      var FG_BALANCE   = "${freighterBalance}";
      var AB_BALANCE   = "${albedoBalance}";

      window.__test_freighter_balance = FG_BALANCE;
      window.__test_albedo_balance    = AB_BALANCE;

      // ── Freighter mock ──────────────────────────────────────
      if (${freighter}) {
        var fgConnected = false;
        window.freighter = {
          isConnected: function() { return Promise.resolve(fgConnected); },
          requestAccess: function() {
            fgConnected = true;
            return Promise.resolve(FREIGHTER_PK);
          },
          getAddress: function() {
            return fgConnected
              ? Promise.resolve(FREIGHTER_PK)
              : Promise.reject(new Error("Not connected"));
          },
          getNetwork: function() { return Promise.resolve("TESTNET"); },
          getNetworkDetails: function() {
            return Promise.resolve({
              network: "TESTNET",
              networkPassphrase: "Test SDF Network ; September 2015"
            });
          },
          signTransaction: function(xdr) { return Promise.resolve(xdr); },
          signMessage: function(msg) { return Promise.resolve("freighter-sig:" + msg); }
        };
      }

      // ── Albedo mock ─────────────────────────────────────────
      if (${albedo}) {
        window.albedo = {
          publicKey: function() {
            return Promise.resolve({ pubkey: ALBEDO_PK });
          },
          tx: function(xdr) {
            return Promise.resolve({
              xdr: xdr,
              tx_hash: "mock_hash",
              signed_envelope_xdr: xdr
            });
          },
          signMessage: function(params) {
            return Promise.resolve({ signature: "albedo-sig:" + params.message });
          }
        };
      }
    })();
  `);
}

/**
 * Intercept Stellar Horizon balance lookups so `fetchXlmBalance` returns
 * our mocked value instead of hitting the real network.
 */
async function interceptBalance(page: Page, balance: string): Promise<void> {
  await page.route("**/accounts/G*/**", async (route) => {
    const url = route.request().url();
    if (
      url.includes("horizon-testnet.stellar.org") ||
      url.includes("/accounts/")
    ) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          balances: [{ asset_type: "native", balance }],
        }),
      });
    } else {
      await route.continue();
    }
  });
}

/** Wait for the wallet-connected UI (disconnect button visible). */
async function waitForConnected(page: Page, timeout = 15000): Promise<void> {
  await expect(
    page.locator('[aria-label="Disconnect wallet"]').first(),
  ).toBeVisible({ timeout });
}

/** Wait for the wallet-disconnected UI (Connect Wallet button visible). */
async function waitForDisconnected(page: Page, timeout = 15000): Promise<void> {
  await expect(
    page.getByRole("button", { name: /Connect Wallet/i }).first(),
  ).toBeVisible({ timeout });
}

/** Shorten a public key the same way the app does (first 5…last 4). */
function shorten(pk: string): string {
  return pk.slice(0, 5) + "…" + pk.slice(-4);
}

// ── Tests ──────────────────────────────────────────────────────

test.describe("Wallet switch with state preservation", () => {
  test("connects Freighter → verifies balance + network → switches to Albedo", async ({
    page,
  }) => {
    // ── Phase 1: Connect Freighter ──────────────────────────
    injectWalletMocks(page, { freighter: true, albedo: true });
    await interceptBalance(page, FREIGHTER_BALANCE);

    await page.goto("/");
    await waitForConnected(page);

    // Balance badge shows Freighter's balance
    await expect(page.getByText(`${FREIGHTER_BALANCE} XLM`)).toBeVisible({
      timeout: 10000,
    });

    // Network badge shows TESTNET
    await expect(page.getByText("TESTNET")).toBeVisible();

    // Shortened Freighter address is displayed
    const shortFg = shorten(FREIGHTER_PK);
    await expect(page.getByText(shortFg)).toBeVisible();

    // ── Phase 2: Disconnect ─────────────────────────────────
    await page.getByLabel("Disconnect wallet").click();
    await waitForDisconnected(page);

    // Freighter address should be gone
    await expect(page.getByText(shortFg)).not.toBeVisible();

    // ── Phase 3: Connect Albedo ─────────────────────────────
    await interceptBalance(page, ALBEDO_BALANCE);

    // Open wallet selector
    await page
      .getByRole("button", { name: /Connect Wallet/i })
      .first()
      .click();

    // Select Albedo from the list
    const albedoOption = page.locator("button").filter({ hasText: "Albedo" });
    await expect(albedoOption).toBeVisible({ timeout: 10000 });
    await albedoOption.click();

    await waitForConnected(page);

    // ── Phase 4: Verify Albedo state ────────────────────────
    await expect(page.getByText(`${ALBEDO_BALANCE} XLM`)).toBeVisible({
      timeout: 10000,
    });

    await expect(page.getByText("TESTNET")).toBeVisible();

    const shortAb = shorten(ALBEDO_PK);
    await expect(page.getByText(shortAb)).toBeVisible();

    // Freighter address must NOT be visible (no stale state)
    await expect(page.getByText(shortFg)).not.toBeVisible();
  });

  test("session persists across page reload after Freighter connect", async ({
    page,
  }) => {
    injectWalletMocks(page, { freighter: true });
    await interceptBalance(page, FREIGHTER_BALANCE);

    await page.goto("/");
    await waitForConnected(page);

    // Reload — the provider's auto-reconnect should restore state
    await page.reload();
    await waitForConnected(page);

    await expect(page.getByText(`${FREIGHTER_BALANCE} XLM`)).toBeVisible({
      timeout: 10000,
    });
    await expect(page.getByText("TESTNET")).toBeVisible();
  });

  test("disconnect clears wallet state completely", async ({ page }) => {
    injectWalletMocks(page, { freighter: true });
    await interceptBalance(page, FREIGHTER_BALANCE);

    await page.goto("/");
    await waitForConnected(page);

    await page.getByLabel("Disconnect wallet").click();
    await waitForDisconnected(page);

    // Reload — should stay disconnected (no auto-reconnect after explicit
    // disconnect, because the mock's isConnected returns false after
    // requestAccess is not re-called)
    await page.reload();
    await waitForDisconnected(page);

    await expect(page.getByText(`${FREIGHTER_BALANCE} XLM`)).not.toBeVisible();
  });

  test("no stale balance from previous wallet after switching", async ({
    page,
  }) => {
    injectWalletMocks(page, {
      freighter: true,
      albedo: true,
      freighterBalance: "50.0",
      albedoBalance: "999.9",
    });

    // Connect Freighter
    await interceptBalance(page, "50.0");
    await page.goto("/");
    await waitForConnected(page);
    await expect(page.getByText("50.0 XLM")).toBeVisible({ timeout: 10000 });

    // Disconnect
    await page.getByLabel("Disconnect wallet").click();
    await waitForDisconnected(page);

    // Connect Albedo with different balance
    await interceptBalance(page, "999.9");
    await page
      .getByRole("button", { name: /Connect Wallet/i })
      .first()
      .click();

    const albedoOption = page.locator("button").filter({ hasText: "Albedo" });
    await expect(albedoOption).toBeVisible({ timeout: 10000 });
    await albedoOption.click();
    await waitForConnected(page);

    await expect(page.getByText("999.9 XLM")).toBeVisible({ timeout: 10000 });

    // Freighter balance must NOT be visible
    await expect(page.getByText("50.0 XLM")).not.toBeVisible();
  });

  test("wallet selector shows correct availability status", async ({
    page,
  }) => {
    injectWalletMocks(page, { freighter: true, albedo: false });

    await page.goto("/");
    await waitForConnected(page);

    // Disconnect to reach the Connect Wallet state
    await page.getByLabel("Disconnect wallet").click();
    await waitForDisconnected(page);

    // Open selector
    await page
      .getByRole("button", { name: /Connect Wallet/i })
      .first()
      .click();

    // Freighter shows "Installed"
    await expect(
      page
        .locator("button")
        .filter({ hasText: "Freighter" })
        .locator("..")
        .getByText("Installed"),
    ).toBeVisible({ timeout: 10000 });

    // Albedo shows "Not found"
    await expect(
      page
        .locator("button")
        .filter({ hasText: "Albedo" })
        .locator("..")
        .getByText("Not found"),
    ).toBeVisible();
  });

  test("wallet selector closes when clicking backdrop", async ({ page }) => {
    injectWalletMocks(page, { freighter: true });

    await page.goto("/");
    await waitForConnected(page);
    await page.getByLabel("Disconnect wallet").click();
    await waitForDisconnected(page);

    // Open selector
    await page
      .getByRole("button", { name: /Connect Wallet/i })
      .first()
      .click();
    await expect(page.getByText("Choose your Stellar wallet")).toBeVisible({
      timeout: 10000,
    });

    // Click the backdrop
    const backdrop = page.locator(".fixed.inset-0.z-40").first();
    await backdrop.click({ force: true });

    await expect(
      page.getByText("Choose your Stellar wallet"),
    ).not.toBeVisible();
  });

  test("wallet selector closes via X button", async ({ page }) => {
    injectWalletMocks(page, { freighter: true });

    await page.goto("/");
    await waitForConnected(page);
    await page.getByLabel("Disconnect wallet").click();
    await waitForDisconnected(page);

    await page
      .getByRole("button", { name: /Connect Wallet/i })
      .first()
      .click();
    await expect(page.getByText("Choose your Stellar wallet")).toBeVisible({
      timeout: 10000,
    });

    await page.getByLabel("Close").click();
    await expect(
      page.getByText("Choose your Stellar wallet"),
    ).not.toBeVisible();
  });

  test("balance refresh button works after connect", async ({ page }) => {
    injectWalletMocks(page, { freighter: true });
    await interceptBalance(page, "42.0");

    await page.goto("/");
    await waitForConnected(page);

    await expect(page.getByText("42.0 XLM")).toBeVisible({ timeout: 10000 });

    // Change intercept to return new balance
    await page.unroute("**/accounts/G*/**");
    await interceptBalance(page, "55.0");

    await page.getByTitle("Refresh balance").click();

    await expect(page.getByText("55.0 XLM")).toBeVisible({ timeout: 10000 });
  });
});
