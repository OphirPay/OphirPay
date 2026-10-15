// SPDX-License-Identifier: MIT
//
// Shared helpers for escrow E2E tests (issue #1405).
//
// Installs the same Soroban RPC + Horizon + Freighter mocks used by the
// multisig flow, plus escrow-specific API routes for the dispute lifecycle:
// creation, dispute initiation, arbitrator resolution, and fund release.

import type { Page, Route } from "@playwright/test";
import {
  createState,
  fakeFreighterInitScript,
  installMultisigMocks,
  SIGNER_A,
  SIGNER_B,
} from "./stellar-mock";

export interface EscrowRecord {
  id: number;
  depositor: string;
  beneficiary: string;
  amount: string;
  status: "PENDING" | "DISPUTED" | "RESOLVED" | "RELEASED" | "REFUNDED";
  deadline: number;
  arbitrator: string | null;
  dispute_reason: string | null;
  resolution: "BUYER" | "SELLER" | null;
  created_at: string;
  updated_at: string;
}

export interface EscrowState {
  escrows: EscrowRecord[];
  activeSigner: string;
}

function fulfillJson(route: Route, body: unknown, status = 200): Promise<void> {
  return route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

/**
 * Install all browser-side mocks for the escrow dispute E2E flow.
 * Returns the mutable store so tests can seed fixtures and assert state.
 */
export async function installEscrowMocks(
  page: Page,
  overrides: Partial<EscrowState> = {}
): Promise<EscrowState> {
  const state: EscrowState = {
    escrows: [],
    activeSigner: SIGNER_A,
    ...overrides,
  };

  // Wallet connection
  await page.addInitScript(fakeFreighterInitScript(SIGNER_A));
  await installMultisigMocks(page, createState({ activeSigner: SIGNER_A }));

  // CSRF token
  await page.route("**/api/csrf", (route) =>
    fulfillJson(route, { token: "e2e-csrf-token" })
  );

  // Escrow API routes
  await page.route("**/api/escrows**", async (route) => {
    const request = route.request();
    const method = request.method().toUpperCase();
    const url = new URL(request.url());
    const path = url.pathname;

    // GET /api/escrows — list all
    if (method === "GET" && path === "/api/escrows") {
      return fulfillJson(route, { data: state.escrows });
    }

    // GET /api/escrows/:id — single escrow
    const idMatch = path.match(/^\/api\/escrows\/(\d+)$/);
    if (method === "GET" && idMatch) {
      const id = parseInt(idMatch[1], 10);
      const escrow = state.escrows.find((e) => e.id === id);
      if (!escrow) {
        return fulfillJson(route, { error: "Escrow not found" }, 404);
      }
      return fulfillJson(route, { data: escrow });
    }

    // POST /api/escrows — create escrow
    if (method === "POST" && path === "/api/escrows") {
      const body = (request.postDataJSON() ?? {}) as Partial<EscrowRecord>;
      const now = new Date().toISOString();
      const escrow: EscrowRecord = {
        id: state.escrows.length + 1,
        depositor: body.depositor ?? SIGNER_A,
        beneficiary: body.beneficiary ?? SIGNER_B,
        amount: body.amount ?? "100",
        status: "PENDING",
        deadline: body.deadline ?? Math.floor(Date.now() / 1000) + 86400,
        arbitrator: body.arbitrator ?? null,
        dispute_reason: null,
        resolution: null,
        created_at: now,
        updated_at: now,
      };
      state.escrows.push(escrow);
      return fulfillJson(route, { data: escrow }, 201);
    }

    // POST /api/escrows/:id/dispute — buyer initiates dispute
    const disputeMatch = path.match(/^\/api\/escrows\/(\d+)\/dispute$/);
    if (method === "POST" && disputeMatch) {
      const id = parseInt(disputeMatch[1], 10);
      const escrow = state.escrows.find((e) => e.id === id);
      if (!escrow) {
        return fulfillJson(route, { error: "Escrow not found" }, 404);
      }
      const body = (request.postDataJSON() ?? {}) as { reason?: string };
      escrow.status = "DISPUTED";
      escrow.dispute_reason = body.reason ?? "Goods not received";
      escrow.updated_at = new Date().toISOString();
      return fulfillJson(route, { data: escrow });
    }

    // POST /api/escrows/:id/resolve — arbitrator resolves dispute
    const resolveMatch = path.match(/^\/api\/escrows\/(\d+)\/resolve$/);
    if (method === "POST" && resolveMatch) {
      const id = parseInt(resolveMatch[1], 10);
      const escrow = state.escrows.find((e) => e.id === id);
      if (!escrow) {
        return fulfillJson(route, { error: "Escrow not found" }, 404);
      }
      const body = (request.postDataJSON() ?? {}) as {
        resolution?: "BUYER" | "SELLER";
      };
      escrow.status = "RESOLVED";
      escrow.resolution = body.resolution ?? "BUYER";
      escrow.updated_at = new Date().toISOString();
      return fulfillJson(route, { data: escrow });
    }

    // POST /api/escrows/:id/release — release funds to beneficiary
    const releaseMatch = path.match(/^\/api\/escrows\/(\d+)\/release$/);
    if (method === "POST" && releaseMatch) {
      const id = parseInt(releaseMatch[1], 10);
      const escrow = state.escrows.find((e) => e.id === id);
      if (!escrow) {
        return fulfillJson(route, { error: "Escrow not found" }, 404);
      }
      escrow.status = "RELEASED";
      escrow.updated_at = new Date().toISOString();
      return fulfillJson(route, { data: escrow });
    }

    return route.continue();
  });

  return state;
}

/** Create an escrow record fixture. */
export function createEscrowFixture(
  overrides: Partial<EscrowRecord> = {}
): EscrowRecord {
  const now = new Date().toISOString();
  return {
    id: 1,
    depositor: SIGNER_A,
    beneficiary: SIGNER_B,
    amount: "100",
    status: "PENDING",
    deadline: Math.floor(Date.now() / 1000) + 86400,
    arbitrator: null,
    dispute_reason: null,
    resolution: null,
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}
