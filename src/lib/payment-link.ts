// SPDX-License-Identifier: MIT

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
 * Generate a QR code data URL for a payment request.
 * For production, integrate with a QR library like qrcode.
 */
export function generatePaymentQrData(params: PaymentLinkParams): string {
  const link = generateStellarDeepLink(params);
  return link;
}
