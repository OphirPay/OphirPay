// SPDX-License-Identifier: MIT

/**
 * Generate shareable payment request links.
 * These encode payment details into a URL that recipients can open
 * and pay with their Stellar wallet.
 */

interface PaymentLinkParams {
  destination: string;
  amount?: string;
  memo?: string;
  assetCode?: string;
  message?: string;
}

/**
 * Generate a payment link URL that can be shared.
 * On testnet, we use the app's send page with pre-filled params.
 */
export function generatePaymentLink(params: PaymentLinkParams): string {
  const base = process.env.NEXT_PUBLIC_APP_URL || "https://ophirpay.vercel.app";

  const url = new URL("/send", base);
  url.searchParams.set("dest", params.destination);
  if (params.amount) url.searchParams.set("amount", params.amount);
  if (params.memo) url.searchParams.set("memo", params.memo);
  if (params.assetCode) url.searchParams.set("asset", params.assetCode);

  return url.toString();
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
