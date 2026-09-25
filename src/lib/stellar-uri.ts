// SPDX-License-Identifier: MIT

/**
 * SEP-7 (Stellar URI Scheme) payload builders and validators.
 *
 * SEP-7 defines URIs like `web+stellar:pay?destination=G...` that Stellar
 * wallets recognize and act on. The receive page encodes the connected
 * account's address into a `pay` payload so a sender can scan the QR with
 * any SEP-7-compatible wallet and pay instantly.
 *
 * Mobile wallets that support SEP-7 can handle `web+stellar:` URIs via
 * deep linking, allowing payment completion without a browser extension.
 *
 * Reference: https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0007.md
 */

import { isValidStellarAddress } from "./stellar";

// ── Types ────────────────────────────────────────────────────────────────

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

/** Supported wallet apps for SEP-7 deep linking on mobile. */
export const SEP7_SUPPORTED_WALLETS = [
  {
    name: "Stellar CLI / Freighter",
    deepLinkScheme: "stellar:",
    supportsWebPlusStellar: true,
    iconUrl: "https://freighter.stellar.org/favicon.ico",
  },
  {
    name: "Solar Wallet",
    deepLinkScheme: "solar:",
    supportsWebPlusStellar: true,
    iconUrl: "https://solarwallet.io/favicon.ico",
  },
  {
    name: "Lobstr",
    deepLinkScheme: "lobstr:",
    supportsWebPlusStellar: true,
    iconUrl: "https://lobstr.co/favicon.ico",
  },
] as const satisfies Array<{
  name: string;
  deepLinkScheme: string;
  supportsWebPlusStellar: boolean;
  iconUrl: string;
}>;

// ── SEP-7 URI Builders ───────────────────────────────────────────────────

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
 * Build a mobile-friendly SEP-7 URI using the `stellar:` scheme.
 * This is the deep-link variant for wallets that don't handle `web+stellar:`.
 * The parameters are identical; only the scheme differs.
 */
export function buildSep7DeepLink(params: Sep7PayParams): string {
  const url = new URL("stellar:pay");
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

// ── SEP-7 Validation ─────────────────────────────────────────────────────

/**
 * Validate that a URI is a proper SEP-7 `web+stellar:pay` or `stellar:pay`
 * URI with a valid destination address.
 */
export function isValidSep7Uri(uri: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(uri);
  } catch {
    return false;
  }

  const scheme = parsed.protocol.replace(":", "");
  if (scheme !== "web+stellar" && scheme !== "stellar") {
    return false;
  }

  const path = parsed.pathname;
  if (path !== "/pay" && path !== "") {
    return false;
  }

  const destination = parsed.searchParams.get("destination");
  if (!destination || !isValidStellarAddress(destination)) {
    return false;
  }

  return true;
}

/**
 * Extract destination address from a SEP-7 URI.
 * Returns null if the URI is invalid or has no destination.
 */
export function parseSep7Destination(uri: string): string | null {
  try {
    const parsed = new URL(uri);
    return parsed.searchParams.get("destination") ?? null;
  } catch {
    return null;
  }
}

/**
 * Detect if the current environment supports SEP-7 deep linking.
 * On mobile, this typically returns true if a wallet app is installed.
 * On desktop without wallet extension, returns false and QR is the fallback.
 */
export function supportsSep7DeepLink(): boolean {
  if (typeof window === "undefined") return false;

  // Check if we're on a mobile device
  const isMobile =
    /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ||
    ("ontouchstart" in window && window.innerWidth < 768);

  if (!isMobile) return false;

  // Check for common wallet URL schemes via iframe sandbox test.
  // Many wallets register URL schemes that can be probed.
  const schemes = ["stellar:", "web+stellar:", "solar:", "lobstr:"];

  // In a real implementation, you'd probe each scheme. For now,
  // we consider mobile as "support available" and let the wallet
  // decide whether to handle the link.
  return true;
}
