// SPDX-License-Identifier: MIT

import type { WalletConnector, SignOptions } from "./types";

/**
 * Rabet wallet connector.
 *
 * Rabet is a Stellar browser extension wallet with a clean, simple API.
 * It injects `window.rabet` into the page.
 *
 * Docs: https://rabet.io
 * GitHub: https://github.com/rabetofficial/rabet-extension
 */

interface RabetAPI {
  connect: () => Promise<{ publicKey: string }>;
  getPublicKey: () => Promise<string>;
  sign: (
    xdr: string,
    network?: string,
    networkPassphrase?: string,
  ) => Promise<{ xdr: string }>;
  disconnect: () => Promise<void>;
}

function getRabetApi(): RabetAPI | undefined {
  if (typeof window === "undefined") return undefined;
  return (window as unknown as { rabet?: RabetAPI }).rabet;
}

export const rabetConnector: WalletConnector = {
  id: "rabet",
  name: "Rabet",
  description: "Simple Stellar browser extension wallet",
  icon: "🐰",

  isAvailable(): boolean {
    return !!getRabetApi();
  },

  async connect() {
    const rabet = getRabetApi();
    if (!rabet) {
      throw new Error(
        "Rabet wallet not installed. Install it from https://rabet.io",
      );
    }
    const result = await rabet.connect();
    const network = process.env.NEXT_PUBLIC_STELLAR_NETWORK === "TESTNET" ? "TESTNET" : "PUBLIC";
    return { publicKey: result.publicKey, network };
  },

  async disconnect() {
    const rabet = getRabetApi();
    if (rabet) {
      try {
        await rabet.disconnect();
      } catch {
        // Best effort
      }
    }
    if (typeof window !== "undefined") {
      localStorage.removeItem("ophirpay-wallet-connected");
    }
  },

  async signTransaction(xdr: string, opts?: SignOptions) {
    const rabet = getRabetApi();
    if (!rabet) throw new Error("Rabet wallet not found. Please reconnect.");
    const result = await rabet.sign(
      xdr,
      opts?.network,
      opts?.networkPassphrase,
    );
    return result.xdr;
  },

  async getAddress() {
    const rabet = getRabetApi();
    if (!rabet) return null;
    try {
      return await rabet.getPublicKey();
    } catch {
      return null;
    }
  },

  async getNetwork() {
    return process.env.NEXT_PUBLIC_STELLAR_NETWORK === "TESTNET" ? "TESTNET" : "PUBLIC";
  },

  async isConnected() {
    const rabet = getRabetApi();
    if (!rabet) return false;
    try {
      const pk = await rabet.getPublicKey();
      return !!pk;
    } catch {
      return false;
    }
  },
};
