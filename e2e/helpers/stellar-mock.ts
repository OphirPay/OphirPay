// SPDX-License-Identifier: MIT
//
// Deterministic Soroban RPC + Horizon mocks and fixtures for offline E2E tests — Issue #1298.
//
// WHY THIS EXISTS
// --------------
// E2E tests depend on Soroban smart contract interactions and Stellar network reachability.
// Relying on public testnet RPC causes flaky tests due to rate limits, network resets,
// and node lag. This helper provides:
//
//   1. Full Soroban transaction lifecycle simulation (simulateTransaction, sendTransaction, getTransaction)
//   2. Realistic XDR responses for core operations: single payments, batch payments, escrows, and streams
//   3. Deterministic wallet simulation via window.freighter with support for rejection and auth signing
//   4. Universal offline test setup with no external network dependency

import { Keypair, StrKey, xdr } from "@stellar/stellar-sdk";
import type { Page, Route } from "@playwright/test";

// ── Fixed (known-valid) addresses ──────────────────────────────
export const SIGNER_A =
  "GBH3O5IHGJ6GUKZCINS3UZGHVKDKYDLVIRKZY7GYA27B54WT3Q7H4KXO";
export const SIGNER_B =
  "GACNKEDGJYLLVQDXWYEEPB47Y3JEV5JNZ3RQANTJIVKKEOXX4NC4YWHU";

/** Supported transaction types for realistic Soroban simulation and fixtures. */
export type SorobanTxType =
  | "payment"
  | "batch_payment"
  | "escrow"
  | "stream"
  | "multisig"
  | "custom";

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

// ── XDR Builders & Realistic Fixtures ─────────────────────────

const ed25519 = (publicKey: string): Buffer =>
  StrKey.decodeEd25519PublicKey(publicKey);

/**
 * base64 of the LedgerEntryData (account arm) that backs the given signer's
 * getAccount(). The RPC parser wraps each entry's `xdr` as LedgerEntryData.
 */
export function accountLedgerEntryData(publicKey: string): string {
  const entry = new xdr.AccountEntry({
    accountId: xdr.PublicKey.publicKeyTypeEd25519(ed25519(publicKey)),
    balance: new xdr.Int64("100000000000"), // 10,000 XLM in stroops
    seqNum: new xdr.Int64("1234567"),
    numSubEntries: 0,
    inflationDest: null,
    flags: 0,
    homeDomain: "",
    thresholds: Buffer.from([0, 0, 0, 0]),
    signers: [],
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
      instructions: 50_000,
      readBytes: 1024,
      writeBytes: 1024,
    }),
    resourceFee: new xdr.Int64("100"),
  });
  return data.toXDR("base64");
}

/**
 * base64 of raw bytes for a TransactionMeta union with an unknown switch (5).
 * js-xdr has no decoding arm for it, routing the SDK to the Horizon confirmation fallback.
 */
export function badUnionSwitchTransactionMeta(): string {
  return Buffer.from([0x00, 0x00, 0x00, 0x05, 0x00, 0x00, 0x00, 0x00]).toString(
    "base64",
  );
}

/** Returns base64 representation of a void ScVal. */
export function scValVoid(): string {
  return xdr.ScVal.scvVoid().toXDR("base64");
}

/** Returns base64 representation of a u32 ScVal (e.g. batch count). */
export function scValU32(val: number): string {
  return xdr.ScVal.scvU32(val).toXDR("base64");
}

/** Returns base64 representation of a u64 ScVal (e.g. escrow or stream ID). */
export function scValU64(val: string | number): string {
  return xdr.ScVal.scvU64(new xdr.Uint64(String(val))).toXDR("base64");
}

/** Returns base64 representation of a successful TransactionResult. */
export function mockTransactionResult(): string {
  const result = new xdr.TransactionResult({
    feeCharged: new xdr.Int64("100"),
    result: xdr.TransactionResultResult.txSuccess([]),
    ext: new (xdr.TransactionResultExt as unknown as new (
      switchOn: number
    ) => xdr.TransactionResultExt)(0),
  });
  return result.toXDR("base64");
}

/** Map transaction type to appropriate Soroban contract return value fixture. */
export function getReturnValueForTxType(txType: SorobanTxType): string {
  switch (txType) {
    case "payment":
      return scValVoid();
    case "batch_payment":
      return scValU32(10); // Simulated batch of 10 items
    case "escrow":
      return scValU64("1001"); // Simulated on-chain escrow ID
    case "stream":
      return scValU64("2001"); // Simulated on-chain stream ID
    case "multisig":
    case "custom":
    default:
      return scValVoid();
  }
}

// ── Deterministic JSON-RPC Fixtures ───────────────────────────

export interface MockRpcOptions {
  txType?: SorobanTxType;
  shouldFail?: boolean;
  failureError?: string;
  txHash?: string;
  latestLedger?: number;
  walletAddress?: string;
  walletRejectSigning?: boolean;
  returnValue?: string;
  events?: string[];
  customSimulateResult?: Record<string, unknown>;
  customGetTxResult?: Record<string, unknown>;
}

export function deterministicSimulateResponse(
  options: MockRpcOptions = {}
): Record<string, unknown> {
  const latestLedger = options.latestLedger ?? 42_000;
  if (options.shouldFail) {
    return {
      latestLedger,
      events: [],
      error: options.failureError ?? "Transaction simulation failed",
    };
  }
  const retval =
    options.returnValue ?? getReturnValueForTxType(options.txType ?? "payment");

  return {
    latestLedger,
    transactionData: emptySorobanTransactionData(),
    minResourceFee: "100",
    events: options.events ?? [],
    results: [
      {
        auth: [],
        xdr: retval,
      },
    ],
    cost: { cpuInsns: "50000", memBytes: "1024" },
    ...(options.customSimulateResult ?? {}),
  };
}

export function deterministicSendResponse(
  options: MockRpcOptions = {}
): Record<string, unknown> {
  const latestLedger = options.latestLedger ?? 42_000;
  const hash = options.txHash ?? "0".repeat(64);

  if (options.shouldFail) {
    return {
      status: "ERROR",
      hash,
      latestLedger,
      latestLedgerCloseTime: 1,
      errorResult: options.failureError ?? "Transaction submission rejected",
    };
  }

  return {
    status: "PENDING",
    hash,
    latestLedger,
    latestLedgerCloseTime: Math.floor(Date.now() / 1000),
  };
}

export function deterministicGetTransactionResponse(
  options: MockRpcOptions = {}
): Record<string, unknown> {
  const latestLedger = options.latestLedger ?? 42_000;
  const hash = options.txHash ?? "0".repeat(64);
  const now = Math.floor(Date.now() / 1000);

  if (options.shouldFail) {
    return {
      status: "FAILED",
      hash,
      latestLedger,
      latestLedgerCloseTime: now,
      oldestLedger: latestLedger - 1000,
      oldestLedgerCloseTime: now - 300,
      resultXdr: mockTransactionResult(),
      resultMetaXdr: badUnionSwitchTransactionMeta(),
    };
  }

  return {
    status: "SUCCESS",
    hash,
    latestLedger,
    latestLedgerCloseTime: now,
    oldestLedger: latestLedger - 1000,
    oldestLedgerCloseTime: now - 300,
    resultXdr: mockTransactionResult(),
    resultMetaXdr: badUnionSwitchTransactionMeta(),
    returnValue:
      options.returnValue ?? getReturnValueForTxType(options.txType ?? "payment"),
    ...(options.customGetTxResult ?? {}),
  };
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
 * Creates a deterministic Soroban RPC handler with configurable behavior.
 */
export function createDeterministicRpcHandler(options: MockRpcOptions = {}) {
  const activeAddress = options.walletAddress ?? SIGNER_A;
  const latestLedger = options.latestLedger ?? 42_000;

  return jsonRpc((req) => {
    switch (req.method) {
      case "getHealth":
        return { status: "healthy" };
      case "getLatestLedger":
        return {
          id: hashFromSeq(latestLedger),
          protocolVersion: 22,
          sequence: latestLedger,
        };
      case "getLedgerEntries":
        return {
          latestLedger,
          entries: [
            {
              key: accountLedgerKey(activeAddress),
              xdr: accountLedgerEntryData(activeAddress),
              lastModifiedLedgerSeq: latestLedger,
            },
          ],
        };
      case "simulateTransaction":
        return deterministicSimulateResponse(options);
      case "sendTransaction":
        return deterministicSendResponse(options);
      case "getTransaction":
        return deterministicGetTransactionResponse(options);
      case "getEvents":
        return {
          latestLedger,
          events: options.events ?? [],
        };
      default:
        return {};
    }
  });
}

function hashFromSeq(seq: number): string {
  return seq.toString(16).padStart(64, "0");
}

/**
 * Soroban RPC handler. Matches the SDK's JSON-RPC methods used by the
 * multisig contract helpers and simulates a healthy Testnet node.
 * Maintained for full backward compatibility with existing tests.
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
 * Installs all browser-side mocks the multisig page needs.
 * Maintained for backward compatibility.
 */
export async function installMultisigMocks(
  page: Page,
  state: MultisigState,
): Promise<void> {
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

  await page.route(
    (url) => url.hostname.includes("soroban"),
    rpcHandler(state),
  );

  await page.route(
    (url) => url.hostname.includes("horizon") && /\/transactions\/[0-9a-f]+$/.test(url.pathname),
    horizonHandler(),
  );
}

/**
 * Universal installer for deterministic offline RPC mocks.
 * Simulates wallet auth, Soroban RPC, and Horizon boundaries.
 */
export async function installDeterministicRpcMocks(
  page: Page,
  options: MockRpcOptions = {}
): Promise<void> {
  const walletAddress = options.walletAddress ?? SIGNER_A;

  // 1. Inject deterministic fake Freighter
  await page.addInitScript(
    fakeFreighterInitScript({
      address: walletAddress,
      rejectSigning: options.walletRejectSigning ?? false,
    })
  );

  // 2. Intercept wallet-auth API session
  await page.route("**/api/auth/challenge**", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        data: { challenge: "mock-offline-challenge", message: "offline login message" },
      }),
    });
  });
  await page.route("**/api/auth/session**", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        data: { authenticated: true, user: { address: walletAddress } },
      }),
    });
  });

  // 3. Intercept Soroban RPC JSON-RPC calls
  await page.route(
    (url) => url.hostname.includes("soroban") || url.pathname.includes("/soroban/rpc"),
    createDeterministicRpcHandler(options)
  );

  // 4. Intercept Horizon transaction queries
  await page.route(
    (url) => url.hostname.includes("horizon") && /\/transactions(\/|$)/.test(url.pathname),
    horizonHandler()
  );
}

/** A random valid-format Stellar address. */
export function randomAddress(): string {
  return Keypair.random().publicKey();
}

export interface FakeFreighterConfig {
  address?: string;
  rejectSigning?: boolean;
}

/**
 * Injects a deterministic `window.freighter` mock supporting:
 * - Address flipping via window.__setFreighterAddress(addr)
 * - Signing rejection simulation via window.__setFreighterRejectSigning(bool)
 * - Full support for signTransaction, signAuthEntry, and signMessage
 */
export function fakeFreighterInitScript(
  configOrAddress: string | FakeFreighterConfig = SIGNER_A
): string {
  const config =
    typeof configOrAddress === "string"
      ? { address: configOrAddress, rejectSigning: false }
      : { address: configOrAddress.address ?? SIGNER_A, rejectSigning: !!configOrAddress.rejectSigning };

  return `
    (() => {
      const state = {
        address: ${JSON.stringify(config.address)},
        rejectSigning: ${JSON.stringify(config.rejectSigning)},
      };
      window.__setFreighterAddress = (a) => { state.address = a; };
      window.__getFreighterAddress = () => state.address;
      window.__setFreighterRejectSigning = (r) => { state.rejectSigning = !!r; };

      window.freighter = {
        isConnected: async () => true,
        requestAccess: async () => {
          if (state.rejectSigning) throw new Error("User declined access / connection");
          return state.address;
        },
        getAddress: async () => state.address,
        getNetwork: async () => "TESTNET",
        getNetworkDetails: async () => ({
          network: "TESTNET",
          networkPassphrase: "Test SDF Network ; September 2015",
        }),
        signTransaction: async (txXdr) => {
          if (state.rejectSigning) throw new Error("User declined transaction signing");
          return txXdr;
        },
        signAuthEntry: async (entryXdr) => {
          if (state.rejectSigning) throw new Error("User declined auth entry signing");
          return entryXdr;
        },
        signMessage: async () => {
          if (state.rejectSigning) throw new Error("User declined message signing");
          return "AAAA";
        },
      };
    })();
  `;
}