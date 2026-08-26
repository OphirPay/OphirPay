// SPDX-License-Identifier: MIT

import type { WalletConnector, SignOptions } from "./types";

/**
 * xBull wallet connector.
 *
 * xBull is a feature-rich Stellar browser extension wallet.
 * It injects `window.xBullSDK` into the page.
 *
 * Docs: https://github.com/Creit-Tech/xBull-Wallet
 */

interface XBullAPI {
  connect: () => Promise<string>;
  getPublicKey: () => Promise<string>;
  sign: (params: {
    xdr: string;
    publicKey?: string;
    network?: string;
  }) => Promise<{ signature: string }>;
  signMessage: (message: string) => Promise<string>;
  closeConnections: () => Promise<void>;
}

function getXBullApi(): XBullAPI | undefined {
  if (typeof window === "undefined") return undefined;
  return (window as unknown as { xBullSDK?: XBullAPI }).xBullSDK;
}

export const xBullConnector: WalletConnector = {
  id: "xbull",
  name: "xBull",
  description: "Feature-rich Stellar browser extension",
  icon: "🐂",

  isAvailable(): boolean {
    return !!getXBullApi();
  },

  async connect() {
    const xbull = getXBullApi();
    if (!xbull) {
      throw new Error(
        "xBull wallet not installed. Please install the xBull browser extension.",
      );
    }
    // xBull's connect() returns the public key
    const publicKey = await xbull.connect();
    const network = process.env.NEXT_PUBLIC_STELLAR_NETWORK === "TESTNET" ? "TESTNET" : "PUBLIC";
    return { publicKey, network };
  },

  async disconnect() {
    const xbull = getXBullApi();
    if (xbull) {
      try {
        await xbull.closeConnections();
      } catch {
        // Best effort
      }
    }
    if (typeof window !== "undefined") {
      localStorage.removeItem("ophirpay-wallet-connected");
    }
  },

  async signTransaction(xdr: string, opts?: SignOptions) {
    const xbull = getXBullApi();
    if (!xbull) throw new Error("xBull wallet not found. Please reconnect.");
    const result = await xbull.sign({ xdr, network: opts?.network });
    // xBull returns the signature, not the signed XDR
    // NOTE: xBull returns the raw signature, not a signed XDR envelope.
    // For full Soroban compatibility, the caller should use submitContractInvocation
    // which handles signature attachment internally.
    return result.signature;
  },

  async signMessage(message: string) {
    const xbull = getXBullApi();
    if (!xbull) throw new Error("xBull wallet not found. Please reconnect.");
    return xbull.signMessage(message);
  },

  async getAddress() {
    const xbull = getXBullApi();
    if (!xbull) return null;
    try {
      return await xbull.getPublicKey();
    } catch {
      return null;
    }
  },

  async getNetwork() {
    return process.env.NEXT_PUBLIC_STELLAR_NETWORK === "TESTNET" ? "TESTNET" : "PUBLIC";
  },

  async isConnected() {
    const xbull = getXBullApi();
    if (!xbull) return false;
    try {
      const pk = await xbull.getPublicKey();
      return !!pk;
    } catch {
      return false;
    }
  },
};
