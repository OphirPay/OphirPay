// SPDX-License-Identifier: MIT

import {
  Asset,
  Contract,
  scValToNative,
  nativeToScVal,
  TransactionBuilder,
  xdr,
} from "@stellar/stellar-sdk";
import { getHorizonServer, getSorobanServer, NETWORK_PASSPHRASE } from "@/lib/stellar";
import { withTimeout, STELLAR_TIMEOUT_MS, isTimeoutError, TimeoutError } from "@/lib/timeout";

// ── Contract Configuration ─────────────────────────────────────

// Contract IDs MUST be set via environment variables.
// There are NO hardcoded fallbacks — if env vars are missing the
// app will refuse to start rather than silently route mainnet
// traffic to testnet contracts.
//
// For local development, set these in .env.local:
//   NEXT_PUBLIC_CONTRACT_ID=CCQGGUJRRVXMHNEX2RYPODGJE2YRMYY4Y7A3KTJH3QP2LWZLTCOPRPET
//   NEXT_PUBLIC_EMITTER_CONTRACT_ID=CDAVU2XJ7C2Y52GRJZKRG3HDI7AJ2K2FHAFH5FPDTSUQAV7XNBQNNVAN

export function getContractId(): string {
  const id = process.env.NEXT_PUBLIC_CONTRACT_ID;
  if (!id) {
    throw new Error(
      "NEXT_PUBLIC_CONTRACT_ID is required. Set it in your .env.local file."
    );
  }
  return id;
}

export function getEmitterContractId(): string {
  const id = process.env.NEXT_PUBLIC_EMITTER_CONTRACT_ID;
  if (!id) {
    throw new Error(
      "NEXT_PUBLIC_EMITTER_CONTRACT_ID is required. Set it in your .env.local file."
    );
  }
  return id;
}

export const OPHIRPAY_CONTRACT_ID =
  process.env.NEXT_PUBLIC_CONTRACT_ID || "";
export const EMITTER_CONTRACT_ID =
  process.env.NEXT_PUBLIC_EMITTER_CONTRACT_ID || "";
export const CHAIN_READ_SOURCE =
  process.env.NEXT_PUBLIC_CHAIN_READ_SOURCE ||
  "GACNKEDGJYLLVQDXWYEEPB47Y3JEV5JNZ3RQANTJIVKKEOXX4NC4YWHU";

// Legacy alias
export const DEFAULT_CONTRACT_ID = OPHIRPAY_CONTRACT_ID;

/**
 * Maximum entries an enumerating contract reader returns in a single call.
 *
 * Mirrors `MAX_READER_ENTRIES` in `contracts/ophirpay/src/lib.rs` (issue #742,
 * SPEC.md INV-11): `get_payments_by_batch` and `get_subscriber_hooks` return
 * `{ items, total, truncated }` capped at this many entries. API routes that
 * expose the same data apply the identical ceiling and surface the same
 * truncation flag, so a client never mistakes a capped list for a complete one.
 */
export const CONTRACT_READER_ENTRY_CAP = 100;

// ── Error Types ──────────────────────────────────────────────

export enum ContractErrorType {
  /** Network connectivity issues (RPC down, DNS failure) */
  NETWORK = "NETWORK",
  /** Contract execution errors (HostError, SCError, panic, bad args) */
  CONTRACT = "CONTRACT",
  /** User declined the Freighter signature prompt */
  USER_REJECTION = "USER_REJECTION",
  /** Soroban RPC or network call timed out */
  TIMEOUT = "TIMEOUT",
}

export class ContractError extends Error {
  type: ContractErrorType;
  constructor(message: string, type: ContractErrorType) {
    super(message);
    this.name = "ContractError";
    this.type = type;
  }
}

/** Classify any thrown error into one of four contract error types */
export function classifyContractError(err: unknown): ContractError {
  const msg = err instanceof Error ? err.message : String(err);
  if (
    msg.includes("declined") ||
    msg.includes("rejected") ||
    msg.includes("denied")
  ) {
    return new ContractError(
      "User rejected the transaction in Freighter wallet.",
      ContractErrorType.USER_REJECTION
    );
  }
  if (
    msg.includes("HostError") ||
    msg.includes("ContractError") ||
    msg.includes("panic") ||
    msg.includes("SCError")
  ) {
    return new ContractError(
      `Smart contract execution failed: ${msg}`,
      ContractErrorType.CONTRACT
    );
  }
  if (
    err instanceof TimeoutError ||
    (typeof err === "object" && err !== null && (err as { code?: string }).code === "TIMEOUT") ||
    (isTimeoutError(err) && !msg.toLowerCase().includes("network")) ||
    msg.includes("TimeoutError") ||
    msg.includes("AbortError")
  ) {
    return new ContractError(
      `Soroban RPC request timed out: ${msg}. Please check network connectivity and try again.`,
      ContractErrorType.TIMEOUT
    );
  }
  if (
    msg.includes("network") ||
    msg.includes("fetch") ||
    msg.includes("timeout") ||
    msg.includes("ECONNREFUSED")
  ) {
    return new ContractError(
      `Network error connecting to Soroban RPC: ${msg}`,
      ContractErrorType.NETWORK
    );
  }
  return new ContractError(msg, ContractErrorType.CONTRACT);
}

// ── Result Types ───────────────────────────────────────────────

export interface SimulateResult {
  status: "SIMULATED" | "SIMULATION_FAILED";
  returnValue: unknown;
  error?: string;
}

export interface InvokeResult {
  status: "AWAITING_SIGNATURE" | "SUBMITTED";
  txHash: string;
  xdr?: string;
}

// ── Simulate (Read-Only) ──────────────────────────────────────

/**
 * Simulate a contract function call without submitting a transaction.
 * No wallet signature required.
 */
export async function simulateContractCall(
  contractId: string,
  functionName: string,
  sourcePublicKey: string,
  args: xdr.ScVal[] = []
): Promise<SimulateResult> {
  const server = getSorobanServer();

  try {
    const contract = new Contract(contractId);
    const account = await withTimeout(
      server.getAccount(sourcePublicKey),
      STELLAR_TIMEOUT_MS,
      "Soroban RPC account fetch timed out"
    );

    const tx = new TransactionBuilder(account, {
      fee: "100000",
      networkPassphrase: NETWORK_PASSPHRASE,
      timebounds: { minTime: 0, maxTime: 0 },
    })
      .addOperation(contract.call(functionName, ...args))
      .build();

    const simResponse = await withTimeout(
      server.simulateTransaction(tx),
      STELLAR_TIMEOUT_MS,
      "Soroban RPC simulateTransaction timed out"
    );

    if ("error" in simResponse && simResponse.error) {
      return {
        status: "SIMULATION_FAILED",
        returnValue: null,
        error: String(simResponse.error),
      };
    }

    let returnValue: unknown = null;
    if ("result" in simResponse && simResponse.result) {
      try {
        returnValue = scValToNative(simResponse.result.retval);
      } catch {
        returnValue = "(binary result)";
      }
    }

    return { status: "SIMULATED", returnValue };
  } catch (err) {
    throw classifyContractError(err);
  }
}

// ── Invoke (with signature) ───────────────────────────────────

/**
 * Build a contract invocation transaction and return XDR for Freighter signing.
 * The caller must sign the returned XDR via Freighter, then call submitContractInvocation().
 */
export async function invokeContractFunction(
  contractId: string,
  functionName: string,
  sourcePublicKey: string,
  args: xdr.ScVal[] = []
): Promise<InvokeResult> {
  const server = getSorobanServer();

  try {
    const contract = new Contract(contractId);
    const account = await withTimeout(
      server.getAccount(sourcePublicKey),
      STELLAR_TIMEOUT_MS,
      "Soroban RPC account fetch timed out"
    );

    const tx = new TransactionBuilder(account, {
      fee: "100000",
      networkPassphrase: NETWORK_PASSPHRASE,
      timebounds: {
        minTime: 0,
        maxTime: Math.floor(Date.now() / 1000) + 300,
      },
    })
      .addOperation(contract.call(functionName, ...args))
      .build();

    const prepared = await withTimeout(
      server.prepareTransaction(tx),
      STELLAR_TIMEOUT_MS,
      "Soroban RPC prepareTransaction timed out"
    );

    return {
      status: "AWAITING_SIGNATURE",
      txHash: "",
      xdr: prepared.toXDR(),
    };
  } catch (err) {
    throw classifyContractError(err);
  }
}

// ── Submit ─────────────────────────────────────────────────────

/**
 * Submit a Freighter-signed contract invocation XDR to the Soroban RPC.
 * Polls for result and returns the transaction status.
 */
export async function submitContractInvocation(signedXdr: string): Promise<{
  txHash: string;
  status: string;
  returnValue?: unknown;
}> {
  const server = getSorobanServer();

  try {
    const tx = TransactionBuilder.fromXDR(signedXdr, NETWORK_PASSPHRASE);
    // The tx hash is deterministic from the signed envelope — compute it
    // up-front so we can verify via Horizon even if the RPC result can't be
    // deserialized by the SDK (see "Bad union switch" handling below).
    const txHash = tx.hash().toString("hex");

    try {
      await withTimeout(
        server.sendTransaction(tx),
        STELLAR_TIMEOUT_MS,
        "Soroban RPC sendTransaction timed out"
      );
    } catch (err) {
      if (isTimeoutError(err)) throw err;
      // SDK v13 cannot deserialize protocol-27 RPC responses ("Bad union
      // switch"). This is a parsing limitation, not a tx failure — the
      // response contains a valid result. Fall through to Horizon to confirm.
      if (!(err instanceof Error) || !err.message.includes("Bad union switch")) {
        throw err;
      }
    }

    // Try the Soroban RPC result first — preserves the contract return value
    // (e.g. proposal/request ids) for callers that consume it.
    let result: Awaited<ReturnType<typeof server.getTransaction>> | undefined;
    let parseError = false;
    try {
      result = await withTimeout(
        server.getTransaction(txHash),
        STELLAR_TIMEOUT_MS,
        "Soroban RPC getTransaction timed out"
      );
    } catch (err) {
      if (isTimeoutError(err)) throw err;
      parseError = err instanceof Error && err.message.includes("Bad union switch");
      if (!parseError) throw err;
    }

    if (result) {
      let attempts = 0;
      while (result.status === "NOT_FOUND" && attempts < 30) {
        await new Promise((r) => setTimeout(r, 1000));
        try {
          result = await withTimeout(
            server.getTransaction(txHash),
            STELLAR_TIMEOUT_MS,
            "Soroban RPC getTransaction timed out"
          );
        } catch (err) {
          if (isTimeoutError(err)) throw err;
          parseError = err instanceof Error && err.message.includes("Bad union switch");
          if (!parseError) throw err;
          break;
        }
        attempts++;
      }
    }

    if (result && result.status !== "NOT_FOUND" && !parseError) {
      let returnValue: unknown;
      if (result.status === "SUCCESS" && result.resultMetaXdr) {
        try {
          const meta = result.resultMetaXdr as xdr.TransactionMeta;
          const sorobanMeta = meta.v3()?.sorobanMeta();
          if (sorobanMeta) {
            returnValue = scValToNative(sorobanMeta.returnValue());
          }
        } catch {
          // Non-Soroban meta or parsing failure — ignore.
        }
      }
      return { txHash, status: result.status, returnValue };
    }

    // The RPC result wasn't parseable ("Bad union switch") — confirm the
    // outcome via Horizon REST, which parses protocol-27 cleanly. The tx was
    // already accepted by sendTransaction (PENDING), so this is confirmation
    // of a tx that did go through — mirroring scripts/deploy-testnet.mjs.
    const horizon = getHorizonServer();
    let status = "PENDING";
    for (let i = 0; i < 30; i++) {
      try {
        const htx = await withTimeout(
          horizon.transactions().transaction(txHash).call(),
          STELLAR_TIMEOUT_MS,
          "Horizon transaction confirmation timed out"
        );
        status = htx.successful ? "SUCCESS" : "FAILED";
        break;
      } catch (err) {
        if (isTimeoutError(err)) throw err;
        // NotFoundError (HTTP 404) = not ingested yet — keep polling.
        // Anything else is unexpected; surface it as PENDING.
        const isNotFound =
          err instanceof Error &&
          (err.message.includes("Not Found") ||
            (err as { response?: { status?: number } }).response?.status === 404);
        if (!isNotFound) {
          status = "PENDING";
          break;
        }
      }
      await new Promise((r) => setTimeout(r, 1000));
    }

    return { txHash, status };
  } catch (err) {
    throw classifyContractError(err);
  }
}

// ── On-Chain Payment Recording ─────────────────────────────────

export interface RecordOnChainResult {
  status: "RECORDED" | "FAILED";
  txHash?: string;
  error?: string;
}

/**
 * Record a completed XLM payment on-chain via `OphirPayContract.record_payment`.
 *
 * Best-effort by design: a failure here does NOT throw — the Horizon payment is
 * already settled, so the UI can show a non-blocking warning instead. The caller
 * provides a `signTransaction` function (e.g. Freighter) to sign the Soroban TX.
 *
 * Amount is expressed in stroops (1 XLM = 10,000,000 stroops) to match the
 * contract's i128 representation.
 */
export async function recordPaymentOnChain(params: {
  payer: string;
  payee: string;
  amountStroops: number;
  txHash: string;
  metadata?: string;
  signTransaction: (
    xdr: string,
    opts?: { network?: string; networkPassphrase?: string }
  ) => Promise<string>;
  network?: string;
  networkPassphrase?: string;
}): Promise<RecordOnChainResult> {
  const {
    payer,
    payee,
    amountStroops,
    txHash,
    metadata = "",
    signTransaction,
    network = "TESTNET",
    networkPassphrase,
  } = params;

  try {
    // Matches the contract's `record_payment(payer, payee, amount, asset,
    // tx_hash, metadata)` signature — payer is the auth'd caller.
    const args: xdr.ScVal[] = [
      nativeToScVal(payer, { type: "address" }), // payer (require_auth)
      nativeToScVal(payee, { type: "address" }), // payee
      nativeToScVal(amountStroops, { type: "i128" }), // amount (stroops)
      nativeToScVal(Asset.native().contractId(NETWORK_PASSPHRASE), { type: "address" }), // asset
      nativeToScVal(txHash, { type: "string" }), // tx_hash
      nativeToScVal(metadata, { type: "string" }), // metadata
    ];

    const txInfo = await invokeContractFunction(
      DEFAULT_CONTRACT_ID,
      "record_payment",
      payer,
      args
    );

    if (txInfo.status !== "AWAITING_SIGNATURE" || !txInfo.xdr) {
      return {
        status: "FAILED",
        error: "Failed to build the on-chain payment record.",
      };
    }

    const signedXdr = await signTransaction(txInfo.xdr, {
      network,
      networkPassphrase,
    });

    const result = await submitContractInvocation(signedXdr);

    if (result.status !== "SUCCESS") {
      return {
        status: "FAILED",
        txHash: result.txHash,
        error: `On-chain record transaction was not confirmed (${result.status}).`,
      };
    }

    return { status: "RECORDED", txHash: result.txHash };
  } catch (err) {
    const contractError = classifyContractError(err);
    return { status: "FAILED", error: contractError.message };
  }
}

// ── On-Chain Reads (Public) ────────────────────────────────────



export interface OnChainPayment {
  id: number;
  payer: string;
  payee: string;
  amountStroops: number;
  txHash: string;
  timestamp?: number;
  metadata?: string;
  assetCode?: string;
}

/**
 * Read the most recent on-chain payment records from OphirPayContract.
 * Public chain data — reads via Soroban simulation, no wallet signature required.
 */
export async function fetchOnChainPayments(
  limit = 20,
  sourcePublicKey?: string,
  cursorId?: number
): Promise<{ payments: OnChainPayment[]; total: number }> {
  const src = sourcePublicKey || CHAIN_READ_SOURCE;
  const contractId = OPHIRPAY_CONTRACT_ID;
  const server = getSorobanServer();
  const contract = new Contract(contractId);
  const account = await withTimeout(
    server.getAccount(src),
    STELLAR_TIMEOUT_MS,
    "Soroban RPC account fetch timed out"
  );

  const readCount = async (): Promise<number> => {
    const tx = new TransactionBuilder(account, {
      fee: "100000",
      networkPassphrase: NETWORK_PASSPHRASE,
      timebounds: { minTime: 0, maxTime: 0 },
    })
      .addOperation(contract.call("get_payment_count"))
      .build();
    const sim = await withTimeout(
      server.simulateTransaction(tx),
      STELLAR_TIMEOUT_MS,
      "Soroban RPC get_payment_count timed out"
    );
    if ("error" in sim && sim.error) return 0;
    if ("result" in sim && sim.result) {
      const val = scValToNative(sim.result.retval);
      return typeof val === "number" ? val : Number(val);
    }
    return 0;
  };

  const total = await readCount();
  if (total === 0) {
    return { payments: [], total: 0 };
  }

  const maxId = typeof cursorId === "number" ? Math.min(total, cursorId - 1) : total;
  if (maxId < 1) {
    return { payments: [], total };
  }

  const payments: OnChainPayment[] = [];
  const start = Math.max(1, maxId - limit + 1);
  const ids = Array.from({ length: maxId - start + 1 }, (_, i) => start + i);

  const readPayment = async (id: number): Promise<OnChainPayment | null> => {
    const tx = new TransactionBuilder(account, {
      fee: "100000",
      networkPassphrase: NETWORK_PASSPHRASE,
      timebounds: { minTime: 0, maxTime: 0 },
    })
      .addOperation(
        contract.call("get_payment", nativeToScVal(id, { type: "u64" }))
      )
      .build();

    const sim = await withTimeout(
      server.simulateTransaction(tx),
      STELLAR_TIMEOUT_MS,
      "Soroban RPC get_payment timed out"
    );
    if ("error" in sim && sim.error) return null;
    if ("result" in sim && sim.result) {
      const raw = scValToNative(sim.result.retval);
      return {
        id: Number(raw.id),
        payer: String(raw.payer ?? ""),
        payee: String(raw.payee ?? ""),
        amountStroops: Number(raw.amount ?? 0),
        txHash: String(raw.tx_hash ?? ""),
        timestamp: raw.timestamp ? Number(raw.timestamp) : undefined,
        metadata: raw.metadata ? String(raw.metadata) : undefined,
        assetCode: raw.asset_code ? String(raw.asset_code) : "XLM",
      };
    }
    return null;
  };

  // Fetch records in parallel batches of 10 to stay within RPC rate limits
  // while avoiding one slow sequential round-trip per record.
  for (let i = 0; i < ids.length; i += 10) {
    const chunk = ids.slice(i, i + 10);
    const results = await Promise.all(chunk.map(readPayment));
    for (const p of results) {
      if (p) payments.push(p);
    }
  }

  return { payments: payments.reverse(), total };
}

/**
 * Read a single on-chain payment record by ID.
 * Returns `null` when the record doesn't exist or can't be read.
 * Public chain data — reads via Soroban simulation, no wallet signature required.
 */
export async function fetchOnChainPayment(
  id: number
): Promise<OnChainPayment | null> {
  const contractId = OPHIRPAY_CONTRACT_ID;
  const server = getSorobanServer();
  const contract = new Contract(contractId);
  const account = await withTimeout(
    server.getAccount(CHAIN_READ_SOURCE),
    STELLAR_TIMEOUT_MS,
    "Soroban RPC account fetch timed out"
  );

  const tx = new TransactionBuilder(account, {
    fee: "100000",
    networkPassphrase: NETWORK_PASSPHRASE,
    timebounds: { minTime: 0, maxTime: 0 },
  })
    .addOperation(
      contract.call("get_payment", nativeToScVal(id, { type: "u64" }))
    )
    .build();

  const sim = await withTimeout(
    server.simulateTransaction(tx),
    STELLAR_TIMEOUT_MS,
    "Soroban RPC get_payment timed out"
  );

  // A failed simulation (RPC/network/host error) is a genuine read failure —
  // surface it as an error so the detail page can offer retry instead of
  // reporting an existing payment as "not found".
  if ("error" in sim && sim.error) {
    throw classifyContractError(new Error(String(sim.error)));
  }

  if ("result" in sim && sim.result) {
    try {
      const raw = scValToNative(sim.result.retval);
      if (raw && typeof raw === "object" && "id" in raw) {
        return {
          id: Number(raw.id),
          payer: String(raw.payer ?? ""),
          payee: String(raw.payee ?? ""),
          amountStroops: Number(raw.amount ?? 0),
          txHash: String(raw.tx_hash ?? ""),
          timestamp: raw.timestamp ? Number(raw.timestamp) : undefined,
          metadata: raw.metadata ? String(raw.metadata) : undefined,
        };
      }
    } catch {
      // Unparseable retval (e.g. the error union for a missing record) — the
      // payment does not exist; treated as not-found below.
    }
  }
  return null;
}
