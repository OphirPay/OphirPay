// SPDX-License-Identifier: MIT

import type { WalletConnector, SignOptions } from "./types";

/**
 * Ledger hardware wallet connector — **pending, not yet supported**.
 *
 * Ledger Nano S / Nano X with the Stellar app provide the highest level of
 * security for signing transactions, but the browser integration is not
 * shipped: `@ledgerhq/hw-transport-webusb` and `@ledgerhq/hw-app-str` are not
 * dependencies, so `connect()` cannot derive an account and `signTransaction()`
 * cannot sign. Rather than offering a wallet that always fails, this connector
 * reports `isAvailable() === false` (keeping it out of `getAvailableWallets()`
 * and out of the connect flow) and the wallet registry marks it `pending` so
 * the selector shows a "Pending" badge instead of "Installed".
 *
 * When the real integration lands it must:
 * - Import `@ledgerhq/hw-transport-webusb` + `@ledgerhq/hw-app-str`.
 * - Derive the account on path `44'/148'/0'` and sign via the Stellar app.
 * - Require a Chromium-based browser (Chrome, Edge, Brave, Opera) because
 *   WebUSB is not exposed by Firefox or Safari, over HTTPS or localhost.
 *
 * Docs: https://www.ledger.com/stellar-wallet
 * Stellar app: https://support.ledger.com/article/360008672033-zd
 */

let ledgerPublicKey: string | null = null;
let ledgerConnected = false;

/**
 * Whether the current browser exposes WebUSB.
 *
 * Ledger's browser transport needs WebUSB, which only Chromium-based browsers
 * implement. Exported so the UI and docs can explain the hardware/browser
 * requirement even while the connector is pending.
 */
export function hasWebUsb(): boolean {
  if (typeof navigator === "undefined") return false;
  return "usb" in navigator;
}

export const isWebUsbSupported = hasWebUsb;

export const ledgerConnector: WalletConnector = {
  id: "ledger",
  name: "Ledger",
  description: "Hardware wallet — Pending WebUSB integration",
  icon: "🔐",

  /**
   * Ledger hardware wallet support is pending integration with @ledgerhq packages.
   * Returns false so the wallet selector does not present a non-functional connector.
   */
  isAvailable(): boolean {
    // Intentionally unsupported until the transport packages ship. Returning
    // `false` means the wallet selector never presents a connector that throws
    // on connect (see the "Supported wallets" table in README.md).
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
    throw new Error(
      "Ledger support is pending — this connector cannot sign transactions yet.",
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
