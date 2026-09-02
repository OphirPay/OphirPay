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
