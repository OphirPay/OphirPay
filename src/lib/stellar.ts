// SPDX-License-Identifier: MIT

import {
  rpc,
  Networks,
  Horizon,
  TransactionBuilder,
  Operation,
  Asset,
  Memo,
} from "@stellar/stellar-sdk";
import { getStellarErrorMessage } from "./stellar-error";

// ── Batch Recipient ───────────────────────────────────────────

export interface BatchRecipientInput {
  address: string;
  amount: string;
  memo?: string;
}

// ── Units ──────────────────────────────────────────────────────

/** Stroops per XLM — Stellar's smallest unit (1 XLM = 10,000,000 stroops). */
export const XLM_STROOPS = 1e7;

/**
 * Minimum starting balance (in XLM) required to create a new Stellar account.
 * This covers the network base reserve for a brand-new account.
 */
export const SPONSOR_MIN_STARTING_BALANCE = "1";

// ── Stellar Network Configuration ──────────────────────────────

export const STELLAR_NETWORK: "TESTNET" | "PUBLIC" =
  (process.env.NEXT_PUBLIC_STELLAR_NETWORK as "TESTNET" | "PUBLIC") ||
  "TESTNET";

export const SOROBAN_RPC_URL =
  process.env.NEXT_PUBLIC_STELLAR_RPC_URL ||
  "https://soroban-testnet.stellar.org:443";

export const HORIZON_URL =
  process.env.NEXT_PUBLIC_STELLAR_HORIZON_URL ||
  "https://horizon-testnet.stellar.org";

export const NETWORK_PASSPHRASE =
  process.env.STELLAR_NETWORK_PASSPHRASE ||
  (STELLAR_NETWORK === "TESTNET" ? Networks.TESTNET : Networks.PUBLIC);

// ── Horizon Server ─────────────────────────────────────────────

let _horizonServer: Horizon.Server | null = null;

export function getHorizonServer(): Horizon.Server {
  if (!_horizonServer) {
    _horizonServer = new Horizon.Server(HORIZON_URL);
  }
  return _horizonServer;
}

// ── Soroban RPC Server (lazy initialized) ──────────────────────

let _sorobanServer: rpc.Server | null = null;

export function getSorobanServer(): rpc.Server {
  if (!_sorobanServer) {
    _sorobanServer = new rpc.Server(SOROBAN_RPC_URL, {
      allowHttp: false,
    });
  }
  return _sorobanServer;
}

// ── Balance Fetching ───────────────────────────────────────────

export async function fetchXlmBalance(publicKey: string): Promise<string> {
  const server = getHorizonServer();
  const account = await server.loadAccount(publicKey);
  const xlmBalance = account.balances.find(
    (b) => b.asset_type === "native"
  );
  return xlmBalance ? xlmBalance.balance : "0";
}

/**
 * Check whether a Stellar account exists (is funded) on the network.
 * Returns `false` when Horizon responds with a 404 (account not found),
 * and `true` once the account record is retrieved. Any other error is
 * re-thrown so callers can surface unexpected failures.
 */
export async function accountExists(publicKey: string): Promise<boolean> {
  try {
    await getHorizonServer().loadAccount(publicKey);
    return true;
  } catch (err) {
    if (isAccountNotFound(err)) {
      return false;
    }
    throw err;
  }
}

/**
 * Determine whether a thrown error represents a "account not found" (404)
 * response from Horizon.
 */
export function isAccountNotFound(err: unknown): boolean {
  const e = err as {
    response?: { status?: number };
    status?: number;
    name?: string;
    message?: string;
  };
  if (e?.response?.status === 404 || e?.status === 404) return true;
  if (e?.name === "NotFoundError") return true;
  if (typeof e?.message === "string" && /not found|404/i.test(e.message)) {
    return true;
  }
  return false;
}

export interface AssetBalance {
  assetCode: string;
  assetIssuer?: string;
  balance: string;
  type: "native" | "credit_alphanum4" | "credit_alphanum12";
}

/**
 * Fetch all balances for an account (native + issued assets).
 * Returns an array of { assetCode, balance, type } objects.
 */
export async function fetchAllBalances(publicKey: string): Promise<AssetBalance[]> {
  const server = getHorizonServer();
  const account = await server.loadAccount(publicKey);

  return account.balances.map((b) => {
    if (b.asset_type === "native") {
      return { assetCode: "XLM", balance: b.balance, type: "native" as const };
    }
    return {
      assetCode: "asset_code" in b ? (b.asset_code as string) : "UNKNOWN",
      assetIssuer: "asset_issuer" in b ? (b.asset_issuer as string) : undefined,
      balance: b.balance,
      type: (b.asset_type === "credit_alphanum12"
        ? "credit_alphanum12"
        : "credit_alphanum4") as "credit_alphanum4" | "credit_alphanum12",
    };
  });
}

/**
 * Fetch balance for a specific non-native asset.
 */
export async function fetchAssetBalance(
  publicKey: string,
  assetCode: string,
  assetIssuer: string,
): Promise<string> {
  const balances = await fetchAllBalances(publicKey);
  const found = balances.find(
    (b) => b.assetCode === assetCode && b.assetIssuer === assetIssuer,
  );
  return found?.balance ?? "0";
}

// ── Types ─────────────────────────────────────────────────────

export interface SubmitResult {
  hash: string;
  successful: boolean;
}

// ── Asset Utilities ────────────────────────────────────────────

/**
 * Creates an Asset instance from an asset code and optional issuer.
 * Defaults to native XLM if code is "XLM", "native", or issuer is missing.
 */
export function createAsset(code?: string, issuer?: string): Asset {
  if (!code || code === "XLM" || code === "native" || !issuer) {
    return Asset.native();
  }
  return new Asset(code, issuer);
}

// ── Path Payment Calculations & Horizon Path Discovery ─────────

/**
 * Calculate the exchange rate between send amount and destination amount.
 * Rate = destAmount / sendAmount (e.g. 1 Source Asset = X Dest Asset).
 */
export function calculateExchangeRate(
  sendAmount: string | number,
  destAmount: string | number,
): number {
  const send = typeof sendAmount === "string" ? parseFloat(sendAmount) : sendAmount;
  const dest = typeof destAmount === "string" ? parseFloat(destAmount) : destAmount;
  if (!send || isNaN(send) || isNaN(dest) || send <= 0) return 0;
  return dest / send;
}

/**
 * Calculate the minimum destination amount with slippage tolerance.
 * Default slippage is 1% (0.01).
 */
export function calculateDestMin(
  destAmount: string | number,
  slippageTolerance = 0.01,
): string {
  const dest = typeof destAmount === "string" ? parseFloat(destAmount) : destAmount;
  if (!dest || isNaN(dest) || dest <= 0) return "0";
  const min = Math.max(0, dest * (1 - slippageTolerance));
  return min.toFixed(7);
}

export interface PathPaymentEstimate {
  sourceAsset: { code: string; issuer?: string; type: string };
  destAsset: { code: string; issuer?: string; type: string };
  sourceAmount: string;
  destinationAmount: string;
  destMin: string;
  exchangeRate: number;
  path: Asset[];
  pathAssets: Array<{ code: string; issuer?: string; type: string }>;
}

/**
 * Discover strict-send payment paths via Horizon and return rate estimate.
 * Finds paths from sourceAsset -> destAsset and returns the best rate.
 */
export async function findStrictSendPath(params: {
  sourceAssetCode: string;
  sourceAssetIssuer?: string;
  sendAmount: string;
  destAssetCode: string;
  destAssetIssuer?: string;
  destinationAddress?: string;
  slippageTolerance?: number;
}): Promise<PathPaymentEstimate | null> {
  const {
    sourceAssetCode,
    sourceAssetIssuer,
    sendAmount,
    destAssetCode,
    destAssetIssuer,
    destinationAddress,
    slippageTolerance = 0.01,
  } = params;

  if (!sendAmount || parseFloat(sendAmount) <= 0) {
    return null;
  }

  const server = getHorizonServer();
  const sourceAsset = createAsset(sourceAssetCode, sourceAssetIssuer);
  const destAsset = createAsset(destAssetCode, destAssetIssuer);

  try {
    const destinationTarget =
      destinationAddress && isValidStellarAddress(destinationAddress)
        ? destinationAddress
        : [destAsset];

    const response = await server
      .strictSendPaths(sourceAsset, sendAmount, destinationTarget)
      .call();

    if (!response || !response.records || response.records.length === 0) {
      return null;
    }

    // Filter matching destination asset if destination was queried by account
    const matchingRecords = response.records.filter((rec) => {
      if (destAsset.isNative()) {
        return rec.destination_asset_type === "native";
      }
      return (
        rec.destination_asset_code === destAsset.getCode() &&
        rec.destination_asset_issuer === destAsset.getIssuer()
      );
    });

    const recordsToUse = matchingRecords.length > 0 ? matchingRecords : response.records;
    if (recordsToUse.length === 0) return null;

    // Pick best path offering the highest destination amount
    const bestRecord = recordsToUse.reduce((best, current) => {
      const bestAmt = parseFloat(best.destination_amount);
      const currAmt = parseFloat(current.destination_amount);
      return currAmt > bestAmt ? current : best;
    }, recordsToUse[0]);

    const destAmount = bestRecord.destination_amount;
    if (!destAmount || parseFloat(destAmount) <= 0) return null;

    const pathAssets: Array<{ code: string; issuer?: string; type: string }> = [];
    const path: Asset[] = [];

    if (bestRecord.path && Array.isArray(bestRecord.path)) {
      for (const p of bestRecord.path) {
        const asset =
          p.asset_type === "native"
            ? Asset.native()
            : new Asset(p.asset_code, p.asset_issuer);
        path.push(asset);
        pathAssets.push({
          code: p.asset_type === "native" ? "XLM" : p.asset_code,
          issuer: p.asset_issuer,
          type: p.asset_type,
        });
      }
    }

    const exchangeRate = calculateExchangeRate(sendAmount, destAmount);
    const destMin = calculateDestMin(destAmount, slippageTolerance);

    return {
      sourceAsset: {
        code: sourceAsset.isNative() ? "XLM" : sourceAsset.getCode(),
        issuer: sourceAsset.isNative() ? undefined : sourceAsset.getIssuer(),
        type: sourceAsset.getAssetType(),
      },
      destAsset: {
        code: destAsset.isNative() ? "XLM" : destAsset.getCode(),
        issuer: destAsset.isNative() ? undefined : destAsset.getIssuer(),
        type: destAsset.getAssetType(),
      },
      sourceAmount: sendAmount,
      destinationAmount: destAmount,
      destMin,
      exchangeRate,
      path,
      pathAssets,
    };
  } catch {
    return null;
  }
}

// ── Transaction Building & Submission ──────────────────────────

export interface BuildTxResult {
  xdr: string;
  sourceAccount: Horizon.AccountResponse;
}

/**
 * Build an unsigned payment transaction (XLM, custom asset, or cross-asset path payment).
 * Returns the XDR string — the caller must sign it (e.g. via Freighter).
 * The transaction expires after 5 minutes.
 */
export async function buildPaymentTx(params: {
  sourcePublicKey: string;
  destination: string;
  amount: string;
  memo?: string;
  assetCode?: string;
  assetIssuer?: string;
  /**
   * When `true`, the recipient is an unfunded account and a `Create Account`
   * operation (with the starting balance below) is prepended to the
   * transaction so the sender sponsors the new reserve in the same signed tx.
   */
  sponsorCreate?: boolean;
  /** Starting balance in XLM for the sponsored account (min 1 XLM). */
  startingBalance?: string;
  destAssetCode?: string;
  destAssetIssuer?: string;
  destMin?: string;
  path?: Asset[];
}): Promise<BuildTxResult> {
  const {
    sourcePublicKey,
    destination,
    amount,
    memo,
    assetCode = "XLM",
    assetIssuer,
    sponsorCreate = false,
    startingBalance = SPONSOR_MIN_STARTING_BALANCE,
    destAssetCode,
    destAssetIssuer,
    destMin,
    path,
  } = params;

  const isCrossAsset =
    Boolean(destAssetCode) &&
    (destAssetCode !== assetCode || destAssetIssuer !== assetIssuer);

  if (isCrossAsset && destAssetCode) {
    return buildPathPaymentStrictSendTx({
      sourcePublicKey,
      destination,
      sendAmount: amount,
      destMin: destMin || calculateDestMin(amount),
      sourceAssetCode: assetCode,
      sourceAssetIssuer: assetIssuer,
      destAssetCode,
      destAssetIssuer,
      path,
      memo,
    });
  }

  const server = getHorizonServer();
  const sourceAccount = await server.loadAccount(sourcePublicKey);
  const now = Math.floor(Date.now() / 1000);

  const paymentAsset = createAsset(assetCode, assetIssuer);

  let builder = new TransactionBuilder(sourceAccount, {
    fee: (await server.fetchBaseFee()).toString(),
    networkPassphrase: NETWORK_PASSPHRASE,
    timebounds: {
      minTime: 0,
      maxTime: now + 300, // 5 minutes from now
    },
  });

  // A sponsored (unfunded) recipient must be created before it can receive a
  // payment. The Create Account operation must come first so the destination
  // exists when the payment operation executes.
  if (sponsorCreate) {
    builder = builder.addOperation(
      Operation.createAccount({
        destination,
        startingBalance,
      })
    );
  }

  builder = builder.addOperation(
    Operation.payment({
      destination,
      asset: paymentAsset,
      amount,
    })
  );

  if (memo) {
    builder = builder.addMemo(Memo.text(memo));
  }

  const tx = builder.build();
  return { xdr: tx.toXDR(), sourceAccount };
}

/**
 * Build an unsigned PathPaymentStrictSend transaction for cross-asset transfers.
 * The sender pays exactly `sendAmount` of sourceAsset, and the destination receives
 * at least `destMin` of destAsset through the specified path.
 */
export async function buildPathPaymentStrictSendTx(params: {
  sourcePublicKey: string;
  destination: string;
  sendAmount: string;
  destMin: string;
  sourceAssetCode?: string;
  sourceAssetIssuer?: string;
  destAssetCode: string;
  destAssetIssuer?: string;
  path?: Asset[];
  memo?: string;
}): Promise<BuildTxResult> {
  const {
    sourcePublicKey,
    destination,
    sendAmount,
    destMin,
    sourceAssetCode = "XLM",
    sourceAssetIssuer,
    destAssetCode,
    destAssetIssuer,
    path = [],
    memo,
  } = params;

  const server = getHorizonServer();
  const sourceAccount = await server.loadAccount(sourcePublicKey);
  const now = Math.floor(Date.now() / 1000);

  const sendAsset = createAsset(sourceAssetCode, sourceAssetIssuer);
  const destAsset = createAsset(destAssetCode, destAssetIssuer);

  let builder = new TransactionBuilder(sourceAccount, {
    fee: (await server.fetchBaseFee()).toString(),
    networkPassphrase: NETWORK_PASSPHRASE,
    timebounds: {
      minTime: 0,
      maxTime: now + 300, // 5 minutes from now
    },
  }).addOperation(
    Operation.pathPaymentStrictSend({
      sendAsset,
      sendAmount,
      destination,
      destAsset,
      destMin,
      path,
    })
  );

  if (memo) {
    builder = builder.addMemo(Memo.text(memo));
  }

  const tx = builder.build();
  return { xdr: tx.toXDR(), sourceAccount };
}

/**
 * Build a batch payment transaction with multiple operations.
 * All payments go into a single Stellar transaction (up to 100 ops).
 */
export async function buildBatchPaymentTx(params: {
  sourcePublicKey: string;
  recipients: BatchRecipientInput[];
}): Promise<BuildTxResult> {
  const { sourcePublicKey, recipients } = params;
  const server = getHorizonServer();

  const sourceAccount = await server.loadAccount(sourcePublicKey);

  const now = Math.floor(Date.now() / 1000);
  const baseFee = (await server.fetchBaseFee()).toString();

  let builder = new TransactionBuilder(sourceAccount, {
    fee: baseFee,
    networkPassphrase: NETWORK_PASSPHRASE,
    timebounds: {
      minTime: 0,
      maxTime: now + 300, // 5 minutes
    },
  });

  for (const recipient of recipients) {
    builder = builder.addOperation(
      Operation.payment({
        destination: recipient.address,
        asset: Asset.native(),
        amount: recipient.amount,
      })
    );
  }

  const tx = builder.build();
  return { xdr: tx.toXDR(), sourceAccount };
}

/**
 * Submit a signed XDR transaction to Horizon.
 */
export async function submitSignedTx(
  signedXdr: string
): Promise<SubmitResult> {
  const server = getHorizonServer();
  const transaction = TransactionBuilder.fromXDR(
    signedXdr,
    NETWORK_PASSPHRASE
  );
  return server.submitTransaction(transaction);
}

/**
 * Extract a clear, user-facing message from a Horizon submission failure.
 * Inspects the structured `result_codes` extras when present (covering
 * insufficient balance / partial funding and other operation failures) and
 * falls back to scanning the raw error message.
 */
export function parseSubmissionError(err: unknown): string {
  interface HorizonResultCodes {
    transaction?: string;
    operations?: string[];
  }
  interface HorizonErrorData {
    extras?: { result_codes?: HorizonResultCodes };
  }
  const e = err as {
    response?: { data?: HorizonErrorData };
    data?: HorizonErrorData;
    message?: string;
  };

  const data = e?.response?.data ?? e?.data;
  const resultCodes = data?.extras?.result_codes;

  if (resultCodes) {
    const codes: string[] = [];
    if (resultCodes.transaction) codes.push(resultCodes.transaction);
    if (Array.isArray(resultCodes.operations)) {
      codes.push(...resultCodes.operations);
    }
    for (const code of codes) {
      const message = getStellarErrorMessage(code);
      // getStellarErrorMessage returns a generic fallback for unknown codes;
      // prefer a specific (non-generic) mapping when available.
      if (message && !message.startsWith("Transaction failed")) {
        return message;
      }
    }
  }

  // Fallback: scan the raw message for a known result code fragment.
  const raw = e?.message ?? String(err);
  const known = [
    "op_underfunded",
    "op_low_reserve",
    "op_no_trust",
    "op_no_issuer",
    "tx_insufficient_balance",
    "tx_bad_seq",
    "tx_too_late",
  ];
  for (const code of known) {
    if (raw.includes(code)) {
      return getStellarErrorMessage(code);
    }
  }

  return raw || "Transaction failed. Please try again.";
}

// ── Helpers ────────────────────────────────────────────────────

export function getStellarExplorerUrl(txHash: string): string {
  const base =
    STELLAR_NETWORK === "TESTNET"
      ? "https://stellar.expert/explorer/testnet"
      : "https://stellar.expert/explorer/public";
  return `${base}/tx/${txHash}`;
}

export function getAccountExplorerUrl(publicKey: string): string {
  const base =
    STELLAR_NETWORK === "TESTNET"
      ? "https://stellar.expert/explorer/testnet"
      : "https://stellar.expert/explorer/public";
  return `${base}/account/${publicKey}`;
}

export function isValidStellarAddress(address: string): boolean {
  return /^G[A-Z0-9]{55}$/.test(address);
}

// ── Memo Validation ─────────────────────────────────────────

/** Maximum memo size in bytes (Stellar protocol limit). */
export const MEMO_MAX_BYTES = 28;

/** Allowed Stellar memo types. */
export type StellarMemoType = "text" | "id" | "hash" | "return";

export interface MemoValidationResult {
  valid: boolean;
  error?: string;
}

/**
 * Validate a Stellar memo before building a transaction.
 *
 * Stellar memos are limited to 28 bytes. The current implementation
 * only supports text memos (Memo.text()). Multi-byte UTF-8 characters
 * (e.g. é, ñ, emojis) consume more than 1 byte each, so we must check
 * the actual byte length rather than the string character count.
 *
 * @param memo - The memo string to validate (optional)
 * @returns MemoValidationResult with valid flag and optional error message
 */
export function validateMemo(memo?: string): MemoValidationResult {
  if (!memo || memo.trim() === "") {
    return { valid: true };
  }

  const trimmed = memo.trim();
  const byteLength = new TextEncoder().encode(trimmed).byteLength;

  if (byteLength > MEMO_MAX_BYTES) {
    return {
      valid: false,
      error: `Memo exceeds the ${MEMO_MAX_BYTES}-byte limit (${byteLength} bytes). ` +
        "Use shorter text or remove multi-byte characters (emojis, accented letters).",
    };
  }

  return { valid: true };
}

/**
 * Map a Horizon or contract error message to a user-friendly memo error.
 * Returns null if the error is not memo-related.
 */
export function getMemoErrorMessage(error: string): string | null {
  const lower = error.toLowerCase();

  // Most specific: the Horizon tx_memo_required result code
  if (lower.includes("tx_memo_required")) {
    return "This account requires a memo to receive payments. Please add a memo.";
  }
  if (lower.includes("memo") && (lower.includes("too long") || lower.includes("exceeds"))) {
    return "Memo is too long. Stellar memos are limited to 28 bytes.";
  }
  if (lower.includes("memo") && lower.includes("invalid")) {
    return "Invalid memo format. Use plain text, numbers, or hex.";
  }
  if (lower.includes("tx_bad") && lower.includes("memo")) {
    return "Transaction rejected due to an invalid memo. Check the memo format and try again.";
  }
  if (lower.includes("op_bad") && lower.includes("memo")) {
    return "Operation failed: memo format is invalid for this transaction type.";
  }

  return null;
}
