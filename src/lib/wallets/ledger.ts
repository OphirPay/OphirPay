// SPDX-License-Identifier: MIT

import type { WalletConnector, SignOptions } from "./types";

/**
 * Ledger hardware wallet connector.
 *
 * Ledger Nano S / Nano X with the Stellar app provide the highest level
 * of security for signing transactions.
 *
 * Requirements:
 * - Ledger device with Stellar app installed
 * - @ledgerhq/hw-transport-webusb (npm install @ledgerhq/hw-transport-webusb)
 * - @stellar/stellar-sdk Ledger integration
 *
 * This connector uses WebUSB to communicate directly with the Ledger device.
 * The user must have their Ledger connected via USB and the Stellar app open.
 *
 * Docs: https://www.ledger.com/stellar-wallet
 * Stellar app: https://support.ledger.com/article/360008672033-zd
 */

let ledgerPublicKey: string | null = null;
let ledgerConnected = false;

/**
 * Check if WebUSB is available in this browser.
 * Ledger requires WebUSB for browser communication (Chromium-based browsers only).
 */
export function hasWebUsb(): boolean {
  if (typeof navigator === "undefined") return false;
  return "usb" in navigator;
}

export const ledgerConnector: WalletConnector = {
  id: "ledger",
  name: "Ledger",
  description: "Hardware wallet — requires WebUSB in Chromium + Ledger Stellar app (Pending)",
  icon: "🔐",

  /**
   * Ledger hardware wallet support is pending integration with @ledgerhq packages.
   * Returns false so the wallet selector does not present a non-functional connector.
   */
  isAvailable(): boolean {
    return false;
  },

  async connect(): Promise<{ publicKey: string; network: string }> {
    if (!hasWebUsb()) {
      throw new Error(
        "WebUSB is not available in this browser. " +
          "Ledger hardware wallet requires a Chromium-based browser (Chrome, Edge, Brave, Opera) with WebUSB support.",
      );
    }

    throw new Error(
      "Ledger hardware wallet connector is currently pending full integration. " +
        "It requires @ledgerhq/hw-transport-webusb and @ledgerhq/hw-app-str packages. " +
        "Please use an active wallet (Freighter, Albedo, xBull, Rabet, or Lobstr).",
    );
  },

  async disconnect() {
    ledgerPublicKey = null;
    ledgerConnected = false;
    if (typeof window !== "undefined") {
      localStorage.removeItem("ophirpay-wallet-connected");
    }
  },

  async signTransaction(_xdr: string, _opts?: SignOptions) {
    if (!ledgerConnected) {
      throw new Error(
        "Ledger not connected. Connect your device and open the Stellar app.",
      );
    }

    // Full integration would sign via the Ledger Stellar app:
    // const transport = await TransportWebUSB.create();
    // const stellar = new Str(transport);
    // const signature = await stellar.signTransaction("44'/148'/0'", xdr);

    throw new Error(
      "Ledger signing requires @ledgerhq/hw-transport-webusb and @ledgerhq/hw-app-str. " +
        "Install both packages, then connect your Ledger with the Stellar app open.",
    );
  },

  async getAddress() {
    return ledgerPublicKey;
  },

  async getNetwork() {
    return process.env.NEXT_PUBLIC_STELLAR_NETWORK === "TESTNET" ? "TESTNET" : "PUBLIC";
  },

  async isConnected() {
    return ledgerConnected;
  },
};
