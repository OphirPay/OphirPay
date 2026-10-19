// SPDX-License-Identifier: MIT
//
// Deterministic escrow mocks for `e2e/escrow-dispute.spec.ts` (issue #1405).
//
// The escrows page drives the dispute lifecycle entirely on-chain through
// `raiseEscrowDispute` / `resolveEscrowDispute` in `@/lib/contract-advanced`
// (the same client-side contract-call pattern used by claim/release/create).
// Those run in the browser and reach the Stellar SDK's Soroban RPC boundary, so
// the only way to exercise the full
//
//   buyer raises dispute  →  DISPUTED (funds held)  →  arbiter resolves
//
// UI deterministically is to satisfy the SDK at its own network boundary:
//
//   • `/api/auth/*` and `/api/csrf` — the wallet-only session + CSRF dance
//   • `GET /api/escrows`            — `{ data: { count, available } }`
//   • `GET /api/escrows/[id]`       — the seeded/updated on-chain record
//   • Soroban RPC `sendTransaction`  — flipped below: when the XDR carries
//     `raise_dispute` / `resolve_dispute` we flip `disputed` on the ledger so
//     the page's refetch (get_escrow) reveals the new state
//   • Horizon `getTransaction`       — reused from `stellar-mock.ts`
//
// The shared RPC handler is reused from `stellar-mock.ts` (its "Bad union
// switch" response routes the SDK to the Horizon confirmation path), and this
// helper only wraps it to mutate `EscrowsState` on the dispute mutation. The
// state is shared with the test (handlers run in the Playwright process), so
// the test can assert that the on-chain dispute transitioned the ledger.

import type { Page, Route } from "@playwright/test";
import {
  SIGNER_A,
  SIGNER_B,
  createState,
  horizonHandler,
  rpcHandler,
  type MultisigState,
} from "./stellar-mock";

/** A ledger escrow as the UI consumes it (mirrors `EscrowData`). */
export interface EscrowRecord {
  id: number;
  depositor: string;
  beneficiary: string;
  arbiter: string | null;
  amount: number;
  asset: string;
  deadline: number;
  released: boolean;
  claimed: boolean;
  metadata: string;
  disputed: boolean;
  disputeResolution: "BUYER" | "SELLER" | null;
}

export interface EscrowsState {
  /** Ledger rows keyed by id; the page refetches these after each mutation. */
  escrows: EscrowRecord[];
  /** Chain-side state consumed by the reused Soroban RPC handler. */
  chain: MultisigState;
}

export function createEscrowsState(
  overrides: Partial<EscrowsState> = {},
): EscrowsState {
  return {
    escrows: [],
    chain: createState({ activeSigner: SIGNER_A }),
    ...overrides,
  };
}

/** Seed a ledger escrow. Ids must be contiguous from 1 so the page's bounded
 *  range query (firstId..count) covers every seeded row. */
export function makeEscrow(
  state: EscrowsState,
  overrides: Partial<EscrowRecord> = {},
): EscrowRecord {
  const id = overrides.id ?? state.escrows.length + 1;
  const record: EscrowRecord = {
    id,
    depositor: SIGNER_A,
    beneficiary: SIGNER_B,
    arbiter: null,
    // 100 XLM in stroops (within the safe integer range so JSON keeps it exact).
    amount: 1_000_000_000,
    asset: "native",
    deadline: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 30,
    released: false,
    claimed: false,
    metadata: "Payment for delivered goods",
    disputed: false,
    disputeResolution: null,
    ...overrides,
  };
  state.escrows.push(record);
  return record;
}

function findEscrow(state: EscrowsState, id: number): EscrowRecord | undefined {
  return state.escrows.find((e) => e.id === id);
}

/** Inspect a Soroban `sendTransaction` payload and flip the ledger's disputed
 *  flag when the transaction invokes a dispute lifecycle function. The function
 *  name is stored inline as an SCVal symbol, so a byte scan of the XDR is a
 *  reliable, SDK-version-independent signal. */
function applyDisputeMutation(state: EscrowsState, transactionXdr: string): void {
  const raw = Buffer.from(transactionXdr, "base64").toString("latin1");
  if (raw.includes("raise_dispute")) {
    for (const e of state.escrows) {
      e.disputed = true;
      e.disputeResolution = null;
    }
  } else if (raw.includes("resolve_dispute")) {
    for (const e of state.escrows) {
      e.disputed = false;
      e.disputeResolution = "BUYER";
    }
  }
}

export async function installEscrowMocks(
  page: Page,
  state: EscrowsState,
): Promise<void> {
  // Wallet-only session: the fake Freighter exposes no usable signMessage, so
  // accept the session outright (same approach as the multisig/refunds helpers).
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

  // CSRF mint used by apiFetch before mutations.
  await page.route("**/api/csrf**", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ token: "e2e-csrf-token" }),
    });
  });

  // Stateful escrow reads: count + per-record lookups.
  await page.route("**/api/escrows**", async (route) => {
    const request = route.request();
    const method = request.method().toUpperCase();
    const url = new URL(request.url());
    const parts = url.pathname.split("/").filter(Boolean); // ["api","escrows", ...]

    if (method === "GET" && parts.length === 2) {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          data: { count: state.escrows.length, available: true },
        }),
      });
      return;
    }

    if (method === "GET" && parts.length === 3) {
      const id = Number(parts[2]);
      const escrow = findEscrow(state, id);
      if (!escrow) {
        await route.fulfill({
          status: 404,
          contentType: "application/json",
          body: JSON.stringify({ error: { message: "Escrow not found" } }),
        });
        return;
      }
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ data: escrow }),
      });
      return;
    }

    await route.continue();
  });

  // Soroban RPC (external origin) — flip the ledger on a dispute mutation,
  // then delegate to the shared handler that "executes" the transaction.
  const sharedRpc = rpcHandler(state.chain);
  await page.route(
    (url) => url.hostname.includes("soroban"),
    async (route: Route) => {
      if (route.request().method().toUpperCase() === "POST") {
        const post = route.request().postDataJSON() as
          | { method?: string; params?: { transaction?: string } }
          | null;
        if (post?.method === "sendTransaction" && post.params?.transaction) {
          applyDisputeMutation(state, post.params.transaction);
        }
      }
      await sharedRpc(route);
    },
  );

  // Horizon (external origin) — transaction confirmation lookup.
  await page.route(
    (url) => url.hostname.includes("horizon") && /\/transactions\/[0-9a-f]+$/.test(url.pathname),
    horizonHandler(),
  );
}
