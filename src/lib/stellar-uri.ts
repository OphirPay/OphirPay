// SPDX-License-Identifier: MIT

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

export interface Sep7PayParams {
  /** Required — the destination Stellar account (G...). */
  destination: string;
  /** Optional — amount in the asset's base units. */
  amount?: string;
  /** Optional — transaction memo. */
  memo?: string;
  /** Optional — memo type; defaults to MEMO_TEXT when a memo is provided. */
  memoType?: "MEMO_TEXT" | "MEMO_ID" | "MEMO_HASH" | "MEMO_RETURN";
  /** Optional — asset code; omitted (native XLM) when "XLM". */
  assetCode?: string;
  /** Optional — asset issuer for non-native assets. */
  assetIssuer?: string;
  /** Optional — human-readable message shown to the sender. */
  msg?: string;
}

/**
 * Build a SEP-7 `web+stellar:pay` URI.
 *
 * Only the destination is required. Optional params are omitted when empty
 * so the payload stays compact, and the native XLM asset is never encoded
 * as `asset_code` (per SEP-7, native payments omit the asset entirely).
 */
export function buildSep7PayUri(params: Sep7PayParams): string {
  const url = new URL("web+stellar:pay");
  url.searchParams.set("destination", params.destination);

  if (params.amount !== undefined && params.amount !== "") {
    url.searchParams.set("amount", params.amount);
  }
  if (params.memo) {
    url.searchParams.set("memo", params.memo);
    if (params.memoType) {
      url.searchParams.set("memo_type", params.memoType);
    }
  }
  if (params.assetCode && params.assetCode !== "XLM") {
    url.searchParams.set("asset_code", params.assetCode);
    if (params.assetIssuer) {
      url.searchParams.set("asset_issuer", params.assetIssuer);
    }
  }
  if (params.msg) {
    url.searchParams.set("msg", params.msg);
  }

  return url.toString();
}

/**
 * Build the receive payload for an account: a SEP-7 `pay` URI with no
 * amount, so the sender picks how much to send.
 */
export function buildReceivePayload(address: string): string {
  return buildSep7PayUri({ destination: address });
}

const SEP7_SCHEME = "web+stellar:";
const SEP7_PAY_OP = "pay";
const MEMO_TYPES = ["MEMO_TEXT", "MEMO_ID", "MEMO_HASH", "MEMO_RETURN"] as const;

function parseSep7Url(uri: string): URL | null {
  let parsed: URL;
  try {
    parsed = new URL(uri);
  } catch {
    return null;
  }
  if (parsed.protocol !== SEP7_SCHEME) return null;
  if (parsed.pathname !== SEP7_PAY_OP) return null;
  return parsed;
}

/**
 * Parse a SEP-7 `web+stellar:pay` URI back into its fields.
 * Returns null when the URI is not a well-formed pay handoff.
 * Inverse of buildSep7PayUri — every field it emits parses back.
 */
export function parseSep7PayUri(uri: string): Sep7PayParams | null {
  const parsed = parseSep7Url(uri);
  if (!parsed) return null;

  const destination = parsed.searchParams.get("destination") ?? "";
  if (!destination) return null;

  const params: Sep7PayParams = { destination };
  const amount = parsed.searchParams.get("amount");
  if (amount !== null) params.amount = amount;
  const memo = parsed.searchParams.get("memo");
  if (memo !== null) params.memo = memo;
  const memoType = parsed.searchParams.get("memo_type");
  if (memoType !== null) {
    if (!(MEMO_TYPES as readonly string[]).includes(memoType)) return null;
    params.memoType = memoType as Sep7PayParams["memoType"];
  }
  const assetCode = parsed.searchParams.get("asset_code");
  if (assetCode !== null) params.assetCode = assetCode;
  const assetIssuer = parsed.searchParams.get("asset_issuer");
  if (assetIssuer !== null) params.assetIssuer = assetIssuer;
  const msg = parsed.searchParams.get("msg");
  if (msg !== null) params.msg = msg;
  return params;
}

/**
 * Validate a SEP-7 pay handoff against the grammar (issue #812):
 * correct scheme + operation, a present destination, a positive numeric
 * amount when given, memo_type only alongside a memo, and an issuer only
 * for non-native assets.
 */
export function isValidSep7Uri(uri: string): boolean {
  const params = parseSep7PayUri(uri);
  if (!params) return false;

  if (params.amount !== undefined) {
    const amount = Number(params.amount);
    if (!Number.isFinite(amount) || amount <= 0) return false;
  }
  if (params.memoType !== undefined && params.memo === undefined) return false;
  if (
    params.assetIssuer !== undefined &&
    (params.assetCode === undefined || params.assetCode === "XLM")
  ) {
    return false;
  }
  return true;
}
