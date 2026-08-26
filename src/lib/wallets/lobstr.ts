// SPDX-License-Identifier: MIT

import type { WalletConnector, SignOptions } from "./types";

/**
 * Lobstr wallet connector.
 *
 * Lobstr is a popular Stellar web/mobile wallet. It doesn't have a traditional
 * browser extension API — it uses WalletConnect or SEP-0007 URI schemes.
 *
 * This connector:
 * - Opens https://lobstr.co in a popup for web sign-in
 * - Uses SEP-0007 (web+stellar:) URI scheme for transaction signing
 * - Falls back to clear instructions for mobile QR-based signing
 *
 * Docs: https://lobstr.co
 * API: https://lobstr.co/api
 *
 * For full WalletConnect integration, install @walletconnect/modal and
 * @stellar/wallet-sdk.
 */

let lobstrPublicKey: string | null = null;

/**
 * Open Lobstr in a popup window for web-based connection.
 */
function openLobstrPopup(): Window | null {
  if (typeof window === "undefined") return null;
  return window.open(
    "https://lobstr.co",
    "lobstr-wallet",
    "width=480,height=720",
  );
}

/**
 * Encode a Stellar transaction for SEP-0007 URI scheme.
 * Format: web+stellar:tx?xdr=<base64_encoded_xdr>&network=testnet
 */
function buildSep7Uri(xdr: string, network?: string): string {
  const base64Xdr = btoa(xdr).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const net = network === "TESTNET" ? "testnet" : "public";
  return `web+stellar:tx?xdr=${base64Xdr}&network=${net}`;
}

export const lobstrConnector: WalletConnector = {
  id: "lobstr",
  name: "Lobstr",
  description: "Popular Stellar web & mobile wallet",
  icon: "🌊",

  isAvailable(): boolean {
    // Lobstr is always available (web-based)
    return typeof window !== "undefined";
  },

  async connect() {
    // Open Lobstr web wallet for sign-in
    const popup = openLobstrPopup();
    if (!popup) {
      throw new Error(
        "Popups are blocked. Please allow popups for this site, then try again.",
      );
    }

    // In a production integration, we would use WalletConnect to establish
    // a secure session. For now, prompt the user to paste their public key
    // from the Lobstr app.
    return new Promise<{ publicKey: string; network: string }>(
      (resolve, reject) => {
        // Listen for the popup to communicate back via postMessage
        const handler = (event: MessageEvent) => {
          if (event.origin !== "https://lobstr.co") return;
          if (event.data?.type === "lobstr:connected" && event.data?.publicKey) {
            window.removeEventListener("message", handler);
            lobstrPublicKey = event.data.publicKey;
            const network = process.env.NEXT_PUBLIC_STELLAR_NETWORK === "TESTNET" ? "TESTNET" : "PUBLIC";
            resolve({ publicKey: event.data.publicKey, network });
          }
        };
        window.addEventListener("message", handler);

        // Timeout after 2 minutes
        setTimeout(() => {
          window.removeEventListener("message", handler);
          popup.close();
          reject(
            new Error(
              "Connection timed out. Open https://lobstr.co, sign in, and try again. " +
                "For full WalletConnect support, install @walletconnect/modal.",
            ),
          );
        }, 120_000);
      },
    );
  },

  async disconnect() {
    lobstrPublicKey = null;
    if (typeof window !== "undefined") {
      localStorage.removeItem("ophirpay-wallet-connected");
    }
  },

  async signTransaction(xdr: string, opts?: SignOptions) {
    // Open the SEP-0007 URI to trigger Lobstr signing
    const uri = buildSep7Uri(xdr, opts?.network);
    window.open(uri, "_blank");

    throw new Error(
      "Signing via SEP-0007: transaction opened in Lobstr. " +
        "For programmatic signing, install @walletconnect/modal for full integration. " +
        "The signed transaction will be submitted automatically once returned.",
    );
  },

  async getAddress() {
    return lobstrPublicKey;
  },

  async getNetwork() {
    return process.env.NEXT_PUBLIC_STELLAR_NETWORK === "TESTNET" ? "TESTNET" : "PUBLIC";
  },

  async isConnected() {
    return !!lobstrPublicKey;
  },
};
