// SPDX-License-Identifier: MIT
//
// Deterministic Soroban RPC + Horizon mocks for the multisig E2E flow.
//
// WHY THIS EXISTS
// --------------
// The app's multisig page calls proposeMultisigPayment / approveMultisigPayment /
// executeApprovedPayment from @/lib/contract-advanced. Those run inside the
// browser and drive the @stellar/stellar-sdk `rpc.Server` (Soroban RPC) plus
// Horizon directly — there is no app API route behind them. The repo's
// Playwright suite has no webServer and runs against a live deployment with no
// browser wallet and no funded Testnet contract, so the only way to exercise
// the full propose -> approve x2 -> execute UI deterministically is to satisfy
// the SDK at its own network boundary:
//
//   • GET  window.freighter            → a fake wallet (injected via addInitScript)
//   • POST Soroban RPC getLedgerEntries → a valid AccountEntry (for getAccount)
//   • POST Soroban RPC simulateTransaction → a successful SorobanTransactionData
//   • POST Soroban RPC sendTransaction    → PENDING (accepted)
//   • POST Soroban RPC getTransaction     → an unparseable protocol-27 result
//     that makes the SDK throw "Bad union switch" — the exact code path the
//     app already handles (see submitContractInvocation) before falling back
//   • GET  Horizon /transactions/{hash}   → { successful: true }
//
// The "Bad union switch" response is a TransactionMeta header whose union
// discriminant (5) has no decoding arm in this SDK version; xdr.TransactionMeta
// rejects it exactly the way it rejects real protocol-27 responses, routing the
// SDK to the Horizon confirmation fallback. This keeps the helpers independent
// of real network state while still travelling through all four SDK layers.
//
// The XDR payloads are built here with the real SDK (Node side) so the values
// are always structurally valid base64; no hand-rolled XDR bytes are involved.

import { Keypair, StrKey, xdr } from "@stellar/stellar-sdk";
import type { Page, Route } from "@playwright/test";

// ── Fixed (known-valid) addresses ──────────────────────────────
// SIGNER_B is the repo's CHAIN_READ_SOURCE; SIGNER_A is the repo's DEMO_WALLET.
export const SIGNER_A =
  "GBH3O5IHGJ6GUKZCINS3UZGHVKDKYDLVIRKZY7GYA27B54WT3Q7H4KXO";
export const SIGNER_B =
  "GACNKEDGJYLLVQDXWYEEPB47Y3JEV5JNZ3RQANTJIVKKEOXX4NC4YWHU";

/** State shared between the Node-side route handlers and the test steps. */
export interface MultisigState {
  threshold: number;
  signers: string[];
  enabled: boolean;
  /** Currently "connected" wallet address (matches the fake Freighter). */
  activeSigner: string;
  /** When true, simulateTransaction reports a revert (used for non-signer). */
  failSimulate: boolean;
  /** Message returned when failSimulate is active. */
  nonSignerError: string;
  latestLedger: number;
}

export function createState(overrides: Partial<MultisigState> = {}): MultisigState {
  return {
    threshold: 2,
    signers: [SIGNER_A, SIGNER_B],
    enabled: true,
    activeSigner: SIGNER_A,
    failSimulate: false,
    nonSignerError:
      "Not a signer: account is not in the multisig signer list",
    latestLedger: 42_000,
    ...overrides,
  };
}

// ── XDR builders ───────────────────────────────────────────────

const ed25519 = (publicKey: string): Buffer =>
  StrKey.decodeEd25519PublicKey(publicKey);

/**
 * base64 of the LedgerEntryData (account arm) that backs the given signer's
 * getAccount(). The RPC parser wraps each entry's `xdr` as LedgerEntryData,
 * so the payload must be the union (account arm), not a bare AccountEntry.
 */
export function accountLedgerEntryData(publicKey: string): string {
  const entry = new xdr.AccountEntry({
    accountId: xdr.PublicKey.publicKeyTypeEd25519(ed25519(publicKey)),
    balance: new xdr.Int64("100000000000"), // in stroops (e.g. 10,000 XLM)
    seqNum: new xdr.Int64("1234567"),
    numSubEntries: 0,
    inflationDest: null,
    flags: 0,
    homeDomain: "",
    thresholds: Buffer.from([0, 0, 0, 0]),
    signers: [],
    // switch 0 = void ext (the union's runtime constructor takes the switch
    // number; the shipped .d.ts only declares the static factories).
    ext: new (xdr.AccountEntryExt as unknown as new (
      switchOn: number
    ) => xdr.AccountEntryExt)(0),
  });
  return xdr.LedgerEntryData.account(entry).toXDR("base64");
}

/** base64 of the matching AccountLedgerKey, keyed to the same signer. */
export function accountLedgerKey(publicKey: string): string {
  const key = xdr.LedgerKey.account(
    new xdr.LedgerKeyAccount({
      accountId: xdr.PublicKey.publicKeyTypeEd25519(ed25519(publicKey)),
    }),
  );
  return key.toXDR("base64");
}

/**
 * A valid (empty) SorobanTransactionData — what simulateTransaction must
 * return so prepareTransaction() / assembleTransaction() can build the tx.
 */
export function emptySorobanTransactionData(): string {
  const data = new xdr.SorobanTransactionData({
    ext: new (xdr.ExtensionPoint as unknown as new (
      switchOn: number
    ) => xdr.ExtensionPoint)(0), // switch 0 = void
    resources: new xdr.SorobanResources({
      footprint: new xdr.LedgerFootprint({ readOnly: [], readWrite: [] }),
      instructions: 0,
      readBytes: 0,
      writeBytes: 0,
    }),
    resourceFee: new xdr.Int64("0"),
  });
  return data.toXDR("base64");
}

/**
 * base64 of raw bytes for a TransactionMeta union with an unknown switch (5).
 * js-xdr has no decoding arm for it, so xdr.TransactionMeta.fromXDR() throws
 * "Bad union switch" — the fallback path submitContractInvocation relies on.
 */
export function badUnionSwitchTransactionMeta(): string {
  // union discriminant is a big-endian int32; 5 selects no known arm
  return Buffer.from([0x00, 0x00, 0x00, 0x05, 0x00, 0x00, 0x00, 0x00]).toString(
    "base64",
  );
}

interface JsonRpcRequest {
  id: number | string | null;
  jsonrpc?: string;
  method: string;
  params?: Record<string, unknown>;
}

function jsonRpc(handler: (req: JsonRpcRequest) => unknown) {
  return async (route: Route) => {
    const post = route.request().postDataJSON() as JsonRpcRequest | null;
    const req = post ?? { id: null, method: "" };
    const result = await handler(req);
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ jsonrpc: "2.0", id: req.id ?? 1, result }),
    });
  };
}

/**
 * Soroban RPC handler. Matches the SDK's JSON-RPC methods used by the
 * multisig contract helpers and simulates a healthy Testnet node.
 */
export const rpcHandler = (state: MultisigState) =>
  jsonRpc((req) => {
    switch (req.method) {
      case "getLedgerEntries": {
        const signer = state.activeSigner;
        return {
          latestLedger: state.latestLedger,
          entries: [
            {
              key: accountLedgerKey(signer),
              xdr: accountLedgerEntryData(signer),
              lastModifiedLedgerSeq: state.latestLedger,
            },
          ],
        };
      }
      case "simulateTransaction": {
        if (state.failSimulate) {
          return {
            latestLedger: state.latestLedger,
            events: [],
            error: state.nonSignerError,
          };
        }
        return {
          latestLedger: state.latestLedger,
          transactionData: emptySorobanTransactionData(),
          minResourceFee: "0",
          events: [],
          // One result per operation. assembleTransaction() reads
          // simulation.result.auth for the operation's authorization entries —
          // an empty array means "no auth required" (the SDK touches
          // result?.auth when present, so the entry must exist).
          results: [{ auth: [] }],
          cost: { cpuInsns: "100", memBytes: "0" },
        };
      }
      case "sendTransaction": {
        return {
          status: "PENDING",
          hash: "0".repeat(64),
          latestLedger: state.latestLedger,
          latestLedgerCloseTime: 1,
        };
      }
      case "getTransaction": {
        // status SUCCESS but with a resultMetaXdr the SDK can't decode
        // (protocol-27 "Bad union switch") → submitContractInvocation falls
        // back to the Horizon confirmation below.
        return {
          status: "SUCCESS",
          hash: "0".repeat(64),
          latestLedger: state.latestLedger,
          latestLedgerCloseTime: 1,
          oldestLedger: 41_000,
          oldestLedgerCloseTime: 1,
          resultMetaXdr: badUnionSwitchTransactionMeta(),
        };
      }
      case "getHealth":
        return { status: "healthy" };
      default:
        return {};
    }
  });

/** Horizon handler — confirms any submitted transaction as successful. */
export const horizonHandler = () =>
  async (route: Route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        successful: true,
        _links: {},
        hash: "0".repeat(64),
      }),
    });
  };

/**
 * Installs all browser-side mocks the multisig page needs:
 * the app's own read API + the Soroban RPC + Horizon.
 *
 * Call once per test, before `page.goto("/multisig")`.
 */
export async function installMultisigMocks(
  page: Page,
  state: MultisigState,
): Promise<void> {
  // Auth session: the fake freighter exposes no signMessage, so the real
  // server-side session proof can never succeed and the wallet hook would
  // roll the connection back. The multisig flow only needs wallet signing,
  // not an API session, so accept the session outright (same as other
  // wallet-only e2e helpers).
  await page.route("**/api/auth/challenge**", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        data: { challenge: "mock-challenge", message: "mock message" },
      }),
    });
  });
  await page.route("**/api/auth/session**", async (route) => {
    const method = route.request().method().toUpperCase();
    await route.fulfill({
      contentType: "application/json",
      status: method === "DELETE" ? 200 : 200,
      body: JSON.stringify({
        success: true,
        data: { authenticated: true },
      }),
    });
  });

  // App read API: multisig config + pending approval requests.
  await page.route("**/api/multisig**", async (route) => {
    const url = route.request().url();
    const path = new URL(url).pathname;
    const method = route.request().method().toUpperCase();
    if (method !== "GET") {
      await route.continue();
      return;
    }
    if (path === "/api/multisig/requests") {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          data: { requests: [], available: false },
        }),
      });
      return;
    }
    // /api/multisig (bare) — the configured N-of-M multisig.
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        data: {
          threshold: state.threshold,
          signers: state.signers,
          enabled: state.enabled,
        },
      }),
    });
  });

  // Soroban RPC (external origin).
  await page.route(
    (url) => url.hostname.includes("soroban"),
    rpcHandler(state),
  );

  // Horizon (external origin) — just the transaction confirmation lookup.
  await page.route(
    (url) => url.hostname.includes("horizon") && /\/transactions\/[0-9a-f]+$/.test(url.pathname),
    horizonHandler(),
  );
}

/** A random valid-format Stellar address (for the non-signer / payee). */
export function randomAddress(): string {
  return Keypair.random().publicKey();
}

/**
 * JavaScript to inject (via addInitScript) a fake `window.freighter` whose
 * address the test can flip with window.__setFreighterAddress(...). The
 * auth endpoints are mocked too (see installMultisigMocks), so a dummy
 * `signMessage` keeps the wallet hook's connect() from rolling back — the
 * wallet stays connected, which is all the multisig page needs.
 */
export function fakeFreighterInitScript(initialAddress: string): string {
  return `
    (() => {
      const state = { address: ${JSON.stringify(initialAddress)} };
      window.__setFreighterAddress = (a) => { state.address = a; };
      window.__getFreighterAddress = () => state.address;
      // window.freighter as consumed by @/lib/wallets/freighter
      window.freighter = {
        isConnected: async () => true,
        requestAccess: async () => state.address,
        getAddress: async () => state.address,
        getNetwork: async () => "TESTNET",
        getNetworkDetails: async () => ({
          network: "TESTNET",
          networkPassphrase: "Test SDF Network ; September 2015",
        }),
        // identity signer: pass the prepared envelope through unchanged; the
        // mocked RPC/Horizon already mark the tx successful.
        signTransaction: async (txXdr) => txXdr,
        // The freighter connector always exposes signMessage, so the wallet
        // hook will call it during connect(). The auth session route is
        // mocked to accept any proof, so a dummy signature is sufficient.
        signMessage: async () => "AAAA",
      };
    })();
  `;
}