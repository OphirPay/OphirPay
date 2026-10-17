// SPDX-License-Identifier: MIT

import { StrKey } from "@stellar/stellar-sdk";

/**
 * SEP-7 (Stellar URI Scheme) payload builders.
 *
 * SEP-7 defines URIs like `web+stellar:pay?destination=G...` that Stellar
 * wallets recognize and act on. The receive page encodes the connected
 * account's address into a `pay` payload so a sender can scan the QR with
 * any SEP-7-compatible wallet and pay instantly.
 *
 * Reference: https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0007.md
 */

export type Sep7MemoType = "MEMO_TEXT" | "MEMO_ID" | "MEMO_HASH" | "MEMO_RETURN";

export interface Sep7PayParams {
  /** Required — the destination Stellar account (G...). */
  destination: string;
  /** Optional — amount in the asset's base units. */
  amount?: string;
  /** Optional — transaction memo. */
  memo?: string;
  /** Optional — memo type; defaults to MEMO_TEXT when a memo is provided. */
  memoType?: Sep7MemoType;
  /** Optional snake_case alias for memoType. */
  memo_type?: Sep7MemoType;
  /** Optional — asset code; omitted (native XLM) when "XLM". */
  assetCode?: string;
  /** Optional snake_case alias for assetCode. */
  asset_code?: string;
  /** Optional — asset issuer for non-native assets. */
  assetIssuer?: string;
  /** Optional snake_case alias for assetIssuer. */
  asset_issuer?: string;
  /** Optional — human-readable message shown to the sender. */
  msg?: string;
}

const ASSET_CODE_PATTERN = /^[A-Za-z0-9]{1,12}$/;
const MEMO_TYPES = new Set<Sep7MemoType>([
  "MEMO_TEXT",
  "MEMO_ID",
  "MEMO_HASH",
  "MEMO_RETURN",
]);

function isValidAmount(amount: string): boolean {
  if (typeof amount !== "string") return false;
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,7})?$/.test(amount)) return false;
  const [wholePart, fractionalPart = ""] = amount.split(".");
  const whole = wholePart.replace(/^0+(?=\d)/, "");
  const maximumWhole = "922337203685";
  if (whole.length > maximumWhole.length) return false;
  if (whole.length === maximumWhole.length && whole > maximumWhole) return false;
  if (whole === maximumWhole && fractionalPart.padEnd(7, "0") > "4775807") {
    return false;
  }
  return whole !== "0" || /[1-9]/.test(fractionalPart);
}

function isValidMemo(memo: string, memoType: Sep7MemoType | undefined): boolean {
  if (typeof memo !== "string" || !memoType || !MEMO_TYPES.has(memoType)) {
    return false;
  }
  if (memoType === "MEMO_TEXT") return new TextEncoder().encode(memo).length <= 28;
  if (memoType === "MEMO_ID") {
    if (!/^\d+$/.test(memo)) return false;
    const normalizedId = memo.replace(/^0+(?=\d)/, "");
    const maximumId = "18446744073709551615";
    return (
      normalizedId.length < maximumId.length ||
      (normalizedId.length === maximumId.length && normalizedId <= maximumId)
    );
  }
  return /^[0-9a-fA-F]{64}$/.test(memo);
}

export function isValidSep7Address(address: string): boolean {
  return typeof address === "string" && StrKey.isValidEd25519PublicKey(address);
}

/**
 * Build a SEP-7 `web+stellar:pay` URI.
 *
 * Only the destination is required. Optional params are omitted when empty
 * or invalid, and the native XLM asset is never encoded as `asset_code`
 * (per SEP-7, native payments omit the asset entirely).
 */
export function buildSep7PayUri(params: Sep7PayParams): string {
  if (!isValidSep7Address(params.destination)) {
    throw new Error("Invalid Stellar destination address");
  }

  const url = new URL("web+stellar:pay");
  url.searchParams.set("destination", params.destination);

  if (params.amount && isValidAmount(params.amount)) {
    url.searchParams.set("amount", params.amount);
  }
  if (params.memo) {
    const memoType = params.memoType ?? params.memo_type ?? "MEMO_TEXT";
    if (isValidMemo(params.memo, memoType)) {
      url.searchParams.set("memo", params.memo);
      url.searchParams.set("memo_type", memoType);
    }
  }

  const resolvedAssetCode = params.assetCode ?? params.asset_code;
  const resolvedAssetIssuer = params.assetIssuer ?? params.asset_issuer;

  if (
    typeof resolvedAssetCode === "string" &&
    resolvedAssetCode &&
    resolvedAssetCode !== "XLM" &&
    ASSET_CODE_PATTERN.test(resolvedAssetCode)
  ) {
    url.searchParams.set("asset_code", resolvedAssetCode);
    if (
      typeof resolvedAssetIssuer === "string" &&
      resolvedAssetIssuer &&
      isValidSep7Address(resolvedAssetIssuer)
    ) {
      url.searchParams.set("asset_issuer", resolvedAssetIssuer);
    }
  }
  if (
    typeof params.msg === "string" &&
    params.msg &&
    new TextEncoder().encode(params.msg).length <= 500
  ) {
    url.searchParams.set("msg", params.msg);
  }

  return url.toString();
}

/**
 * Parse a SEP-7 `web+stellar:pay` URI back into structured parameters.
 */
export function parseSep7PayUri(uri: string): Sep7PayParams {
  const parsed = new URL(uri);
  if (parsed.protocol !== "web+stellar:" || parsed.pathname !== "pay") {
    throw new Error("Invalid SEP-0007 pay URI scheme");
  }
  const destination = parsed.searchParams.get("destination") || "";
  if (!isValidSep7Address(destination)) {
    throw new Error("Invalid Stellar destination address");
  }

  const amount = parsed.searchParams.get("amount") || undefined;
  const assetCode = parsed.searchParams.get("asset_code") || undefined;
  const assetIssuer = parsed.searchParams.get("asset_issuer") || undefined;
  const memo = parsed.searchParams.get("memo") || undefined;
  const memoType = (parsed.searchParams.get("memo_type") as Sep7MemoType | null) || undefined;
  const msg = parsed.searchParams.get("msg") || undefined;

  return {
    destination,
    amount,
    assetCode,
    assetIssuer,
    memo,
    memoType,
    msg,
  };
}

/**
 * Build the receive payload for an account: a SEP-7 `pay` URI with no
 * amount, so the sender picks how much to send.
 */
export function buildReceivePayload(address: string): string {
  return buildSep7PayUri({ destination: address });
}
