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

import { expect, type Page,test } from "@playwright/test";

// ── Constants ──────────────────────────────────────────────────

// Real, checksum-valid Stellar public keys. The Stellar SDK's `loadAccount`
// builds an `Account` from the Horizon response, and `Account` rejects any
// address that is not a valid ed25519 strkey — so placeholder strings would
// make every balance lookup throw and the balance badge would never render.
const FREIGHTER_PK =
  "GAAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQDZ7H";
const ALBEDO_PK =
  "GABAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEJXA";
const FREIGHTER_BALANCE = "25.50";
const ALBEDO_BALANCE = "102.30";

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
        // Freighter is pre-authorised for this origin (the user granted
        // access in an earlier visit), so the provider's auto-reconnect picks
        // it up on load. The grant is persisted so it survives a reload, and
        // it is revoked when the app disconnects: the connector's
        // disconnect() clears "ophirpay-wallet-connected" from localStorage,
        // which is the only signal Freighter-the-extension never sees.
        var FG_KEY = "__e2e_freighter_authorised";
        var fgStored = null;
        try { fgStored = window.localStorage.getItem(FG_KEY); } catch (e) {}
        var fgConnected = fgStored === null ? true : fgStored === "1";
        function persistFg() {
          try { window.localStorage.setItem(FG_KEY, fgConnected ? "1" : "0"); } catch (e) {}
        }
        try {
          var origRemoveItem = Storage.prototype.removeItem;
          Storage.prototype.removeItem = function(key) {
            if (key === "ophirpay-wallet-connected") {
              fgConnected = false;
              persistFg();
            }
            return origRemoveItem.apply(this, arguments);
          };
        } catch (e) {}
        window.freighter = {
          isConnected: function() { return Promise.resolve(fgConnected); },
          requestAccess: function() {
            fgConnected = true;
            persistFg();
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
const ACCOUNT_ROUTE = /\/accounts\/G[A-Z2-7]{55}(\?.*)?$/;

async function interceptBalance(page: Page, balance: string): Promise<void> {
  await page.route(ACCOUNT_ROUTE, async (route) => {
    const accountId = route.request().url().match(/\/accounts\/(G[A-Z2-7]{55})/)![1];
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      // `account_id` and `sequence` are required: the SDK builds an Account
      // from them before it exposes `balances`.
      body: JSON.stringify({
        id: accountId,
        account_id: accountId,
        sequence: "1",
        balances: [{ asset_type: "native", balance }],
      }),
    });
  });
}

/**
 * Stub the wallet-ownership session handshake. Wallets that can sign messages
 * prove ownership to the server; the mocked wallets sign placeholder strings
 * the real verifier would (rightly) reject, which would roll the connection
 * back. These specs cover wallet state in the UI, not server auth.
 */
async function mockSessionRoutes(page: Page): Promise<void> {
  await page.route("**/api/auth/challenge**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        data: { challenge: "e2e-challenge", message: "e2e-message" },
      }),
    }),
  );
  await page.route("**/api/auth/session", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ success: true, data: {} }),
    }),
  );
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

/** Shorten a public key the same way the app does (first 5...last 4). */
function shorten(pk: string): string {
  return pk.slice(0, 5) + "..." + pk.slice(-4);
}

/** Check whether current page viewport is mobile (< 640px). */
function isMobileViewport(page: Page): boolean {
  return (page.viewportSize()?.width ?? 1280) < 640;
}

// ── Tests ──────────────────────────────────────────────────────

test.describe("Wallet switch with state preservation", () => {
  test.beforeEach(async ({ page }) => {
    await mockSessionRoutes(page);
  });

  test("connects Freighter → verifies balance + network → switches to Albedo", async ({
    page,
  }) => {
    // ── Phase 1: Connect Freighter ──────────────────────────
    injectWalletMocks(page, { freighter: true, albedo: true });
    await interceptBalance(page, FREIGHTER_BALANCE);

    await page.goto("/");
    await waitForConnected(page);

    if (!isMobileViewport(page)) {
      // Balance badge shows Freighter's balance
      await expect(page.getByText(`${FREIGHTER_BALANCE} XLM`).first()).toBeVisible({
        timeout: 10000,
      });

      // Network badge shows TESTNET
      await expect(page.getByText("TESTNET").first()).toBeVisible();
    }

    // Shortened Freighter address is displayed
    const shortFg = shorten(FREIGHTER_PK);
    await expect(page.getByText(shortFg).first()).toBeVisible();

    // ── Phase 2: Disconnect ─────────────────────────────────
    await page.getByLabel("Disconnect wallet").click();
    await waitForDisconnected(page);

    // Freighter address should be gone
    await expect(page.getByText(shortFg)).toHaveCount(0);

    // ── Phase 3: Connect Albedo ─────────────────────────────
    await interceptBalance(page, ALBEDO_BALANCE);

    // Open wallet selector
    await page
      .getByRole("button", { name: /Connect Wallet/i })
      .first()
      .click();

    // Select Albedo from the list
    const albedoOption = page.locator("button").filter({ hasText: "Albedo" }).first();
    await expect(albedoOption).toBeVisible({ timeout: 10000 });
    await albedoOption.scrollIntoViewIfNeeded();
    await albedoOption.click();

    await waitForConnected(page);

    // ── Phase 4: Verify Albedo state ────────────────────────
    if (!isMobileViewport(page)) {
      await expect(page.getByText(`${ALBEDO_BALANCE} XLM`).first()).toBeVisible({
        timeout: 10000,
      });

      await expect(page.getByText("TESTNET").first()).toBeVisible();
    }

    const shortAb = shorten(ALBEDO_PK);
    await expect(page.getByText(shortAb).first()).toBeVisible();

    // Freighter address must NOT be visible (no stale state)
    await expect(page.getByText(shortFg)).toHaveCount(0);
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

    if (!isMobileViewport(page)) {
      await expect(page.getByText(`${FREIGHTER_BALANCE} XLM`).first()).toBeVisible({
        timeout: 10000,
      });
      await expect(page.getByText("TESTNET").first()).toBeVisible();
    }
    const shortFg = shorten(FREIGHTER_PK);
    await expect(page.getByText(shortFg).first()).toBeVisible();
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

    await expect(page.getByText(`${FREIGHTER_BALANCE} XLM`)).toHaveCount(0);
  });

  test("no stale balance from previous wallet after switching", async ({
    page,
  }) => {
    injectWalletMocks(page, {
      freighter: true,
      albedo: true,
      freighterBalance: "50.00",
      albedoBalance: "999.90",
    });

    // Connect Freighter
    await interceptBalance(page, "50.00");
    await page.goto("/");
    await waitForConnected(page);
    if (!isMobileViewport(page)) {
      await expect(page.getByText("50.00 XLM").first()).toBeVisible({ timeout: 10000 });
    }
    const shortFg = shorten(FREIGHTER_PK);
    await expect(page.getByText(shortFg).first()).toBeVisible();

    // Disconnect
    await page.getByLabel("Disconnect wallet").click();
    await waitForDisconnected(page);

    // Connect Albedo with different balance
    await interceptBalance(page, "999.90");
    await page
      .getByRole("button", { name: /Connect Wallet/i })
      .first()
      .click();

    const albedoOption = page.locator("button").filter({ hasText: "Albedo" }).first();
    await expect(albedoOption).toBeVisible({ timeout: 10000 });
    await albedoOption.scrollIntoViewIfNeeded();
    await albedoOption.click();
    await waitForConnected(page);

    if (!isMobileViewport(page)) {
      await expect(page.getByText("999.90 XLM").first()).toBeVisible({ timeout: 10000 });
    }
    const shortAb = shorten(ALBEDO_PK);
    await expect(page.getByText(shortAb).first()).toBeVisible();

    // Freighter balance must NOT be visible
    await expect(page.getByText("50.00 XLM")).toHaveCount(0);
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
        .getByText("Installed")
        .first(),
    ).toBeVisible({ timeout: 10000 });

    // xBull shows "Not found"
    await expect(
      page
        .locator("button")
        .filter({ hasText: "xBull" })
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

    // Click the backdrop outside the dialog card
    const backdrop = page.locator("[role='dialog'] > div.absolute.inset-0").first();
    await backdrop.click({ position: { x: 10, y: 10 } });

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
    test.skip(isMobileViewport(page), "Balance badge is hidden on mobile viewports (< 640px)");
    injectWalletMocks(page, { freighter: true });
    await interceptBalance(page, "42.00");

    await page.goto("/");
    await waitForConnected(page);

    await expect(page.getByText("42.00 XLM").first()).toBeVisible({ timeout: 10000 });

    // Change intercept to return new balance
    await page.unroute(ACCOUNT_ROUTE);
    await interceptBalance(page, "55.00");

    await page.getByTitle("Refresh balance").click();

    await expect(page.getByText("55.00 XLM").first()).toBeVisible({ timeout: 10000 });
  });
});
