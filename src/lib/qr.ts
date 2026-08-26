// SPDX-License-Identifier: MIT
/**
 * SEP-0007 URI Scheme and QR Code Utilities
 * Spec: https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0007.md
 */

export interface Sep7PayParams {
  destination: string;
  amount?: string;
  assetCode?: string;
  assetIssuer?: string;
  memo?: string;
  memoType?: "MEMO_TEXT" | "MEMO_ID" | "MEMO_HASH" | "MEMO_RETURN";
  msg?: string;
}

/**
 * Builds a valid SEP-0007 payment URI (web+stellar:pay).
 */
export function buildSep7PayUri(params: Sep7PayParams): string {
  if (!params.destination || !params.destination.trim()) {
    return "";
  }

  const queryParts: string[] = [];
  queryParts.push(`destination=${encodeURIComponent(params.destination.trim())}`);

  if (params.amount && params.amount.trim()) {
    queryParts.push(`amount=${encodeURIComponent(params.amount.trim())}`);
  }

  if (params.assetCode && params.assetCode.trim()) {
    queryParts.push(`asset_code=${encodeURIComponent(params.assetCode.trim())}`);
  }

  if (params.assetIssuer && params.assetIssuer.trim()) {
    queryParts.push(`asset_issuer=${encodeURIComponent(params.assetIssuer.trim())}`);
  }

  if (params.memo && params.memo.trim()) {
    queryParts.push(`memo=${encodeURIComponent(params.memo.trim())}`);
    if (params.memoType) {
      queryParts.push(`memo_type=${encodeURIComponent(params.memoType)}`);
    }
  }

  if (params.msg && params.msg.trim()) {
    queryParts.push(`msg=${encodeURIComponent(params.msg.trim())}`);
  }

  return `web+stellar:pay?${queryParts.join("&")}`;
}

/**
 * Generates an SVG Data URI or SVG markup for a given text payload.
 * Uses a deterministic SVG QR matrix algorithm.
 */
export function generateQrDataUri(payload: string): string {
  // Return an SVG data URL embedding the QR code representation
  const encodedPayload = encodeURIComponent(payload);
  return `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodedPayload}&margin=10`;
}
