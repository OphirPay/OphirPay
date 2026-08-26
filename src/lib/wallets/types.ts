// SPDX-License-Identifier: MIT

/**
 * Wallet connector interface for multi-wallet support.
 * Each Stellar wallet (Freighter, Albedo, xBull, Ledger) implements this interface.
 */

export type WalletId = "freighter" | "albedo" | "xbull" | "ledger" | "rabet" | "lobstr";

export interface SignOptions {
  network?: string;
  networkPassphrase?: string;
}

export interface WalletConnector {
  /** Unique identifier */
  id: WalletId;
  /** Human-readable name */
  name: string;
  /** Short description */
  description: string;
  /** Icon emoji or component identifier */
  icon: string;
  /** Check if the wallet is installed/available in the browser */
  isAvailable(): boolean;
  /** Connect and request access, returns public key and network */
  connect(): Promise<{ publicKey: string; network: string }>;
  /** Disconnect the wallet */
  disconnect(): Promise<void>;
  /** Sign a transaction XDR */
  signTransaction(
    xdr: string,
    opts?: SignOptions,
  ): Promise<string>;
  /**
   * Sign an arbitrary message (proof of ownership). Optional — wallets that
   * don't support message signing leave it undefined. Returns the raw
   * signature as a base64 string.
   */
  signMessage?(message: string): Promise<string>;
  /** Get the current public key (returns null if not connected) */
  getAddress(): Promise<string | null>;
  /** Get the current Stellar network */
  getNetwork(): Promise<string | null>;
  /** Check if wallet is currently connected */
  isConnected(): Promise<boolean>;
}

export interface MultiWalletState {
  connected: boolean;
  publicKey: string | null;
  network: string | null;
  balance: string | null;
  balanceLoading: boolean;
  activeWalletId: WalletId | null;
}

/** All known wallet connectors registry */
export const WALLET_REGISTRY: {
  id: WalletId;
  name: string;
  description: string;
  icon: string;
  priority: number; // lower = shown first
}[] = [
  {
    id: "freighter",
    name: "Freighter",
    description: "Browser extension wallet for Stellar",
    icon: "🦊",
    priority: 1,
  },
  {
    id: "albedo",
    name: "Albedo",
    description: "Web-based Stellar wallet — no extension needed",
    icon: "☀️",
    priority: 2,
  },
  {
    id: "xbull",
    name: "xBull",
    description: "Feature-rich Stellar browser extension",
    icon: "🐂",
    priority: 3,
  },
  {
    id: "ledger",
    name: "Ledger",
    description: "Hardware wallet — requires Ledger device + Stellar app",
    icon: "🔐",
    priority: 4,
  },
  {
    id: "rabet",
    name: "Rabet",
    description: "Simple Stellar browser extension wallet",
    icon: "🐰",
    priority: 5,
  },
  {
    id: "lobstr",
    name: "Lobstr",
    description: "Popular Stellar web & mobile wallet",
    icon: "🌊",
    priority: 6,
  },
];
