// SPDX-License-Identifier: MIT
//
// Deterministic refunds mocks for `e2e/refunds.spec.ts`.
//
// The refunds page drives `requestRefund` / `approveRefund` / `processRefund` /
// `rejectRefund` from @/lib/contract-advanced straight through the Soroban RPC
// and Horizon SDK boundaries (no app route behind them), then mirrors each
// on-chain outcome onto a ledger row via `/api/refunds` and
// `/api/refunds/[id]`. This helper satisfies both boundaries:
//
//   • `/api/auth/*` and `/api/csrf` — the wallet-only session + CSRF dance
//   • `/api/refunds` (GET/POST) and `/api/refunds/[id]` (PATCH) — a stateful
//     in-memory ledger so Request → Approve/Reject → Process transitions are
//     observable in the UI
//   • Soroban RPC + Horizon — reused from `stellar-mock.ts`, which routes the
//     SDK's "Bad union switch" limitation to the Horizon confirmation path
//
// The route handlers run in the Playwright test process, so `RefundsState` is
// shared with the test and can be asserted directly (request/patch counts,
// on-chain ids).

import type { Page } from "@playwright/test";
import {
  SIGNER_A,
  createState,
  horizonHandler,
  rpcHandler,
  type MultisigState,
} from "./stellar-mock";

export type RefundStatus = "REQUESTED" | "APPROVED" | "REJECTED" | "PROCESSED";

/** A ledger row as the UI consumes it (mirrors `src/app/refunds/page.tsx`). */
export interface RefundRecord {
  id: string;
  paymentId: string;
  userId: string;
  amount: string;
  asset: string;
  reason: string;
  reasonCode: number;
  status: RefundStatus;
  requestedAt: string;
  resolvedAt: string | null;
  onChainId: number;
}

export interface RefundsState {
  /** Ledger rows returned by `GET /api/refunds`. */
  refunds: RefundRecord[];
  /** Chain-side state consumed by the reused Soroban RPC handler. */
  chain: MultisigState;
  /** Monotonic ledger-row counter. */
  nextId: number;
  /** Monotonic on-chain refund id returned by `request_refund`. */
  nextOnChainId: number;
  postCount: number;
  patchCount: number;
}

export function createRefundsState(
  overrides: Partial<RefundsState> = {},
): RefundsState {
  return {
    refunds: [],
    chain: createState({ activeSigner: SIGNER_A }),
    nextId: 1,
    nextOnChainId: 7001,
    postCount: 0,
    patchCount: 0,
    ...overrides,
  };
}

/** Seed a ledger row without going through the on-chain request flow. */
export function makeRefund(
  state: RefundsState,
  overrides: Partial<RefundRecord> = {},
): RefundRecord {
  const record: RefundRecord = {
    id: `refund_${state.nextId++}`,
    paymentId: "42",
    userId: "user_e2e",
    amount: "100",
    asset: "native",
    reason: "Duplicate charge on invoice",
    reasonCode: 2,
    status: "REQUESTED",
    requestedAt: new Date("2026-08-14T00:00:00Z").toISOString(),
    resolvedAt: null,
    onChainId: state.nextOnChainId++,
    ...overrides,
  };
  state.refunds.unshift(record);
  return record;
}

export async function installRefundsMocks(
  page: Page,
  state: RefundsState,
): Promise<void> {
  // Wallet-only session: the fake Freighter exposes no usable signMessage, so
  // accept the session outright (same approach as the multisig e2e helper).
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

  // Stateful refunds ledger: `/api/refunds` and `/api/refunds/<id>`.
  await page.route("**/api/refunds**", async (route) => {
    const request = route.request();
    const method = request.method().toUpperCase();
    const url = new URL(request.url());

    if (method === "GET") {
      if (url.searchParams.get("analytics") === "true") {
        const buckets = [0, 1, 2, 3, 4, 5].map((code) => ({
          code,
          count: state.refunds.filter((r) => r.reasonCode === code).length,
        }));
        await route.fulfill({
          contentType: "application/json",
          body: JSON.stringify({ success: true, data: buckets }),
        });
        return;
      }
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ success: true, data: state.refunds }),
      });
      return;
    }

    if (method === "POST") {
      const body = (request.postDataJSON() ?? {}) as {
        paymentId?: number | string;
        amount?: number;
        asset?: string;
        reason?: string;
        reasonCode?: number;
        onChainId?: number;
      };
      state.postCount += 1;
      // Simulate the contract's request_refund return value: the id the UI
      // captured may be undefined (the mocked RPC path has no decodable
      // return value), so the ledger assigns the next on-chain id.
      const record: RefundRecord = {
        id: `refund_${state.nextId++}`,
        paymentId: String(body.paymentId ?? ""),
        userId: "user_e2e",
        amount: String(body.amount ?? ""),
        asset: body.asset ?? "native",
        reason: body.reason ?? "Refund requested",
        reasonCode: body.reasonCode ?? 0,
        status: "REQUESTED",
        requestedAt: new Date().toISOString(),
        resolvedAt: null,
        onChainId: body.onChainId ?? state.nextOnChainId++,
      };
      state.refunds.unshift(record);
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({ success: true, data: record }),
      });
      return;
    }

    if (method === "PATCH") {
      const id = decodeURIComponent(url.pathname.split("/").pop() ?? "");
      const body = (request.postDataJSON() ?? {}) as { status: RefundStatus };
      const refund = state.refunds.find((r) => r.id === id);
      if (refund) {
        refund.status = body.status;
        refund.resolvedAt = new Date().toISOString();
        state.patchCount += 1;
      }
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ success: true, data: { updated: Boolean(refund) } }),
      });
      return;
    }

    await route.continue();
  });

  // Soroban RPC + Horizon (external origins), reused from the multisig helper.
  await page.route((url) => url.hostname.includes("soroban"), rpcHandler(state.chain));
  await page.route(
    (url) => url.hostname.includes("horizon") && /\/transactions\/[0-9a-f]+$/.test(url.pathname),
    horizonHandler(),
  );
}
