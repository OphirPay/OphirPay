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

import {
  Account,
  Asset,
  Contract,
  Keypair,
  Networks,
  Operation,
  StrKey,
  TransactionBuilder,
  nativeToScVal,
  xdr,
} from "@stellar/stellar-sdk";
import type { Page, Route } from "@playwright/test";

// ── Fixed (known-valid) addresses ──────────────────────────────
// SIGNER_B is the repo's CHAIN_READ_SOURCE; SIGNER_A is the repo's DEMO_WALLET.
export const SIGNER_A =
  "GBH3O5IHGJ6GUKZCINS3UZGHVKDKYDLVIRKZY7GYA27B54WT3Q7H4KXO";
export const SIGNER_B =
  "GACNKEDGJYLLVQDXWYEEPB47Y3JEV5JNZ3RQANTJIVKKEOXX4NC4YWHU";

/**
 * Deterministic signer used by the transaction fixtures. Derived from a fixed
 * 32-byte seed, so every run (and every CI shard) produces the same address,
 * signature and transaction hash.
 */
export const FIXTURE_SIGNER = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 7));
export const FIXTURE_SIGNER_ADDRESS = FIXTURE_SIGNER.publicKey();

/** A valid, fixed Soroban contract id used by the invoke fixtures. */
export const FIXTURE_CONTRACT_ID = StrKey.encodeContract(Buffer.alloc(32, 0x11));

/** The common transaction shapes the E2E suite sends. */
export const TRANSACTION_FIXTURE_KINDS = [
  "single-payment",
  "batch-payment",
  "escrow-creation",
  "stream-creation",
] as const;
export type TransactionFixtureKind =
  (typeof TRANSACTION_FIXTURE_KINDS)[number];

export interface TransactionFixture {
  kind: TransactionFixtureKind;
  /** Hex transaction hash — deterministic for the fixture. */
  hash: string;
  /** Signed transaction envelope, base64 XDR. */
  envelopeXdr: string;
  /** Fee in stroops. */
  fee: string;
  /** Number of operations in the envelope. */
  operationCount: number;
  /** base64 ScVal returned by simulateTransaction for this fixture. */
  resultXdr: string;
}

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
  /** Fixture the RPC should report hashes/retvals for (null = legacy flow). */
  fixture: TransactionFixtureKind | null;
  /**
   * `getTransaction` returns NOT_FOUND this many times before SUCCESS. This
   * models a real submission's ingestion delay without any wall-clock wait.
   */
  getTransactionPollsRemaining: number;
  /**
   * `unsupported` keeps the multisig "Bad union switch" fallback path;
   * `success` returns a protocol-valid TransactionMeta v3. New offline tests
   * should use `success`.
   */
  transactionMeta: "unsupported" | "success";
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
    fixture: null,
    getTransactionPollsRemaining: 0,
    transactionMeta: "unsupported",
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

/**
 * A protocol-valid TransactionMeta v3 with no events, changes or Soroban
 * diagnostics. Real Soroban RPCs return this shape for a successful call, and
 * unlike `badUnionSwitchTransactionMeta` the SDK can decode it.
 */
export function successfulTransactionMeta(): string {
  const sorobanMeta = new xdr.SorobanTransactionMeta({
    // switch 0 = void ext (same union-constructor workaround as AccountEntry).
    ext: new (xdr.SorobanTransactionMetaExt as unknown as new (
      switchOn: number,
    ) => xdr.SorobanTransactionMetaExt)(0),
    events: [],
    returnValue: xdr.ScVal.scvVoid(),
    diagnosticEvents: [],
  });

  const meta = new (xdr.TransactionMeta as unknown as new (
    switchOn: number,
    value: xdr.TransactionMetaV3,
  ) => xdr.TransactionMeta)(
    3,
    new xdr.TransactionMetaV3({
      ext: new (xdr.ExtensionPoint as unknown as new (
        switchOn: number,
      ) => xdr.ExtensionPoint)(0),
      txChangesBefore: [],
      operations: [],
      txChangesAfter: [],
      sorobanMeta,
    }),
  );

  return meta.toXDR("base64");
}

// ── Deterministic transaction fixtures ─────────────────────────

/**
 * Build one of the common transaction envelopes the app sends. The envelope
 * is a real `Transaction` built and signed with {@link FIXTURE_SIGNER}, so
 * consumers (and tests) can parse it with `xdr.TransactionEnvelope` instead of
 * asserting on a hand-written blob.
 */
export function buildTransactionFixture(
  kind: TransactionFixtureKind,
): TransactionFixture {
  const account = new Account(FIXTURE_SIGNER.publicKey(), "1234567");
  const builder = new TransactionBuilder(account, {
    fee: "100000",
    networkPassphrase: Networks.TESTNET,
    timebounds: { minTime: 0, maxTime: 0 },
  });

  const contract = new Contract(FIXTURE_CONTRACT_ID);

  switch (kind) {
    case "single-payment":
      builder.addOperation(
        Operation.payment({
          destination: SIGNER_B,
          asset: Asset.native(),
          amount: "12.5",
        }),
      );
      break;
    case "batch-payment":
      for (const [index, amount] of ["1.25", "2.5", "3.75"].entries()) {
        builder.addOperation(
          Operation.payment({
            destination: index === 1 ? SIGNER_B : FIXTURE_SIGNER_ADDRESS,
            asset: Asset.native(),
            amount,
          }),
        );
      }
      break;
    case "escrow-creation":
      builder.addOperation(
        contract.call(
          "create_escrow",
          nativeToScVal(FIXTURE_SIGNER_ADDRESS, { type: "address" }),
          nativeToScVal(SIGNER_B, { type: "address" }),
          nativeToScVal(500_000_000, { type: "i128" }),
          nativeToScVal(1_800_000_000, { type: "u64" }),
        ),
      );
      break;
    case "stream-creation":
      builder.addOperation(
        contract.call(
          "create_stream",
          nativeToScVal(FIXTURE_SIGNER_ADDRESS, { type: "address" }),
          nativeToScVal(SIGNER_B, { type: "address" }),
          nativeToScVal(1_000_000_000, { type: "i128" }),
          nativeToScVal(1_700_000_000, { type: "u64" }),
          nativeToScVal(1_800_000_000, { type: "u64" }),
        ),
      );
      break;
  }

  const transaction = builder.build();
  transaction.sign(FIXTURE_SIGNER);

  return {
    kind,
    hash: transaction.hash().toString("hex"),
    envelopeXdr: transaction.toEnvelope().toXDR("base64"),
    fee: transaction.fee,
    operationCount: transaction.operations.length,
    // Escrow/stream creation return the new id; payments return void.
    resultXdr:
      kind === "escrow-creation" || kind === "stream-creation"
        ? nativeToScVal(1, { type: "u64" }).toXDR("base64")
        : xdr.ScVal.scvVoid().toXDR("base64"),
  };
}

/** Lazily built fixtures, keyed by kind (building XDR is pure but not free). */
const fixtureCache = new Map<TransactionFixtureKind, TransactionFixture>();

/** Deterministic fixture for `kind` (same object on every call). */
export function getTransactionFixture(
  kind: TransactionFixtureKind,
): TransactionFixture {
  const cached = fixtureCache.get(kind);
  if (cached) return cached;
  const fixture = buildTransactionFixture(kind);
  fixtureCache.set(kind, fixture);
  return fixture;
}

/** All four fixtures, in declaration order. */
export const TRANSACTION_FIXTURES: Record<
  TransactionFixtureKind,
  TransactionFixture
> = Object.fromEntries(
  TRANSACTION_FIXTURE_KINDS.map((kind) => [kind, getTransactionFixture(kind)]),
) as Record<TransactionFixtureKind, TransactionFixture>;

export interface JsonRpcRequest {
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

/** Deterministic hash the mock reports for the configured fixture. */
function rpcTransactionHash(state: MultisigState): string {
  return state.fixture
    ? getTransactionFixture(state.fixture).hash
    : "0".repeat(64);
}

/**
 * Pure Soroban RPC response builder, shared by the Playwright route handler
 * and the Node-side offline tests. Keeping it pure means the full
 * simulate → send → get lifecycle can be asserted without a browser, a server
 * or a network connection.
 */
export function handleRpcRequest(
  state: MultisigState,
  req: JsonRpcRequest,
): Record<string, unknown> {
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

      // One result per operation. assembleTransaction() reads
      // simulation.result.auth for the operation's authorization entries —
      // an empty array means "no auth required" (the SDK touches
      // result?.auth when present, so the entry must exist). Fixture-backed
      // simulations also carry the ScVal return value a real node sends.
      const result: Record<string, unknown> = { auth: [] };
      if (state.fixture) {
        result.xdr = getTransactionFixture(state.fixture).resultXdr;
      }

      return {
        latestLedger: state.latestLedger,
        transactionData: emptySorobanTransactionData(),
        minResourceFee: "0",
        events: [],
        results: [result],
        cost: { cpuInsns: "100", memBytes: "0" },
      };
    }
    case "sendTransaction": {
      return {
        status: "PENDING",
        hash: rpcTransactionHash(state),
        latestLedger: state.latestLedger,
        latestLedgerCloseTime: 1,
      };
    }
    case "getTransaction": {
      const hash = rpcTransactionHash(state);

      // Model the real ingestion delay deterministically: a configured number
      // of NOT_FOUND polls before the SUCCESS result appears.
      if (state.getTransactionPollsRemaining > 0) {
        state.getTransactionPollsRemaining -= 1;
        return {
          status: "NOT_FOUND",
          hash,
          latestLedger: state.latestLedger,
          latestLedgerCloseTime: 1,
          oldestLedger: 41_000,
          oldestLedgerCloseTime: 1,
        };
      }

      // `unsupported` (the multisig default) keeps the protocol-27 "Bad union
      // switch" path so submitContractInvocation falls back to Horizon;
      // `success` returns a decodable TransactionMeta v3 for offline fixtures.
      return {
        status: "SUCCESS",
        hash,
        latestLedger: state.latestLedger,
        latestLedgerCloseTime: 1,
        oldestLedger: 41_000,
        oldestLedgerCloseTime: 1,
        resultMetaXdr:
          state.transactionMeta === "success"
            ? successfulTransactionMeta()
            : badUnionSwitchTransactionMeta(),
      };
    }
    case "getHealth":
      return { status: "healthy" };
    default:
      return {};
  }
}

/**
 * Soroban RPC handler. Matches the SDK's JSON-RPC methods used by the
 * multisig contract helpers and simulates a healthy Testnet node.
 */
export const rpcHandler = (state: MultisigState) =>
  jsonRpc((req) => handleRpcRequest(state, req));

/** Horizon handler — confirms any submitted transaction as successful. */
export const horizonHandler = (hash = "0".repeat(64)) =>
  async (route: Route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        successful: true,
        _links: {},
        hash,
      }),
    });
  };

/**
 * Install the Soroban RPC + Horizon mocks for a deterministic, offline page.
 *
 * Unlike `installMultisigMocks` this touches only the chain boundary: callers
 * keep their own app-API mocks. Pass `fixture` to have hashes and simulation
 * return values come from one of {@link TRANSACTION_FIXTURES}.
 */
export async function installStellarMocks(
  page: Page,
  options: {
    state?: MultisigState;
    fixture?: TransactionFixtureKind | null;
  } = {},
): Promise<MultisigState> {
  const state =
    options.state ??
    createState({
      fixture: options.fixture ?? null,
      transactionMeta: "success",
    });

  await page.route(
    (url) => url.hostname.includes("soroban"),
    rpcHandler(state),
  );
  await page.route(
    (url) => url.hostname.includes("horizon"),
    horizonHandler(
      state.fixture ? getTransactionFixture(state.fixture).hash : undefined,
    ),
  );

  return state;
}

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
export function fakeFreighterInitScript(
  initialAddress: string,
  persistKey?: string,
): string {
  const initial = persistKey
    ? `localStorage.getItem(${JSON.stringify(persistKey)}) || ${JSON.stringify(initialAddress)}`
    : JSON.stringify(initialAddress);
  const persist = persistKey
    ? `localStorage.setItem(${JSON.stringify(persistKey)}, a);`
    : "";
  return `
    (() => {
      const state = { address: ${initial} };
      // Deterministic call log: tests can assert *that* signing happened and
      // compare the exact envelope, without depending on a real wallet.
      const calls = { signTransaction: [], signMessage: 0 };
      window.__freighterCalls = calls;
      window.__setFreighterAddress = (a) => { state.address = a; ${persist} };
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
        // Identity signer: pass the prepared envelope through unchanged; the
        // mocked RPC/Horizon already mark the tx successful. Every call is
        // recorded so a deterministic assertion is possible.
        signTransaction: async (txXdr) => {
          calls.signTransaction.push(txXdr);
          return txXdr;
        },
        // The freighter connector always exposes signMessage, so the wallet
        // hook will call it during connect(). The auth session route is
        // mocked to accept any proof, so a dummy signature is sufficient.
        signMessage: async () => {
          calls.signMessage += 1;
          return "AAAA";
        },
      };
    })();
  `;
}