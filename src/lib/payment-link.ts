// SPDX-License-Identifier: MIT

import { isValidStellarAddress } from "@/lib/stellar";

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

// ── Parsing ───────────────────────────────────────────────────

/**
 * Stellar `MEMO_TEXT` is capped at 28 bytes. The send form enforces the same
 * limit, so a link carrying a longer memo is rejected here rather than silently
 * producing a form that cannot be submitted.
 */
export const MAX_MEMO_LENGTH = 28;

/** Values recovered from a payment link, ready to prefill the send form. */
export interface ParsedPaymentLink {
  destination: string;
  amount?: string;
  memo?: string;
  assetCode?: string;
}

/**
 * Outcome of reading a payment link.
 *
 * `empty` and `invalid` are deliberately distinct: opening `/send` directly is
 * not an error and must not surface a warning, whereas following a malformed
 * link must say what is wrong instead of rendering a blank or half-filled form.
 */
export type PaymentLinkParseResult =
  | { status: "empty" }
  | { status: "ok"; value: ParsedPaymentLink }
  | { status: "invalid"; error: string };

/** Accepts a `URLSearchParams` or any plain read-only param bag. */
type ParamSource =
  | URLSearchParams
  | { get(key: string): string | null | undefined };

function read(source: ParamSource, key: string): string | undefined {
  const raw = source.get(key);
  if (raw === null || raw === undefined) return undefined;
  const trimmed = raw.trim();
  return trimmed === "" ? undefined : trimmed;
}

/**
 * Parse the query parameters written by {@link generatePaymentLink}.
 *
 * Kept next to the generator on purpose: the two halves share one parameter
 * vocabulary (`dest` / `amount` / `memo` / `asset`), and splitting them across
 * modules is how the encoder and decoder drift apart.
 */
export function parsePaymentLink(source: ParamSource): PaymentLinkParseResult {
  const destination = read(source, "dest");

  // No recipient means this is a plain visit to the send page, not a link.
  if (!destination) return { status: "empty" };

  if (!isValidStellarAddress(destination)) {
    return {
      status: "invalid",
      error:
        "This payment link contains an invalid Stellar address. Ask the sender for a new link.",
    };
  }

  const amount = read(source, "amount");
  if (amount !== undefined) {
    const parsed = Number(amount);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return {
        status: "invalid",
        error: "This payment link contains an invalid amount.",
      };
    }
  }

  const memo = read(source, "memo");
  if (memo !== undefined && memo.length > MAX_MEMO_LENGTH) {
    return {
      status: "invalid",
      error: `This payment link's memo exceeds the ${MAX_MEMO_LENGTH}-character Stellar limit.`,
    };
  }

  return {
    status: "ok",
    value: {
      destination,
      ...(amount !== undefined ? { amount } : {}),
      ...(memo !== undefined ? { memo } : {}),
      ...(read(source, "asset") !== undefined
        ? { assetCode: read(source, "asset") }
        : {}),
    },
  };
}
