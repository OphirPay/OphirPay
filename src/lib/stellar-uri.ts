// SPDX-License-Identifier: MIT

import { isValidStellarAddress } from "@/lib/stellar";

/**
 * SEP-7 (Stellar URI Scheme) payload builders, parsers, and validators.
 *
 * SEP-7 defines URIs like `web+stellar:pay?destination=G...` that Stellar
 * wallets recognize and act on. On mobile devices, browsers cannot invoke
 * browser-extension wallets, so SEP-7 URIs provide the standardized handoff
 * to mobile wallet apps (Lobstr, Solar, Beans, Decaf, Vibrant).
 *
 * Reference: https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0007.md
 */

export interface Sep7PayParams {
  /** Required — the destination Stellar account (G...) or federated address. */
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
  /** Optional — Stellar network passphrase override. */
  networkPassphrase?: string;
  /** Optional — callback URL (prefix `url:...`). */
  callback?: string;
}

export interface Sep7ValidationResult {
  valid: boolean;
  error?: string;
  params?: Sep7PayParams;
}

export interface SupportedMobileWallet {
  name: string;
  platform: string[];
  url: string;
}

export const SUPPORTED_MOBILE_WALLETS: SupportedMobileWallet[] = [
  { name: "Lobstr", platform: ["iOS", "Android"], url: "https://lobstr.co" },
  { name: "Solar Wallet", platform: ["iOS", "Android", "Desktop"], url: "https://solarwallet.io" },
  { name: "Beans App", platform: ["iOS", "Android"], url: "https://www.beansapp.com" },
  { name: "Decaf", platform: ["iOS", "Android"], url: "https://www.decaf.so" },
  { name: "Vibrant", platform: ["iOS", "Android"], url: "https://vibrantapp.com" },
];

/**
 * Validate a URI string against the SEP-7 `web+stellar:pay` grammar.
 *
 * Checks:
 * - Scheme is `web+stellar:pay?`
 * - Destination is a valid Stellar address or federation address
 * - Amount is a positive decimal string if present
 * - Asset code is 1-12 alphanumeric characters if present
 * - Asset issuer is a valid Stellar public key if non-native asset
 * - Memo length and format adhere to memo_type constraints
 */
export function validateSep7Uri(uri: string): Sep7ValidationResult {
  if (typeof uri !== "string" || !uri.trim()) {
    return { valid: false, error: "URI cannot be empty" };
  }

  if (!uri.startsWith("web+stellar:pay?")) {
    return { valid: false, error: "URI must begin with 'web+stellar:pay?'" };
  }

  const queryString = uri.slice("web+stellar:pay?".length);
  const searchParams = new URLSearchParams(queryString);

  const destination = searchParams.get("destination");
  if (!destination) {
    return { valid: false, error: "Missing required 'destination' parameter" };
  }

  const isAddress = isValidStellarAddress(destination);
  const isFederated = /^[a-zA-Z0-9._%+-]+(\*[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})$/.test(destination);
  if (!isAddress && !isFederated) {
    return { valid: false, error: "Invalid Stellar destination address or federated account" };
  }

  const amount = searchParams.get("amount") ?? undefined;
  if (amount !== undefined) {
    if (!/^\d+(\.\d{1,7})?$/.test(amount) || parseFloat(amount) <= 0) {
      return { valid: false, error: "Amount must be a positive decimal number with up to 7 decimal places" };
    }
  }

  const assetCode = searchParams.get("asset_code") ?? undefined;
  const assetIssuer = searchParams.get("asset_issuer") ?? undefined;

  if (assetCode) {
    if (!/^[a-zA-Z0-9]{1,12}$/.test(assetCode)) {
      return { valid: false, error: "asset_code must be 1 to 12 alphanumeric characters" };
    }
    if (assetCode.toUpperCase() !== "XLM" && !assetIssuer) {
      return { valid: false, error: "asset_issuer is required for non-native assets" };
    }
  }

  if (assetIssuer && !isValidStellarAddress(assetIssuer)) {
    return { valid: false, error: "asset_issuer must be a valid Stellar public key" };
  }

  const memo = searchParams.get("memo") ?? undefined;
  const rawMemoType = searchParams.get("memo_type") ?? undefined;
  let memoType: Sep7PayParams["memoType"] = undefined;

  if (rawMemoType) {
    if (!["MEMO_TEXT", "MEMO_ID", "MEMO_HASH", "MEMO_RETURN"].includes(rawMemoType)) {
      return { valid: false, error: "memo_type must be MEMO_TEXT, MEMO_ID, MEMO_HASH, or MEMO_RETURN" };
    }
    memoType = rawMemoType as Sep7PayParams["memoType"];
  } else if (memo) {
    memoType = "MEMO_TEXT";
  }

  if (memo) {
    if (memoType === "MEMO_TEXT") {
      const bytes = new TextEncoder().encode(memo);
      if (bytes.length > 28) {
        return { valid: false, error: "MEMO_TEXT exceeds 28 byte limit" };
      }
    } else if (memoType === "MEMO_ID") {
      if (!/^\d+$/.test(memo)) {
        return { valid: false, error: "MEMO_ID must be a 64-bit unsigned integer" };
      }
      try {
        const val = BigInt(memo);
        if (val < 0n || val > 18446744073709551615n) {
          return { valid: false, error: "MEMO_ID out of 64-bit range" };
        }
      } catch {
        return { valid: false, error: "MEMO_ID invalid integer" };
      }
    } else if (memoType === "MEMO_HASH" || memoType === "MEMO_RETURN") {
      const isHex = /^[0-9a-fA-F]{64}$/.test(memo);
      const isBase64 = /^[A-Za-z0-9+/]{43}=*$/.test(memo);
      if (!isHex && !isBase64) {
        return { valid: false, error: `${memoType} must be 32-byte hex or base64` };
      }
    }
  }

  const msg = searchParams.get("msg") ?? undefined;
  if (msg && msg.length > 300) {
    return { valid: false, error: "msg exceeds 300 characters" };
  }

  const networkPassphrase = searchParams.get("network_passphrase") ?? undefined;
  const callback = searchParams.get("callback") ?? undefined;

  return {
    valid: true,
    params: {
      destination,
      amount,
      assetCode,
      assetIssuer,
      memo,
      memoType,
      msg,
      networkPassphrase,
      callback,
    },
  };
}

/** Check if a URI string is a valid SEP-7 pay URI. */
export function isValidSep7Uri(uri: string): boolean {
  return validateSep7Uri(uri).valid;
}

/**
 * Parse a SEP-7 `web+stellar:pay` URI into typed params.
 * Returns null if the URI does not strictly conform to SEP-7 grammar.
 */
export function parseSep7PayUri(uri: string): Sep7PayParams | null {
  const result = validateSep7Uri(uri);
  return result.valid && result.params ? result.params : null;
}

/**
 * Build a SEP-7 `web+stellar:pay` URI.
 *
 * Only the destination is required. Optional params are omitted when empty
 * so the payload stays compact, and the native XLM asset is never encoded
 * as `asset_code` (per SEP-7, native payments omit the asset entirely).
 */
export function buildSep7PayUri(params: Sep7PayParams): string {
  const searchParams = new URLSearchParams();
  searchParams.set("destination", params.destination);

  if (params.amount !== undefined && params.amount !== "") {
    searchParams.set("amount", params.amount);
  }
  if (params.memo !== undefined && params.memo !== "") {
    searchParams.set("memo", params.memo);
    searchParams.set("memo_type", params.memoType || "MEMO_TEXT");
  }
  if (params.assetCode && params.assetCode.toUpperCase() !== "XLM") {
    searchParams.set("asset_code", params.assetCode);
    if (params.assetIssuer) {
      searchParams.set("asset_issuer", params.assetIssuer);
    }
  }
  if (params.msg) {
    searchParams.set("msg", params.msg);
  }
  if (params.networkPassphrase) {
    searchParams.set("network_passphrase", params.networkPassphrase);
  }
  if (params.callback) {
    searchParams.set("callback", params.callback);
  }

  return `web+stellar:pay?${searchParams.toString()}`;
}

/**
 * Build the receive payload for an account: a SEP-7 `pay` URI with no
 * amount, so the sender picks how much to send.
 */
export function buildReceivePayload(
  address: string,
  options?: { amount?: string; memo?: string; assetCode?: string; assetIssuer?: string }
): string {
  return buildSep7PayUri({
    destination: address,
    amount: options?.amount,
    memo: options?.memo,
    assetCode: options?.assetCode,
    assetIssuer: options?.assetIssuer,
  });
}
