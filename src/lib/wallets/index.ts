// SPDX-License-Identifier: MIT

export type { WalletId, WalletConnector, SignOptions, MultiWalletState } from "./types";
export { WALLET_REGISTRY } from "./types";
export { freighterConnector } from "./freighter";
export { albedoConnector } from "./albedo";
export { xBullConnector } from "./xbull";
export { ledgerConnector } from "./ledger";
export { rabetConnector } from "./rabet";
export { lobstrConnector } from "./lobstr";

import type { WalletConnector, WalletId } from "./types";
import { freighterConnector } from "./freighter";
import { albedoConnector } from "./albedo";
import { xBullConnector } from "./xbull";
import { ledgerConnector } from "./ledger";
import { rabetConnector } from "./rabet";
import { lobstrConnector } from "./lobstr";

/**
 * Map of all available wallet connectors by ID.
 */
export const walletConnectors: Record<WalletId, WalletConnector> = {
  freighter: freighterConnector,
  albedo: albedoConnector,
  xbull: xBullConnector,
  ledger: ledgerConnector,
  rabet: rabetConnector,
  lobstr: lobstrConnector,
};

/**
 * Get a wallet connector by ID.
 */
export function getWalletConnector(id: WalletId): WalletConnector {
  return walletConnectors[id];
}

/**
 * Get all available (installed) wallet connectors.
 */
export function getAvailableWallets(): WalletConnector[] {
  return Object.values(walletConnectors).filter((w) => w.isAvailable());
}

// ── Active Wallet Tracker (for non-React code) ─────────────────

let activeWalletId: WalletId | null = null;

/**
 * Set the active wallet ID. Called by MultiWalletProvider on connect/disconnect.
 */
export function setActiveWalletId(id: WalletId | null): void {
  activeWalletId = id;
}

/**
 * Get the active wallet ID. Used by contract-advanced to get the signer.
 */
export function getActiveWalletId(): WalletId | null {
  return activeWalletId;
}

/**
 * Get the active wallet connector (for non-React signing code).
 * Falls back to Freighter if no active wallet is set.
 */
export function getActiveWalletConnector(): WalletConnector | null {
  if (activeWalletId) {
    const connector = walletConnectors[activeWalletId];
    if (connector?.isAvailable()) return connector;
  }
  // Fallback: try Freighter for backward compatibility
  const freighter = walletConnectors.freighter;
  if (freighter?.isAvailable()) return freighter;
  // Try any available wallet
  for (const id of ["xbull", "rabet", "albedo", "lobstr"] as WalletId[]) {
    const c = walletConnectors[id];
    if (c?.isAvailable()) return c;
  }
  return null;
}
