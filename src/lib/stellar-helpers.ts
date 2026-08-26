// SPDX-License-Identifier: MIT

import { isValidStellarAddress, XLM_STROOPS } from "@/lib/stellar";

/**
 * Parse a human-readable XLM amount into stroops (the smallest Stellar unit).
 * 1 XLM = 10,000,000 stroops
 */
export function xlmToStroops(xlm: number): number {
  return Math.round(xlm * XLM_STROOPS);
}

/**
 * Parse stroops back to a human-readable XLM string.
 */
export function stroopsToXlm(stroops: number): string {
  return (stroops / XLM_STROOPS).toFixed(7);
}

/** Get the minimum XLM balance required for account existence (1 XLM base reserve). */
export const MINIMUM_XLM_RESERVE = 1;

/**
 * Check if a balance is sufficient to cover an amount plus the minimum reserve.
 */
export function hasSufficientBalance(balance: number, amount: number): boolean {
  return balance >= amount + MINIMUM_XLM_RESERVE;
}

/**
 * Format a Stellar public key with the G...XXXX convention used across OphirPay.
 */
export function formatStellarKey(publicKey: string, showChars = 4): string {
  if (!publicKey || !isValidStellarAddress(publicKey)) return "Invalid Address";
  return `${publicKey.slice(0, showChars + 1)}…${publicKey.slice(-showChars)}`;
}

/**
 * Derive the federation-style address (username*domain) from a Stellar address.
 * Returns null for non-federated addresses.
 */
export function parseFederationAddress(address: string): { name: string; domain: string } | null {
  const parts = address.split("*");
  if (parts.length === 2 && parts[0] && parts[1]) {
    return { name: parts[0], domain: parts[1] };
  }
  return null;
}

/**
 * Get the Stellar network passphrase for the configured network.
 */
export function getNetworkPassphrase(network: "TESTNET" | "PUBLIC"): string {
  if (network === "TESTNET") return "Test SDF Network ; September 2015";
  return "Public Global Stellar Network ; September 2015";
}
