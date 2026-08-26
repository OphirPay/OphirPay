// SPDX-License-Identifier: MIT

import type { WalletConnector, SignOptions } from "./types";

interface FreighterAPI {
  isConnected: () => Promise<boolean>;
  requestAccess: () => Promise<string>;
  getAddress: () => Promise<string>;
  getNetwork: () => Promise<string>;
  getNetworkDetails: () => Promise<{
    network: string;
    networkPassphrase: string;
  }>;
  signTransaction: (
    xdr: string,
    opts?: { network?: string; networkPassphrase?: string },
  ) => Promise<string>;
  signMessage: (message: string) => Promise<
    | { signedMessage: string; messageSignature: string }
    | string
  >;
}

function getFreighterApi(): FreighterAPI | undefined {
  if (typeof window === "undefined") return undefined;
  return (window as unknown as { freighter?: FreighterAPI }).freighter;
}

export const freighterConnector: WalletConnector = {
  id: "freighter",
  name: "Freighter",
  description: "Browser extension wallet for Stellar",
  icon: "🦊",

  isAvailable(): boolean {
    return !!getFreighterApi();
  },

  async connect() {
    const freighter = getFreighterApi();
    if (!freighter) {
      throw new Error(
        "Freighter wallet not installed. Please install the Freighter browser extension.",
      );
    }
    await freighter.requestAccess();
    const publicKey = await freighter.getAddress();
    const network = await freighter.getNetwork();
    return { publicKey, network };
  },

  async disconnect() {
    // Freighter has no explicit disconnect — handled by provider state
    if (typeof window !== "undefined") {
      localStorage.removeItem("ophirpay-wallet-connected");
    }
  },

  async signTransaction(xdr: string, opts?: SignOptions) {
    const freighter = getFreighterApi();
    if (!freighter) throw new Error("Freighter wallet not found. Please reconnect.");
    return freighter.signTransaction(xdr, {
      network: opts?.network,
      networkPassphrase: opts?.networkPassphrase,
    });
  },

  async signMessage(message: string) {
    const freighter = getFreighterApi();
    if (!freighter) throw new Error("Freighter wallet not found. Please reconnect.");
    const result = await freighter.signMessage(message);
    // Newer APIs return { signedMessage, messageSignature }; older return a
    // bare base64 signature string. Both are accepted by the server.
    const signature = typeof result === "string" ? result : result?.messageSignature;
    if (!signature) throw new Error("Freighter did not return a message signature.");
    return signature;
  },

  async getAddress() {
    const freighter = getFreighterApi();
    if (!freighter) return null;
    try {
      const connected = await freighter.isConnected();
      return connected ? await freighter.getAddress() : null;
    } catch {
      return null;
    }
  },

  async getNetwork() {
    const freighter = getFreighterApi();
    if (!freighter) return null;
    try {
      const connected = await freighter.isConnected();
      return connected ? await freighter.getNetwork() : null;
    } catch {
      return null;
    }
  },

  async isConnected() {
    const freighter = getFreighterApi();
    if (!freighter) return false;
    try {
      return await freighter.isConnected();
    } catch {
      return false;
    }
  },
};
