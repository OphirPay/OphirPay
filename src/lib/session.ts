// SPDX-License-Identifier: MIT

/**
 * Client-side session store for persisting wallet connection state.
 * Survives page refreshes without reconnecting to Freighter.
 */

interface WalletSession {
  publicKey: string;
  network: string;
  lastConnected: number;
}

const SESSION_KEY = "ophirpay-wallet-session";

/**
 * Save wallet session to localStorage.
 */
export function saveWalletSession(session: WalletSession): void {
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  } catch {
    // Storage full or unavailable — session will be lost on refresh
  }
}

/**
 * Load wallet session from localStorage.
 * Returns null if no session exists or if it's expired (24h).
 */
export function loadWalletSession(): WalletSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;

    const session = JSON.parse(raw) as WalletSession;

    // Expire sessions after 24 hours
    if (Date.now() - session.lastConnected > 86400000) {
      localStorage.removeItem(SESSION_KEY);
      return null;
    }

    return session;
  } catch {
    return null;
  }
}

/**
 * Clear the wallet session (on disconnect).
 */
export function clearWalletSession(): void {
  try {
    localStorage.removeItem(SESSION_KEY);
  } catch {
    // Ignore
  }
}
