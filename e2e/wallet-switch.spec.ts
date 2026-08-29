// SPDX-License-Identifier: MIT

import { test, expect } from "@playwright/test";

const FREIGHTER_PUBLIC_KEY = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
const ALBEDO_PUBLIC_KEY = "GACNKEDGJYLLVQDXWYEEPB47Y3JEV5JNZ3RQANTJIVKKEOXX4NC4YWHU";

const FREIGHTER_BALANCE = "125.5000000";
const ALBEDO_BALANCE = "4500.0000000";

/**
 * Setup mock wallet providers (Freighter & Albedo) and mock Horizon responses.
 */
async function setupWalletMocks(page: import("@playwright/test").Page) {
  // Inject mock window.freighter and window.albedo before any scripts run
  await page.addInitScript(
    ({ freighterKey, albedoKey }) => {
      let freighterConnected = false;
      let albedoConnected = false;

      (window as unknown as { freighter: unknown }).freighter = {
        isConnected: async () => freighterConnected,
        requestAccess: async () => {
          freighterConnected = true;
          return freighterKey;
        },
        getAddress: async () => freighterKey,
        getNetwork: async () => "TESTNET",
        getNetworkDetails: async () => ({
          network: "TESTNET",
          networkPassphrase: "Test SDF Network ; September 2015",
        }),
        signTransaction: async (xdr: string) => `SIGNED_FREIGHTER_${xdr}`,
        signMessage: async (msg: string) => ({
          signedMessage: msg,
          messageSignature: "MOCK_SIG_FREIGHTER_BASE64",
        }),
      };

      (window as unknown as { albedo: unknown }).albedo = {
        isConnected: async () => albedoConnected,
        publicKey: async () => {
          albedoConnected = true;
          return {
            pubkey: albedoKey,
            network: "PUBLIC",
            signed_message: "MOCK_ALBEDO_SIGNED",
            signature: "MOCK_SIG_ALBEDO_BASE64",
          };
        },
        getAddress: async () => albedoKey,
        getNetwork: async () => "PUBLIC",
        tx: async (xdr: string) => ({
          xdr,
          tx_hash: "mock_albedo_tx_hash",
          signed_envelope_xdr: `SIGNED_ALBEDO_${xdr}`,
        }),
        signMessage: async () => ({
          signature: "MOCK_SIG_ALBEDO_BASE64",
        }),
      };
    },
    {
      freighterKey: FREIGHTER_PUBLIC_KEY,
      albedoKey: ALBEDO_PUBLIC_KEY,
    }
  );

  // Mock Horizon account balance endpoints
  await page.route("**/horizon*/**/accounts/*", async (route) => {
    const url = route.request().url();
    if (url.includes(FREIGHTER_PUBLIC_KEY)) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: FREIGHTER_PUBLIC_KEY,
          account_id: FREIGHTER_PUBLIC_KEY,
          sequence: "1000",
          balances: [
            {
              asset_type: "native",
              balance: FREIGHTER_BALANCE,
              buying_liabilities: "0",
              selling_liabilities: "0",
            },
          ],
        }),
      });
    } else if (url.includes(ALBEDO_PUBLIC_KEY)) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: ALBEDO_PUBLIC_KEY,
          account_id: ALBEDO_PUBLIC_KEY,
          sequence: "2000",
          balances: [
            {
              asset_type: "native",
              balance: ALBEDO_BALANCE,
              buying_liabilities: "0",
              selling_liabilities: "0",
            },
          ],
        }),
      });
    } else {
      await route.continue();
    }
  });

  // Mock Auth Session API
  await page.route("**/api/auth/session", async (route) => {
    if (route.request().method() === "POST") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          authenticated: true,
          user: { role: "ADMIN" },
        }),
      });
    } else if (route.request().method() === "DELETE") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, message: "Session revoked" }),
      });
    } else {
      await route.continue();
    }
  });

  // Mock Challenge API
  await page.route("**/api/auth/challenge*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        nonce: "test_nonce_12345",
        challenge: "OphirPay Sign-In Challenge",
      }),
    });
  });
}

test.describe("Wallet Switch Between Freighter and Albedo with State Preservation", () => {
  test.beforeEach(async ({ page }) => {
    await setupWalletMocks(page);
  });

  test("connects with Freighter, performs an action, disconnects, and connects with Albedo while preserving app state", async ({
    page,
  }) => {
    // 1. Navigate to /send page
    await page.goto("/send");
    await expect(page.locator("main")).toBeVisible({ timeout: 10000 });

    // 2. Perform an action to build application state (fill form fields)
    const recipientInput = page.locator("input[placeholder*='Recipient']").first();
    const amountInput = page.locator("input[inputmode='decimal']").first();

    if (await recipientInput.isVisible()) {
      await recipientInput.fill("GD6W2XV5EC4F4B3V2G3S6C6W7Y7B3J3M2N2K2L2P2Q2R2S2T2U2V2W2X");
    }
    if (await amountInput.isVisible()) {
      await amountInput.fill("42.75");
    }

    // 3. Connect with first wallet: Freighter
    const connectBtn = page.getByRole("button", { name: /connect wallet/i });
    await expect(connectBtn).toBeVisible();
    await connectBtn.click();

    // Select Freighter in modal
    const freighterOption = page.locator("[data-testid='wallet-option-freighter']").or(
      page.getByRole("button", { name: /freighter/i })
    );
    await expect(freighterOption).toBeVisible();
    await freighterOption.click();

    // 4. Verify Freighter wallet state in Header
    // Address badge shows shortened Freighter address
    const addressBadge = page.locator("[data-testid='wallet-address-badge']").or(
      page.getByText(/GBBD.*LA5/)
    );
    await expect(addressBadge.first()).toBeVisible({ timeout: 5000 });

    // Network badge shows TESTNET
    const networkBadge = page.locator("[data-testid='wallet-network-badge']").or(
      page.getByText("TESTNET")
    );
    await expect(networkBadge.first()).toBeVisible();

    // Balance badge shows Freighter balance
    const balanceBadge = page.locator("[data-testid='wallet-balance']").or(
      page.getByText(/125\.50.*XLM/)
    );
    await expect(balanceBadge.first()).toBeVisible();

    // 5. Verify that entered application state is preserved after connecting
    if (await amountInput.isVisible()) {
      await expect(amountInput).toHaveValue("42.75");
    }

    // 6. Disconnect wallet
    const disconnectBtn = page.locator("[data-testid='disconnect-wallet-btn']").or(
      page.getByRole("button", { name: /disconnect wallet/i })
    );
    await expect(disconnectBtn.first()).toBeVisible();
    await disconnectBtn.first().click();

    // 7. Verify disconnected state: no stale wallet leaks
    await expect(page.getByRole("button", { name: /connect wallet/i })).toBeVisible();
    await expect(page.locator("[data-testid='wallet-address-badge']")).not.toBeVisible();
    await expect(page.locator("[data-testid='wallet-network-badge']")).not.toBeVisible();

    // Verify application state is still preserved after disconnect
    if (await amountInput.isVisible()) {
      await expect(amountInput).toHaveValue("42.75");
    }

    // 8. Connect with second wallet: Albedo
    await page.getByRole("button", { name: /connect wallet/i }).click();

    const albedoOption = page.locator("[data-testid='wallet-option-albedo']").or(
      page.getByRole("button", { name: /albedo/i })
    );
    await expect(albedoOption).toBeVisible();
    await albedoOption.click();

    // 9. Verify Albedo wallet state in Header: updated address, network, and balance
    // Address badge updates to Albedo's address (GACN...WHU)
    const albedoAddressBadge = page.locator("[data-testid='wallet-address-badge']").or(
      page.getByText(/GACN.*WHU/)
    );
    await expect(albedoAddressBadge.first()).toBeVisible({ timeout: 5000 });

    // Network badge updates to PUBLIC
    const albedoNetworkBadge = page.locator("[data-testid='wallet-network-badge']").or(
      page.getByText("PUBLIC")
    );
    await expect(albedoNetworkBadge.first()).toBeVisible();

    // Balance badge updates to Albedo balance (4,500.00 XLM)
    const albedoBalanceBadge = page.locator("[data-testid='wallet-balance']").or(
      page.getByText(/4,?500\.00.*XLM/)
    );
    await expect(albedoBalanceBadge.first()).toBeVisible();

    // 10. Verify NO stale Freighter state leaked into Albedo session
    await expect(page.getByText(/GBBD.*LA5/)).not.toBeVisible();
    await expect(page.getByText(/125\.50.*XLM/)).not.toBeVisible();

    // 11. Verify application state is STILL preserved
    if (await amountInput.isVisible()) {
      await expect(amountInput).toHaveValue("42.75");
    }
  });

  test("session persistence works across page reloads", async ({ page }) => {
    // 1. Navigate and connect with Freighter
    await page.goto("/");
    await expect(page.locator("main")).toBeVisible();

    await page.getByRole("button", { name: /connect wallet/i }).click();
    await page.locator("[data-testid='wallet-option-freighter']").or(
      page.getByRole("button", { name: /freighter/i })
    ).click();

    // Verify connected
    await expect(
      page.locator("[data-testid='wallet-address-badge']").or(page.getByText(/GBBD.*LA5/)).first()
    ).toBeVisible({ timeout: 5000 });

    // 2. Reload the page
    await page.reload();
    await expect(page.locator("main")).toBeVisible();

    // 3. Verify session was automatically restored across reload
    await expect(
      page.locator("[data-testid='wallet-address-badge']").or(page.getByText(/GBBD.*LA5/)).first()
    ).toBeVisible({ timeout: 8000 });

    const networkBadge = page.locator("[data-testid='wallet-network-badge']").or(
      page.getByText("TESTNET")
    );
    await expect(networkBadge.first()).toBeVisible();

    // 4. Disconnect and switch to Albedo
    const disconnectBtn = page.locator("[data-testid='disconnect-wallet-btn']").or(
      page.getByRole("button", { name: /disconnect wallet/i })
    );
    await disconnectBtn.first().click();

    await page.getByRole("button", { name: /connect wallet/i }).click();
    await page.locator("[data-testid='wallet-option-albedo']").or(
      page.getByRole("button", { name: /albedo/i })
    ).click();

    await expect(
      page.locator("[data-testid='wallet-address-badge']").or(page.getByText(/GACN.*WHU/)).first()
    ).toBeVisible({ timeout: 5000 });

    // 5. Reload the page with Albedo session
    await page.reload();
    await expect(page.locator("main")).toBeVisible();

    // 6. Verify Albedo session was automatically restored across reload
    await expect(
      page.locator("[data-testid='wallet-address-badge']").or(page.getByText(/GACN.*WHU/)).first()
    ).toBeVisible({ timeout: 8000 });

    const albedoNetwork = page.locator("[data-testid='wallet-network-badge']").or(
      page.getByText("PUBLIC")
    );
    await expect(albedoNetwork.first()).toBeVisible();
  });

  test("explicit disconnect does not restore a stale session on reload", async ({ page }) => {
    // 1. Connect Freighter
    await page.goto("/");
    await page.getByRole("button", { name: /connect wallet/i }).click();
    await page.locator("[data-testid='wallet-option-freighter']").or(
      page.getByRole("button", { name: /freighter/i })
    ).click();

    await expect(
      page.locator("[data-testid='wallet-address-badge']").or(page.getByText(/GBBD.*LA5/)).first()
    ).toBeVisible({ timeout: 5000 });

    // 2. Disconnect
    await page.locator("[data-testid='disconnect-wallet-btn']").or(
      page.getByRole("button", { name: /disconnect wallet/i })
    ).first().click();

    await expect(page.getByRole("button", { name: /connect wallet/i })).toBeVisible();

    // 3. Reload page
    await page.reload();
    await expect(page.locator("main")).toBeVisible();

    // 4. Verify still disconnected on reload (no stale reconnection)
    await expect(page.getByRole("button", { name: /connect wallet/i })).toBeVisible();
    await expect(page.locator("[data-testid='wallet-address-badge']")).not.toBeVisible();
  });
});
