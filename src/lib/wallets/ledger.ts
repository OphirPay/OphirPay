// SPDX-License-Identifier: MIT

import { Keypair, Networks, StrKey, TransactionBuilder, xdr } from "@stellar/stellar-sdk";
import type { WalletConnector, SignOptions } from "./types";

/**
 * Standard Stellar BIP-44 derivation path:
 * 44' (purpose) / 148' (Stellar coin type) / 0' (account index)
 */
export const DEFAULT_STELLAR_BIP44_PATH = "44'/148'/0'";

let currentDerivationPath = DEFAULT_STELLAR_BIP44_PATH;
let ledgerPublicKey: string | null = null;
let ledgerConnected = false;

// Active transport and app references
let activeTransport: { close: () => Promise<void> } | null = null;
let activeStellarApp: unknown | null = null;

// Pluggable transport & app factories for unit testing and dependency injection
type TransportFactory = () => Promise<{ close: () => Promise<void> }>;
type StellarAppFactory = (transport: unknown) => {
  getPublicKey: (path: string, boolValidate?: boolean) => Promise<{ publicKey?: string; rawPublicKey?: Buffer }>;
  signTransaction: (path: string, transaction: Buffer) => Promise<{ signature: Buffer | Uint8Array }>;
};

let customTransportFactory: TransportFactory | null = null;
let customAppFactory: StellarAppFactory | null = null;

export function setLedgerTransportFactory(factory: TransportFactory | null): void {
  customTransportFactory = factory;
}

export function setLedgerAppFactory(factory: StellarAppFactory | null): void {
  customAppFactory = factory;
}

export function getLedgerDerivationPath(): string {
  return currentDerivationPath;
}

export function setLedgerDerivationPath(path: string): void {
  if (!path.startsWith("44'/148'/")) {
    throw new Error(
      `Invalid Stellar derivation path: "${path}". Must start with 44'/148'/ (e.g. 44'/148'/0').`
    );
  }
  currentDerivationPath = path;
}

/**
 * Check if WebUSB is available in this environment.
 * Ledger communication requires WebUSB in a secure context (HTTPS / localhost).
 */
export function hasWebUsb(): boolean {
  if (typeof navigator === "undefined" || typeof window === "undefined") {
    return false;
  }
  return "usb" in navigator && !!(navigator as unknown as { usb?: unknown }).usb && window.isSecureContext !== false;
}

/**
 * Translate raw Ledger / WebUSB errors into actionable user-facing messages.
 */
export function parseLedgerError(err: unknown): Error {
  if (err instanceof Error) {
    const msg = err.message.toLowerCase();
    const name = err.name;

    // WebUSB unsupported
    if (!hasWebUsb()) {
      return new Error(
        "WebUSB is not supported in this browser. Please use Chrome, Edge, Brave, or Opera over HTTPS to connect your Ledger device."
      );
    }

    // User cancelled the browser device selection prompt
    if (
      name === "NotFoundError" ||
      msg.includes("no device selected") ||
      msg.includes("access denied") ||
      msg.includes("user cancelled")
    ) {
      return new Error(
        "No Ledger device was selected. Please plug in your Ledger, unlock it with your PIN, and try again."
      );
    }

    // USB device occupied by another program (e.g. Ledger Live)
    if (
      msg.includes("busy") ||
      msg.includes("unable to claim interface") ||
      msg.includes("0x6800") ||
      msg.includes("0x6801")
    ) {
      return new Error(
        "Unable to connect to Ledger. Ensure Ledger Live or other wallet applications are closed, then try again."
      );
    }

    // Device locked
    if (
      msg.includes("device locked") ||
      msg.includes("locked device") ||
      msg.includes("0x5515") ||
      msg.includes("0x6982")
    ) {
      return new Error(
        "Your Ledger device is locked. Please unlock it with your PIN and open the Stellar app."
      );
    }

    // Stellar app not open on device (CLA/INS mismatch or APDU rejection)
    if (
      msg.includes("0x6e00") ||
      msg.includes("0x6700") ||
      msg.includes("0x6d00") ||
      msg.includes("0x6511") ||
      msg.includes("cla_not_supported") ||
      msg.includes("ins_not_supported") ||
      msg.includes("app not open") ||
      msg.includes("app is not open")
    ) {
      return new Error(
        "The Stellar app is not open on your Ledger device. Please open the Stellar app from the Ledger dashboard and try again."
      );
    }

    // User rejected action on device
    if (
      msg.includes("0x6985") ||
      msg.includes("user denied") ||
      msg.includes("conditions of use not satisfied") ||
      msg.includes("action cancelled by user") ||
      msg.includes("rejected")
    ) {
      return new Error(
        "Operation was rejected on your Ledger device."
      );
    }

    // Timeout
    if (msg.includes("timeout") || msg.includes("timed out")) {
      return new Error(
        "Ledger communication timed out. Ensure the device is connected, unlocked, and responsive."
      );
    }

    return err;
  }

  return new Error(String(err) || "Unknown error communicating with Ledger device.");
}

async function getTransport(): Promise<{ close: () => Promise<void> }> {
  if (customTransportFactory) {
    return customTransportFactory();
  }
  const TransportWebUSB = (await import("@ledgerhq/hw-transport-webusb")).default;
  return TransportWebUSB.create();
}

async function getStellarApp(transport: unknown): Promise<{
  getPublicKey: (path: string, boolValidate?: boolean) => Promise<{ publicKey?: string; rawPublicKey?: Buffer }>;
  signTransaction: (path: string, transaction: Buffer) => Promise<{ signature: Buffer | Uint8Array }>;
}> {
  if (customAppFactory) {
    return customAppFactory(transport);
  }
  const Str = (await import("@ledgerhq/hw-app-str")).default;
  return new Str(transport as any) as any; // eslint-disable-line @typescript-eslint/no-explicit-any
}

export const ledgerConnector: WalletConnector = {
  id: "ledger",
  name: "Ledger",
  description: "Hardware wallet — requires Chromium browser (WebUSB) + Stellar app",
  icon: "🔐",

  isAvailable(): boolean {
    return typeof window !== "undefined" && hasWebUsb();
  },

  async connect() {
    if (!hasWebUsb()) {
      throw new Error(
        "WebUSB is not supported in this browser. Please use Chrome, Edge, Brave, or Opera over HTTPS to connect your Ledger device."
      );
    }

    try {
      // Disconnect any existing session first
      if (activeTransport) {
        try {
          await activeTransport.close();
        } catch {
          // ignore
        }
        activeTransport = null;
        activeStellarApp = null;
      }

      const transport = await getTransport();
      activeTransport = transport;

      const app = await getStellarApp(transport);
      activeStellarApp = app;

      const keyResult = await app.getPublicKey(currentDerivationPath, false);
      const publicKey =
        keyResult.publicKey ||
        (keyResult.rawPublicKey ? StrKey.encodeEd25519PublicKey(keyResult.rawPublicKey) : "");
      if (!publicKey) {
        throw new Error("Ledger returned an empty public key.");
      }

      ledgerPublicKey = publicKey;
      ledgerConnected = true;

      const network = await this.getNetwork();
      return { publicKey, network: network || "TESTNET" };
    } catch (err) {
      ledgerConnected = false;
      ledgerPublicKey = null;
      if (activeTransport) {
        try {
          await activeTransport.close();
        } catch {
          // ignore
        }
        activeTransport = null;
        activeStellarApp = null;
      }
      throw parseLedgerError(err);
    }
  },

  async disconnect() {
    ledgerPublicKey = null;
    ledgerConnected = false;
    if (activeTransport) {
      try {
        await activeTransport.close();
      } catch {
        // ignore
      }
      activeTransport = null;
      activeStellarApp = null;
    }
    if (typeof window !== "undefined") {
      localStorage.removeItem("ophirpay-wallet-connected");
    }
  },

  async signTransaction(xdrString: string, opts?: SignOptions) {
    if (!ledgerConnected || !ledgerPublicKey) {
      throw new Error(
        "Ledger is not connected. Please connect your Ledger device and open the Stellar app."
      );
    }

    try {
      let transport = activeTransport;
      let app = activeStellarApp as {
        signTransaction: (path: string, transaction: Buffer) => Promise<{ signature: Buffer | Uint8Array }>;
      } | null;

      if (!transport || !app) {
        transport = await getTransport();
        activeTransport = transport;
        app = await getStellarApp(transport);
        activeStellarApp = app;
      }

      const network = opts?.network || (await this.getNetwork()) || "TESTNET";
      const networkPassphrase =
        opts?.networkPassphrase ||
        (network === "PUBLIC" ? Networks.PUBLIC : Networks.TESTNET);

      const tx = TransactionBuilder.fromXDR(xdrString, networkPassphrase);
      const signatureBase = tx.signatureBase();

      const result = await app.signTransaction(currentDerivationPath, signatureBase);
      if (!result?.signature) {
        throw new Error("Ledger failed to return a valid signature.");
      }

      const keypair = Keypair.fromPublicKey(ledgerPublicKey);
      const hint = keypair.signatureHint();
      const rawSig = Buffer.isBuffer(result.signature)
        ? result.signature
        : Buffer.from(result.signature);

      const decorated = new xdr.DecoratedSignature({
        hint,
        signature: rawSig,
      });

      tx.signatures.push(decorated);
      return tx.toXDR();
    } catch (err) {
      throw parseLedgerError(err);
    }
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
