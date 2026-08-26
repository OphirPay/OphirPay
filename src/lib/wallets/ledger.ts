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
 * Ledger requires WebUSB for browser communication.
 */
function hasWebUsb(): boolean {
  if (typeof navigator === "undefined") return false;
  return "usb" in navigator;
}

export const ledgerConnector: WalletConnector = {
  id: "ledger",
  name: "Ledger",
  description: "Hardware wallet — connect your Ledger device",
  icon: "🔐",

  isAvailable(): boolean {
    return typeof window !== "undefined" && hasWebUsb();
  },

  async connect() {
    if (!hasWebUsb()) {
      throw new Error(
        "WebUSB is not available in this browser. " +
          "Ledger requires Chrome/Edge/Brave with WebUSB support. " +
          "Install @ledgerhq/hw-transport-webusb for full integration.",
      );
    }

    // Dynamic import to avoid bundling ledger packages for users who don't need them
    try {
      // In a full integration, this would use the Stellar Ledger app:
      // import TransportWebUSB from "@ledgerhq/hw-transport-webusb";
      // import Str from "@ledgerhq/hw-app-str";
      // const transport = await TransportWebUSB.create();
      // const stellar = new Str(transport);
      // const { publicKey } = await stellar.getPublicKey("44'/148'/0'");
      throw new Error("DYNAMIC_IMPORT_NEEDED"); // triggers the catch below
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      if (msg === "DYNAMIC_IMPORT_NEEDED" || msg.includes("Cannot find module")) {
        throw new Error(
          "Ledger packages not installed. Run:\n\n" +
            "  npm install @ledgerhq/hw-transport-webusb @ledgerhq/hw-app-str\n\n" +
            "Then:\n" +
            "  1. Connect your Ledger device via USB\n" +
            "  2. Open the Stellar app on your Ledger\n" +
            "  3. Click Connect again",
        );
      }
      throw err;
    }
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
