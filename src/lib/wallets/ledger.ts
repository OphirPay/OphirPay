// SPDX-License-Identifier: MIT

import { StrKey, TransactionBuilder } from "@stellar/stellar-sdk";
import { NETWORK_PASSPHRASE, STELLAR_NETWORK } from "@/lib/stellar";
import type StellarApp from "@ledgerhq/hw-app-str";
import type { WalletConnector, SignOptions } from "./types";

const LEDGER_DERIVATION_PATH = "44'/148'/0'";

let ledgerTransport: { close: () => Promise<void> } | null = null;
let stellarApp: StellarApp | null = null;
let ledgerPublicKey: string | null = null;

/**
 * Whether the current browser can open Ledger's WebUSB transport.
 * WebUSB is exposed only in secure contexts and Chromium-based browsers.
 */
export function isWebUsbSupported(): boolean {
  if (typeof window === "undefined" || typeof navigator === "undefined") {
    return false;
  }
  return window.isSecureContext && "usb" in navigator && Boolean(navigator.usb);
}

export const ledgerConnector: WalletConnector = {
  id: "ledger",
  name: "Ledger",
  description: "Hardware wallet — USB connection with the Stellar app",
  icon: "🔐",

  isAvailable(): boolean {
    return isWebUsbSupported();
  },

  async connect() {
    if (!isWebUsbSupported()) {
      throw new Error(
        "Ledger requires WebUSB in a Chromium-based browser over HTTPS or localhost.",
      );
    }

    const previousTransport = ledgerTransport;
    ledgerTransport = null;
    stellarApp = null;
    ledgerPublicKey = null;
    await previousTransport?.close();

    const [{ default: TransportWebUSB }, { default: Stellar }] =
      await Promise.all([
        import("@ledgerhq/hw-transport-webusb"),
        import("@ledgerhq/hw-app-str"),
      ]);
    const transport = await TransportWebUSB.create();
    const app = new Stellar(transport);

    try {
      const { rawPublicKey } = await app.getPublicKey(
        LEDGER_DERIVATION_PATH,
        true,
      );
      ledgerTransport = transport;
      stellarApp = app;
      ledgerPublicKey = StrKey.encodeEd25519PublicKey(rawPublicKey);
      return { publicKey: ledgerPublicKey, network: STELLAR_NETWORK };
    } catch (error) {
      try {
        await transport.close();
      } catch (closeError) {
        throw new AggregateError(
          [error, closeError],
          "Ledger connection failed and the USB transport could not be closed.",
        );
      }
      throw error;
    }
  },

  async disconnect() {
    const transport = ledgerTransport;
    ledgerTransport = null;
    stellarApp = null;
    ledgerPublicKey = null;
    if (typeof window !== "undefined") {
      localStorage.removeItem("ophirpay-wallet-connected");
    }
    await transport?.close();
  },

  async signTransaction(xdr: string, opts?: SignOptions) {
    if (!stellarApp || !ledgerPublicKey) {
      throw new Error("Ledger is not connected. Connect your device and retry.");
    }
    const transaction = TransactionBuilder.fromXDR(
      xdr,
      opts?.networkPassphrase ?? NETWORK_PASSPHRASE,
    );
    const { signature } = await stellarApp.signTransaction(
      LEDGER_DERIVATION_PATH,
      transaction.signatureBase(),
    );
    transaction.addSignature(ledgerPublicKey, signature.toString("base64"));
    return transaction.toXDR();
  },

  async getAddress() {
    return ledgerPublicKey;
  },

  async getNetwork() {
    return STELLAR_NETWORK;
  },

  async isConnected() {
    return Boolean(ledgerTransport && stellarApp && ledgerPublicKey);
  },
};
