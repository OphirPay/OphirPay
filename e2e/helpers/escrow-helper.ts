// SPDX-License-Identifier: MIT
//
// Deterministic escrow + dispute mocks for `e2e/escrow-dispute.spec.ts`.
//
// The escrows page reads its list/count from the app's `/api/escrows` routes
// and signs create/claim/release/dispute calls directly against Soroban RPC
// through Freighter. There is no webServer in this repo's Playwright config, so
// the test must own both boundaries:
//
//   • `/api/auth/*` and `/api/csrf` — the wallet-only session + CSRF handshake
//   • `/api/escrows` and `/api/escrows/:id` — a stateful escrow ledger
//   • Horizon `/accounts/:id` — wallet balances shown by WalletButton
//   • Horizon `/transactions/:hash` — confirmation fallback used by the SDK
//   • Soroban RPC — reuses `stellar-mock.ts`, with a small hook that advances
//     the escrow state when `initiate_dispute` / `resolve_dispute` is submitted
//
// The route handlers run in the Playwright test process, so the exported
// `EscrowState` is shared with the spec and can be asserted directly.

import { Keypair } from "@stellar/stellar-sdk";
import type { Page } from "@playwright/test";
import {
  SIGNER_A,
  SIGNER_B,
  createState,
  fakeFreighterInitScript as baseFakeFreighterInitScript,
  horizonHandler,
  rpcHandler,
  type MultisigState,
} from "./stellar-mock";

export { SIGNER_A, SIGNER_B };

const WALLET_STORAGE_KEY = "e2e:escrow-wallet";

/**
 * Fake Freighter whose selected address survives `page.reload()`.
 *
 * The dispute flow switches between buyer, seller and arbiter by changing the
 * wallet address and reloading; a plain addInitScript would reset every reload
 * to the buyer and hide the seller's view under test.
 */
export function fakeFreighterInitScript(initialAddress: string): string {
  return baseFakeFreighterInitScript(initialAddress, WALLET_STORAGE_KEY);
}

/** Shape returned by `GET /api/escrows/:id` and rendered by the page. */
export interface EscrowRecord {
  id: number;
  depositor: string;
  beneficiary: string;
  arbiter: string | null;
  /** Stellar stroops. */
  amount: number;
  asset: string;
  deadline: number;
  released: boolean;
  claimed: boolean;
  metadata: string;
  /** 0 when no dispute is open. */
  dispute_initiated_at: number;
}

export interface EscrowState {
  escrow: EscrowRecord;
  /** Horizon native balances keyed by Stellar address. */
  balances: Record<string, string>;
  /** Chain-side state consumed by the reused Soroban RPC handler. */
  chain: MultisigState;
  /** Contract entrypoints observed in `sendTransaction`, in order. */
  actions: string[];
  /** Timestamp written when a dispute is opened. */
  disputeOpenedAt: number;
}

export function createEscrowState(
  overrides: Partial<EscrowRecord> = {},
): EscrowState {
  const arbiter = Keypair.random().publicKey();
  const now = Math.floor(Date.now() / 1000);
  const escrow: EscrowRecord = {
    id: 1,
    depositor: SIGNER_A,
    beneficiary: SIGNER_B,
    arbiter,
    amount: 250_000_000, // 25 XLM
    asset: "native",
    // Already due, so the beneficiary's claim button is rendered and can be
    // asserted as disabled while the dispute is active.
    deadline: now - 60,
    released: false,
    claimed: false,
    metadata: "Milestone 1",
    dispute_initiated_at: 0,
    ...overrides,
  };

  return {
    escrow,
    balances: {
      [SIGNER_A]: "1000.0000000",
      [SIGNER_B]: "50.0000000",
      [arbiter]: "10.0000000",
    },
    chain: createState({ activeSigner: SIGNER_A }),
    actions: [],
    disputeOpenedAt: now,
  };
}

/** Switch the mocked browser wallet and the RPC account source together. */
export function switchEscrowActor(state: EscrowState, address: string): void {
  state.chain.activeSigner = address;
}

function addXlm(balance: string, stroops: number): string {
  return ((Number(balance) || 0) + stroops / 10_000_000).toFixed(7);
}

function isDisputeFunction(transactionXdr: string, name: string): boolean {
  // The contract symbol is stored verbatim in the envelope's ScVal, so a
  // base64-decoded substring check is enough to identify the entrypoint without
  // re-implementing the SDK's XDR walker in the mock.
  return Buffer.from(transactionXdr, "base64").toString("latin1").includes(name);
}

export async function installEscrowMocks(
  page: Page,
  state: EscrowState,
): Promise<void> {
  // Wallet-only session: the fake Freighter exposes a dummy signMessage, so
  // accept the proof rather than requiring a real challenge signature.
  await page.route("**/api/auth/challenge**", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        data: { challenge: "mock-challenge", message: "mock message" },
      }),
    });
  });
  await page.route("**/api/auth/session**", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ success: true, data: { authenticated: true } }),
    });
  });
  await page.route("**/api/csrf**", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ token: "e2e-csrf-token" }),
    });
  });

  // Escrow ledger: the page first reads the count, then each record by id.
  await page.route("**/api/escrows**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/escrows/id" || url.pathname === "/api/escrows") {
      if (url.pathname === "/api/escrows" && !url.searchParams.get("id")) {
        await route.fulfill({
          contentType: "application/json",
          body: JSON.stringify({ success: true, data: { count: 1 } }),
        });
        return;
      }
      if (url.searchParams.get("id") === String(state.escrow.id)) {
        await route.fulfill({
          contentType: "application/json",
          body: JSON.stringify({ success: true, data: state.escrow }),
        });
        return;
      }
    }

    const match = url.pathname.match(/^\/api\/escrows\/(\d+)$/);
    if (match && Number(match[1]) === state.escrow.id) {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ success: true, data: state.escrow }),
      });
      return;
    }

    await route.fulfill({
      status: 404,
      contentType: "application/json",
      body: JSON.stringify({
        success: false,
        error: { message: "Escrow not found" },
      }),
    });
  });

  // Horizon: wallet balances plus the transaction-confirmation fallback.
  await page.route(
    (url) => url.hostname.includes("horizon"),
    async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname.startsWith("/accounts/")) {
        const address = decodeURIComponent(url.pathname.split("/")[2] ?? "");
        await route.fulfill({
          contentType: "application/json",
          body: JSON.stringify({
            account_id: address,
            // Required by the SDK's AccountResponse constructor.
            sequence: "123456789",
            balances: [
              {
                asset_type: "native",
                balance: state.balances[address] ?? "0.0000000",
              },
            ],
          }),
        });
        return;
      }
      return horizonHandler()(route);
    },
  );

  // Soroban RPC: delegate to the shared healthy-node mock, but advance the
  // escrow state when the submitted envelope names a dispute entrypoint.
  const baseRpc = rpcHandler(state.chain);
  await page.route(
    (url) => url.hostname.includes("soroban"),
    async (route) => {
      const body = route.request().postDataJSON() as
        | { method?: string; params?: { transaction?: string } }
        | null;

      if (
        body?.method === "sendTransaction" &&
        typeof body.params?.transaction === "string"
      ) {
        const xdr = body.params.transaction;
        if (isDisputeFunction(xdr, "initiate_dispute")) {
          state.actions.push("initiate_dispute");
          state.escrow.dispute_initiated_at = state.disputeOpenedAt;
        }
        if (isDisputeFunction(xdr, "resolve_dispute")) {
          state.actions.push("resolve_dispute");
          // The spec resolves in favour of the buyer (the depositor), so the
          // escrowed principal returns to the depositor's wallet.
          state.escrow.released = true;
          state.escrow.claimed = true;
          state.escrow.dispute_initiated_at = 0;
          state.balances[state.escrow.depositor] = addXlm(
            state.balances[state.escrow.depositor] ?? "0",
            state.escrow.amount,
          );
        }
      }

      return baseRpc(route);
    },
  );
}
