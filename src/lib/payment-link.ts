// SPDX-License-Identifier: MIT

import { isValidStellarAddress } from "@/lib/stellar";
import { buildSep7PayUri, parseSep7PayUri, type Sep7PayParams } from "@/lib/stellar-uri";

/**
 * Generate and parse shareable payment request links and SEP-7 mobile URIs.
 *
 * Supports both:
 * 1. Web application links: /pay/[address]?amount=10&memo=inv&asset=USDC
 * 2. Mobile wallet SEP-7 URIs: web+stellar:pay?destination=G...&amount=10&memo=inv
 */

export interface PaymentLinkParams {
  destination: string;
  amount?: string;
  memo?: string;
  memoType?: "MEMO_TEXT" | "MEMO_ID" | "MEMO_HASH" | "MEMO_RETURN";
  assetCode?: string;
  assetIssuer?: string;
  message?: string;
}

/**
 * Generate a payment link URL that can be shared via web.
 * Uses the /pay/[address] route with optional amount/memo/asset query params.
 */
export function generatePaymentLink(params: PaymentLinkParams): string {
  const base = process.env.NEXT_PUBLIC_APP_URL || "https://ophirpay.vercel.app";

  const url = new URL(`/pay/${params.destination}`, base);
  if (params.amount) url.searchParams.set("amount", params.amount);
  if (params.memo) url.searchParams.set("memo", params.memo);
  if (params.memoType) url.searchParams.set("memo_type", params.memoType);
  if (params.assetCode) url.searchParams.set("asset", params.assetCode);
  if (params.assetIssuer) url.searchParams.set("issuer", params.assetIssuer);
  if (params.message) url.searchParams.set("msg", params.message);

  return url.toString();
}

/**
 * Generate a SEP-7 `web+stellar:pay` URI from payment parameters for mobile wallet handoff.
 */
export function generateSep7PaymentUri(params: PaymentLinkParams): string {
  return buildSep7PayUri({
    destination: params.destination,
    amount: params.amount,
    memo: params.memo,
    memoType: params.memoType,
    assetCode: params.assetCode,
    assetIssuer: params.assetIssuer,
    msg: params.message,
  });
}

/**
 * Parse a payment link URL or a SEP-7 URI into its prefill parameters.
 * Supports:
 * - Web links: /pay/[address]?amount=...
 * - SEP-7 URIs: web+stellar:pay?destination=...&amount=...&memo=...
 * - Deep links: stellar:pay?destination=...
 *
 * Returns null if the destination address is missing or invalid.
 */
export function parsePaymentLink(
  url: string | URL
): PaymentLinkParams | null {
  const urlStr = typeof url === "string" ? url : url.toString();

  // Handle SEP-7 URI (web+stellar:pay)
  if (urlStr.startsWith("web+stellar:pay")) {
    const parsedSep7 = parseSep7PayUri(urlStr);
    if (!parsedSep7) return null;
    return {
      destination: parsedSep7.destination,
      amount: parsedSep7.amount,
      memo: parsedSep7.memo,
      memoType: parsedSep7.memoType,
      assetCode: parsedSep7.assetCode,
      assetIssuer: parsedSep7.assetIssuer,
      message: parsedSep7.msg,
    };
  }

  // Handle legacy stellar:pay deep links
  if (urlStr.startsWith("stellar:pay")) {
    try {
      const u = new URL(urlStr);
      const destination = u.searchParams.get("destination") || "";
      if (!isValidStellarAddress(destination)) return null;
      const params: PaymentLinkParams = { destination };
      const amount = u.searchParams.get("amount");
      if (amount) params.amount = amount;
      const memo = u.searchParams.get("memo");
      if (memo) params.memo = memo;
      const memoType = u.searchParams.get("memo_type") as PaymentLinkParams["memoType"];
      if (memoType) params.memoType = memoType;
      const assetCode = u.searchParams.get("asset_code") || u.searchParams.get("asset");
      if (assetCode) params.assetCode = assetCode;
      const assetIssuer = u.searchParams.get("asset_issuer") || u.searchParams.get("issuer");
      if (assetIssuer) params.assetIssuer = assetIssuer;
      const msg = u.searchParams.get("msg") || u.searchParams.get("message");
      if (msg) params.message = msg;
      return params;
    } catch {
      return null;
    }
  }

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
  const memoType = parsed.searchParams.get("memo_type") as PaymentLinkParams["memoType"];
  if (memoType) params.memoType = memoType;
  const assetCode = parsed.searchParams.get("asset") || parsed.searchParams.get("asset_code");
  if (assetCode) params.assetCode = assetCode;
  const assetIssuer = parsed.searchParams.get("issuer") || parsed.searchParams.get("asset_issuer");
  if (assetIssuer) params.assetIssuer = assetIssuer;
  const message = parsed.searchParams.get("msg") || parsed.searchParams.get("message");
  if (message) params.message = message;

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
 * Generate a QR code data payload for a payment request.
 * Encodes the standard SEP-7 web+stellar:pay URI so any Stellar wallet app can scan it.
 */
export function generatePaymentQrData(params: PaymentLinkParams): string {
  return generateSep7PaymentUri(params);
}
