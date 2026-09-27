// SPDX-License-Identifier: MIT
//
// Shared E2E mocks for the admin surfaces (issues #708 / #709).
//
// These pages mix two kinds of I/O:
//
//   1. Read APIs (`/api/pause-state`, `/api/timelock`, `/api/hooks`,
//      `/api/fee-config`, `/api/rbac`, `/api/keys`) — mocked here with small
//      in-memory stores that mutate as the page POSTs/PATCHes/DELETEs, so a
//      refetch after a successful action reflects the change.
//   2. On-chain writes (pause/unpause, propose/execute/cancel, register/unregister
//      hook, fee config, roles) — these run in the browser through
//      `@/lib/contract-advanced` and the Stellar SDK, so they reuse the existing
//      Soroban RPC + Horizon + fake-Freighter mocks in `stellar-mock.ts` rather
//      than introducing a second interception layer.
//
// Wallet connection is provided by the same mocked auth session the multisig
// flow uses, so the pages auto-connect as SIGNER_A.

import type { Page, Route } from "@playwright/test";
import {
  createState,
  fakeFreighterInitScript,
  installMultisigMocks,
  SIGNER_A,
} from "./stellar-mock";

/** Valid Stellar public keys used by the grant/revoke and hook flows. */
export const VALID_ADDRESS_A = SIGNER_A;
export const VALID_ADDRESS_B =
  "GACNKEDGJYLLVQDXWYEEPB47Y3JEV5JNZ3RQANTJIVKKEOXX4NC4YWHU";

export interface PauseStateRecord {
  paused: boolean | "unknown";
  available: boolean;
}

export interface TimelockActionRecord {
  id: number;
  action_type: string;
  target: string;
  data: string;
  proposed_by: string;
  proposed_at: number;
  unlocks_at: number;
  executed: boolean;
}

export interface HookRecord {
  id: string;
  userId: string;
  eventType: string;
  webhookUrl: string;
  active: boolean;
  createdAt: string;
  onChainId: number | null;
}

export interface FeeConfigRecord {
  payment_fee_bps: number;
  escrow_fee_bps: number;
  stream_fee_bps: number;
  batch_base_fee: number;
  batch_per_item_fee: number;
  enabled: boolean;
}

export interface ApiKeyRecord {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  lastUsed: string | null;
  createdAt: string;
  expiresAt: string | null;
}

export interface KeyUsageRecord {
  id: string;
  name: string;
  prefix: string;
  lastUsed: string | null;
  createdAt: string;
  expiresAt: string | null;
  total: number;
  window: number;
}

export interface AdminMockState {
  pause: PauseStateRecord;
  timelock: TimelockActionRecord[];
  hooks: HookRecord[];
  feeConfig: FeeConfigRecord;
  /** Role the connected wallet holds (Role.Admin = 0). */
  ownRole: number | null;
  apiKeys: ApiKeyRecord[];
  keyUsage: KeyUsageRecord[];
  /** Raw key value returned by POST /api/keys. */
  createdKey: string;
}

const nowSec = () => Math.floor(Date.now() / 1000);

function fulfillJson(route: Route, body: unknown, status = 200): Promise<void> {
  return route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

/**
 * Install the admin-page mocks. Returns the mutable store so a test can seed
 * fixtures before navigation or assert what the page wrote back.
 */
export async function installAdminMocks(
  page: Page,
  overrides: Partial<AdminMockState> = {}
): Promise<AdminMockState> {
  const state: AdminMockState = {
    pause: { paused: false, available: true },
    timelock: [],
    hooks: [],
    feeConfig: {
      payment_fee_bps: 10,
      escrow_fee_bps: 5,
      stream_fee_bps: 2,
      batch_base_fee: 0,
      batch_per_item_fee: 0,
      enabled: true,
    },
    ownRole: 0,
    apiKeys: [],
    keyUsage: [],
    createdKey: "op_e2e_0123456789abcdef0123456789abcdef",
    ...overrides,
  };

  // Reuse the wallet + Soroban RPC + Horizon mocks; the wallet auto-connects
  // because the auth session route is mocked to accept any proof.
  await page.addInitScript(fakeFreighterInitScript(SIGNER_A));
  await installMultisigMocks(page, createState({ activeSigner: SIGNER_A }));

  // apiFetch (used by several pages) mints a CSRF token before mutating.
  await page.route("**/api/csrf", (route) =>
    fulfillJson(route, { token: "e2e-csrf-token" })
  );

  await page.route("**/api/pause-state**", (route) =>
    fulfillJson(route, {
      data: { paused: state.pause.paused, available: state.pause.available },
    })
  );

  await page.route("**/api/timelock**", (route) =>
    fulfillJson(route, { data: state.timelock })
  );

  await page.route("**/api/fee-config**", (route) => {
    if (route.request().method().toUpperCase() !== "GET") {
      return route.continue();
    }
    return fulfillJson(route, { data: state.feeConfig });
  });

  await page.route("**/api/rbac**", (route) =>
    fulfillJson(route, {
      data: { address: VALID_ADDRESS_A, role: state.ownRole },
    })
  );

  await page.route("**/api/hooks**", (route) => {
    const request = route.request();
    const method = request.method().toUpperCase();
    const path = new URL(request.url()).pathname;

    if (method === "GET") return fulfillJson(route, { data: state.hooks });

    if (method === "POST") {
      const body = (request.postDataJSON() ?? {}) as {
        eventType?: string;
        webhookUrl?: string;
        onChainId?: number;
      };
      const hook: HookRecord = {
        id: `hk_e2e_${state.hooks.length + 1}`,
        userId: "user_e2e",
        eventType: body.eventType ?? "payment_recorded",
        webhookUrl: body.webhookUrl ?? "",
        active: true,
        createdAt: new Date().toISOString(),
        onChainId: typeof body.onChainId === "number" ? body.onChainId : null,
      };
      state.hooks = [hook, ...state.hooks];
      return fulfillJson(route, { data: hook });
    }

    if (method === "PATCH") {
      const id = path.split("/").pop();
      state.hooks = state.hooks.map((h) =>
        h.id === id ? { ...h, active: false } : h
      );
      return fulfillJson(route, { data: state.hooks.find((h) => h.id === id) });
    }

    return route.continue();
  });

  await page.route("**/api/keys**", (route) => {
    const request = route.request();
    const method = request.method().toUpperCase();
    const url = new URL(request.url());

    if (url.pathname === "/api/keys/stats") {
      return fulfillJson(route, {
        data: {
          window: url.searchParams.get("window") ?? "30d",
          keys: state.keyUsage,
        },
      });
    }

    if (method === "GET") return fulfillJson(route, { data: state.apiKeys });

    if (method === "POST") {
      const body = (request.postDataJSON() ?? {}) as {
        name?: string;
        scopes?: string[];
      };
      const record: ApiKeyRecord = {
        id: `key_e2e_${state.apiKeys.length + 1}`,
        name: body.name ?? "",
        prefix: state.createdKey.slice(0, 8),
        scopes: body.scopes ?? [],
        lastUsed: null,
        createdAt: new Date().toISOString(),
        expiresAt: null,
      };
      state.apiKeys = [record, ...state.apiKeys];
      return fulfillJson(route, { data: { ...record, key: state.createdKey } });
    }

    if (method === "PATCH") {
      const body = (request.postDataJSON() ?? {}) as {
        id?: string;
        scopes?: string[];
      };
      state.apiKeys = state.apiKeys.map((k) =>
        k.id === body.id ? { ...k, scopes: body.scopes ?? [] } : k
      );
      return fulfillJson(route, {
        data: state.apiKeys.find((k) => k.id === body.id),
      });
    }

    if (method === "DELETE") {
      const id = url.searchParams.get("id");
      state.apiKeys = state.apiKeys.filter((k) => k.id !== id);
      return fulfillJson(route, { data: { id } });
    }

    return route.continue();
  });

  return state;
}

/** A locked (not-yet-ready) timelock action. */
export function lockedAction(
  overrides: Partial<TimelockActionRecord> = {}
): TimelockActionRecord {
  return {
    id: 1,
    action_type: "set_fee_config",
    target: "",
    data: "",
    proposed_by: SIGNER_A,
    proposed_at: nowSec() - 60,
    unlocks_at: nowSec() + 5 * 3600,
    executed: false,
    ...overrides,
  };
}

/** An unlocked, executable timelock action. */
export function readyAction(
  overrides: Partial<TimelockActionRecord> = {}
): TimelockActionRecord {
  return {
    id: 2,
    action_type: "set_fee_collector",
    target: VALID_ADDRESS_B,
    data: "",
    proposed_by: SIGNER_A,
    proposed_at: nowSec() - 86400,
    unlocks_at: nowSec() - 60,
    executed: false,
    ...overrides,
  };
}
