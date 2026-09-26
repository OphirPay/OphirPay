// SPDX-License-Identifier: MIT

import {
  buildSep7PayUri,
  buildSep7DeepLink,
  isValidSep7Uri,
  parseSep7Destination,
} from "@/lib/stellar-uri";
import { isValidStellarAddress } from "@/lib/stellar";

/**
 * Generate shareable payment request links.
 * These encode payment details into a URL that recipients can open
 * and pay with their Stellar wallet.
 */

export interface PaymentLinkParams {
  destination: string;
  amount?: string;
  memo?: string;
  assetCode?: string;
  message?: string;
}

/**
 * Generate a payment link URL that can be shared.
 * Uses the /pay/[address] route with optional amount/memo/asset query params.
 */
export function generatePaymentLink(params: PaymentLinkParams): string {
  const base = process.env.NEXT_PUBLIC_APP_URL || "https://ophirpay.vercel.app";

  const url = new URL(`/pay/${params.destination}`, base);
  if (params.amount) url.searchParams.set("amount", params.amount);
  if (params.memo) url.searchParams.set("memo", params.memo);
  if (params.assetCode) url.searchParams.set("asset", params.assetCode);

  return url.toString();
}

/**
 * Parse a payment link URL into its prefill parameters.
 * Returns null if the destination address is missing or invalid.
 */
export function parsePaymentLink(
  url: string | URL
): PaymentLinkParams | null {
  let parsed: URL;
  try {
    parsed = typeof url === "string" ? new URL(url) : url;
  } catch {
    return null;
  }

  // Destination is encoded in the /pay/[address] path segment.
  const match = parsed.pathname.match(/^\/pay\/([^/]+)\/?$/);
  const destination = match ? decodeURIComponent(match[1]) : "";
  if (!isValidStellarAddress(destination)) return null;

  const params: PaymentLinkParams = { destination };
  const amount = parsed.searchParams.get("amount");
  if (amount) params.amount = amount;
  const memo = parsed.searchParams.get("memo");
  if (memo) params.memo = memo;
  const assetCode = parsed.searchParams.get("asset");
  if (assetCode) params.assetCode = assetCode;

  return params;
}

/**
 * Generate a deep link for the Stellar mobile app.
 * stellar://pay?destination=G...&amount=10&memo=invoice-42
 */
export function generateStellarDeepLink(params: PaymentLinkParams): string {
  const url = new URL("stellar:pay");
  url.searchParams.set("destination", params.destination);
  if (params.amount) url.searchParams.set("amount", params.amount);
  if (params.memo) url.searchParams.set("memo", params.memo);
  return url.toString();
}

/**
 * Generate a SEP-7 URI for mobile wallet handoff.
 * Uses both `web+stellar:` (preferred) and `stellar:` (fallback) formats.
 * The `web+stellar:` scheme is the SEP-7 standard; `stellar:` is the
 * deep-link variant for wallets that don't handle web+stellar.
 *
 * @returns Object with both URI formats and a flag indicating if mobile
 *          deep linking is supported.
 */
export function generateSep7PaymentUri(
  params: PaymentLinkParams
): {
  webPlusStellarUri: string;
  stellarDeepLink: string;
  supportsMobileHandoff: boolean;
} {
  const sep7Params: Parameters<typeof buildSep7PayUri>[0] = {
    destination: params.destination,
    amount: params.amount,
    memo: params.memo,
    assetCode: params.assetCode,
    msg: params.message,
  };

  return {
    webPlusStellarUri: buildSep7PayUri(sep7Params),
    stellarDeepLink: buildSep7DeepLink(sep7Params),
    supportsMobileHandoff: typeof window !== "undefined" &&
      /Android|iPhone|iPad|iPod/i.test(navigator.userAgent),
  };
}

/**
 * Generate a QR code data URL for a payment request.
 * For SEP-7 compatible wallets, uses the web+stellar: URI.
 * Falls back to the stellar: deep link if needed.
 */
export function generatePaymentQrData(params: PaymentLinkParams): string {
  // Prefer SEP-7 web+stellar: URI
  const sep7Uri = buildSep7PayUri({
    destination: params.destination,
    amount: params.amount,
    memo: params.memo,
    assetCode: params.assetCode,
    msg: params.message,
  });
  return sep7Uri;
}
