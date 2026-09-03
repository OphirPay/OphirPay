// SPDX-License-Identifier: MIT
//
// Deterministic Horizon mocks for the batch payment E2E flow.
//
// WHY THIS EXISTS
// --------------
// /batches/new drives the Stellar SDK directly in the browser
// (buildBatchPaymentTx → freighter signTransaction → submitSignedTx), so the
// full create → confirm → sign → submit → success flow can be exercised
// without a funded Testnet account by satisfying the SDK at its network
// boundary:
//
//   • GET  Horizon /accounts/{addr}  → a funded native-balance account
//     (backed by loadAccount for both the wallet balance and the tx builder)
//   • GET  Horizon /fee_stats        → { last_ledger_base_fee: "100" } — the
//     only field SDK 13.x fetchBaseFee() reads
//   • POST Horizon /transactions     → a successful submit response
//
// Auth endpoints are accepted outright (same as helpers/stellar-mock.ts) and
// the browser gets the same fake `window.freighter`, reused from
// stellar-mock.ts so both flows stay consistent.

import type { Page, Route } from "@playwright/test";

export {
  SIGNER_A,
  SIGNER_B,
  randomAddress,
  fakeFreighterInitScript,
} from "./stellar-mock";

/** Hash returned by the mocked transaction submit (any 64-char hex). */
export const MOCK_TX_HASH = "a".repeat(64);

/** XLM balance reported for the connected wallet (10,000 XLM). */
export const MOCK_BALANCE = "10000.0000000";

/**
 * A minimal-but-complete Horizon account record. SDK loadAccount() needs
 * account_id + sequence to build the tx source, and balances[] to report the
 * native balance in the wallet card.
 */
function horizonAccount(publicKey: string, balance: string) {
  return {
    id: publicKey,
    account_id: publicKey,
    sequence: "1234567",
    paging_token: publicKey,
    subentry_count: 0,
    thresholds: { low_threshold: 0, med_threshold: 0, high_threshold: 0 },
    flags: {
      auth_required: false,
      auth_revocable: false,
      auth_immutable: false,
      auth_clawback_enabled: false,
    },
    signers: [
      { key: publicKey, weight: 0, type: "ed25519_public_key" },
    ],
    data: {},
    // Horizon account data attributes (base64 values). The tx build path
    // probes data_attr["config.memo_required"] to enforce receiver memos —
    // absent means no memo required.
    data_attr: {},
    balances: [
      {
        balance,
        buy_liabilities: "0.0000000",
        selling_liabilities: "0.0000000",
        asset_type: "native",
        last_modified_ledger: 1,
      },
    ],
    last_modified_ledger: 1,
    last_modified_time: "2026-01-01T00:00:00Z",
    _links: { self: { href: "" }, transactions: { href: "" }, operations: { href: "" } },
  };
}

async function fulfillJson(route: Route, body: unknown, status = 200) {
  await route.fulfill({
    contentType: "application/json",
    status,
    body: JSON.stringify(body),
  });
}

/**
 * Installs all browser-side mocks the batch flow needs: the auth session
 * (accepted outright) plus Horizon account / fee_stats / transactions.
 *
 * Call once per test, before `page.goto("/batches/new")`.
 */
export async function installBatchMocks(
  page: Page,
  opts: { balance?: string } = {}
): Promise<void> {
  const balance = opts.balance ?? MOCK_BALANCE;

  // Auth session: accepted outright (the fake freighter's dummy signMessage
  // proof is not verified here — same approach as helpers/stellar-mock.ts).
  await page.route("**/api/auth/challenge**", async (route) => {
    await fulfillJson(route, {
      data: { challenge: "mock-challenge", message: "mock message" },
    });
  });
  await page.route("**/api/auth/session**", async (route) => {
    await fulfillJson(route, { success: true, data: { authenticated: true } });
  });

  // Horizon (external origin) — account lookups (balance + tx build source).
  await page.route(
    (url) =>
      url.hostname.includes("horizon") && /\/accounts\/[A-Z0-9]{56}$/.test(url.pathname),
    async (route) => {
      const url = new URL(route.request().url());
      const publicKey = url.pathname.split("/").pop() as string;
      await fulfillJson(route, horizonAccount(publicKey, balance));
    }
  );

  // fetchBaseFee() reads exactly `last_ledger_base_fee` in SDK 13.x.
  await page.route(
    (url) => url.hostname.includes("horizon") && url.pathname.endsWith("/fee_stats"),
    async (route) => fulfillJson(route, { last_ledger_base_fee: "100" })
  );

  // submitSignedTx() → server.submitTransaction → POST /transactions.
  await page.route(
    (url) => url.hostname.includes("horizon") && url.pathname.endsWith("/transactions"),
    async (route) => {
      if (route.request().method().toUpperCase() !== "POST") {
        await route.fulfill({ contentType: "application/json", status: 200, body: "{}" });
        return;
      }
      await fulfillJson(route, {
        successful: true,
        hash: MOCK_TX_HASH,
        paging_token: "1",
        envelope_xdr: "",
        result_xdr: "",
        _links: { transaction: { href: "" } },
      });
    }
  );
}
