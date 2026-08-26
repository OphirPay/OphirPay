// SPDX-License-Identifier: MIT

import type { WalletConnector, SignOptions } from "./types";

/**
 * Albedo wallet connector.
 *
 * Albedo is a web-based Stellar wallet that works without a browser extension.
 * It injects a sign-in popup window for authentication.
 *
 * API reference: https://albedo.link/docs
 *
 * Note: Albedo uses a popup-based OAuth-like flow. The `albedo` global
 * is injected when including their SDK script, or the user can use the
 * standalone web interface.
 */

interface AlbedoAPI {
  publicKey: () => Promise<{ pubkey: string }>;
  tx: (xdr: string, opts?: { network?: string; submit?: boolean }) => Promise<{
    xdr: string;
    tx_hash: string;
    signed_envelope_xdr: string;
  }>;
  signMessage: (params: { message: string; pubkey: string }) => Promise<{ signature: string }>;
}

function getAlbedoApi(): AlbedoAPI | undefined {
  if (typeof window === "undefined") return undefined;
  return (window as unknown as { albedo?: AlbedoAPI }).albedo;
}

export const albedoConnector: WalletConnector = {
  id: "albedo",
  name: "Albedo",
  description: "Web-based Stellar wallet — no extension needed",
  icon: "☀️",

  isAvailable(): boolean {
    // Albedo is always "available" since it's web-based
    return typeof window !== "undefined";
  },

  async connect() {
    const albedo = getAlbedoApi();
    if (!albedo) {
      throw new Error(
        "Albedo SDK not loaded. Visit https://albedo.link to sign in, or install the Albedo browser extension.",
      );
    }
    const result = await albedo.publicKey();
    const network = process.env.NEXT_PUBLIC_STELLAR_NETWORK === "TESTNET" ? "TESTNET" : "PUBLIC";
    return { publicKey: result.pubkey, network };
  },

  async disconnect() {
    if (typeof window !== "undefined") {
      localStorage.removeItem("ophirpay-wallet-connected");
    }
  },

  async signTransaction(xdr: string, opts?: SignOptions) {
    const albedo = getAlbedoApi();
    if (!albedo) throw new Error("Albedo SDK not loaded. Please reconnect.");
    const result = await albedo.tx(xdr, { network: opts?.network });
    return result.signed_envelope_xdr;
  },

  async signMessage(message: string) {
    const albedo = getAlbedoApi();
    if (!albedo) throw new Error("Albedo SDK not loaded. Please reconnect.");
    const { pubkey } = await albedo.publicKey();
    const result = await albedo.signMessage({ message, pubkey });
    return result.signature;
  },

  async getAddress() {
    const albedo = getAlbedoApi();
    if (!albedo) return null;
    try {
      const result = await albedo.publicKey();
      return result.pubkey;
    } catch {
      return null;
    }
  },

  async getNetwork() {
    return process.env.NEXT_PUBLIC_STELLAR_NETWORK === "TESTNET" ? "TESTNET" : "PUBLIC";
  },

  async isConnected() {
    const albedo = getAlbedoApi();
    if (!albedo) return false;
    try {
      await albedo.publicKey();
      return true;
    } catch {
      return false;
    }
  },
};
