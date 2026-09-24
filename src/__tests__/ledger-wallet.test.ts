// SPDX-License-Identifier: MIT

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  ledgerConnector,
  hasWebUsb,
  parseLedgerError,
  getLedgerDerivationPath,
  setLedgerDerivationPath,
  setLedgerTransportFactory,
  setLedgerAppFactory,
  DEFAULT_STELLAR_BIP44_PATH,
} from "@/lib/wallets/ledger";
import { Keypair, Networks, TransactionBuilder, Account } from "@stellar/stellar-sdk";

describe("Ledger Wallet Connector", () => {
  const TEST_PUBLIC_KEY = "GBH3O5IHGJ6GUKZCINS3UZGHVKDKYDLVIRKZY7GYA27B54WT3Q7H4KXO";
  const TEST_KEYPAIR = Keypair.fromPublicKey(TEST_PUBLIC_KEY);

  let mockTransport: { close: ReturnType<typeof vi.fn> };
  let mockStellarApp: {
    getPublicKey: ReturnType<typeof vi.fn>;
    signTransaction: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    // Reset derivation path
    setLedgerDerivationPath(DEFAULT_STELLAR_BIP44_PATH);

    // Setup mock transport and Stellar app
    mockTransport = {
      close: vi.fn().mockResolvedValue(undefined),
    };

    mockStellarApp = {
      getPublicKey: vi.fn().mockResolvedValue({ publicKey: TEST_PUBLIC_KEY }),
      signTransaction: vi.fn().mockResolvedValue({
        signature: Buffer.alloc(64, 0x01),
      }),
    };

    setLedgerTransportFactory(async () => mockTransport);
    setLedgerAppFactory(() => mockStellarApp);

    // Mock window & navigator with WebUSB and secureContext
    vi.stubGlobal("window", {
      isSecureContext: true,
      localStorage: {
        removeItem: vi.fn(),
      },
    });

    vi.stubGlobal("navigator", {
      usb: {
        requestDevice: vi.fn(),
      },
    });
  });

  afterEach(async () => {
    await ledgerConnector.disconnect();
    setLedgerTransportFactory(null);
    setLedgerAppFactory(null);
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe("WebUSB Availability Detection", () => {
    it("reports available when navigator.usb is present in secure context", () => {
      expect(hasWebUsb()).toBe(true);
      expect(ledgerConnector.isAvailable()).toBe(true);
    });

    it("reports unavailable when navigator.usb is undefined (Firefox/Safari)", () => {
      vi.stubGlobal("navigator", {});
      expect(hasWebUsb()).toBe(false);
      expect(ledgerConnector.isAvailable()).toBe(false);
    });

    it("reports unavailable when window is not a secure context (HTTP)", () => {
      vi.stubGlobal("window", { isSecureContext: false });
      expect(hasWebUsb()).toBe(false);
      expect(ledgerConnector.isAvailable()).toBe(false);
    });

    it("reports unavailable in SSR environment (window undefined)", () => {
      vi.stubGlobal("window", undefined);
      expect(ledgerConnector.isAvailable()).toBe(false);
    });
  });

  describe("Derivation Path Configuration", () => {
    it("uses default Stellar BIP-44 path 44'/148'/0'", () => {
      expect(getLedgerDerivationPath()).toBe("44'/148'/0'");
    });

    it("allows updating derivation path to another valid Stellar account index", () => {
      setLedgerDerivationPath("44'/148'/2'");
      expect(getLedgerDerivationPath()).toBe("44'/148'/2'");
    });

    it("rejects non-Stellar derivation paths", () => {
      expect(() => setLedgerDerivationPath("m/44'/0'/0'")).toThrow(
        /Invalid Stellar derivation path/
      );
    });
  });

  describe("Error Parsing & Actionable Messages", () => {
    it("provides clear message when WebUSB is unsupported", () => {
      vi.stubGlobal("navigator", {});
      const err = parseLedgerError(new Error("Generic error"));
      expect(err.message).toContain("WebUSB is not supported in this browser");
    });

    it("provides clear message when user cancels device selection", () => {
      const notFoundErr = new Error("No device selected");
      notFoundErr.name = "NotFoundError";
      const parsed = parseLedgerError(notFoundErr);
      expect(parsed.message).toContain("No Ledger device was selected");
    });

    it("provides clear message when device interface is busy", () => {
      const busyErr = new Error("Unable to claim interface: device busy 0x6800");
      const parsed = parseLedgerError(busyErr);
      expect(parsed.message).toContain("Ensure Ledger Live or other wallet applications are closed");
    });

    it("provides clear message when device is locked (0x5515)", () => {
      const lockedErr = new Error("Ledger error 0x5515: device locked");
      const parsed = parseLedgerError(lockedErr);
      expect(parsed.message).toContain("Your Ledger device is locked");
    });

    it("provides clear message when Stellar app is not open (0x6e00 CLA_NOT_SUPPORTED)", () => {
      const claErr = new Error("Ledger error 0x6e00: CLA_NOT_SUPPORTED");
      const parsed = parseLedgerError(claErr);
      expect(parsed.message).toContain("The Stellar app is not open on your Ledger device");
    });

    it("provides clear message when action is rejected on device (0x6985)", () => {
      const rejectErr = new Error("Ledger error 0x6985: User denied transaction");
      const parsed = parseLedgerError(rejectErr);
      expect(parsed.message).toContain("Operation was rejected on your Ledger device");
    });

    it("provides clear message on timeout", () => {
      const timeoutErr = new Error("Ledger communication timed out");
      const parsed = parseLedgerError(timeoutErr);
      expect(parsed.message).toContain("Ledger communication timed out");
    });
  });

  describe("Connection Flow", () => {
    it("connects successfully and returns public key and network", async () => {
      const result = await ledgerConnector.connect();
      expect(result.publicKey).toBe(TEST_PUBLIC_KEY);
      expect(result.network).toBeDefined();

      expect(mockStellarApp.getPublicKey).toHaveBeenCalledWith("44'/148'/0'", false);
      expect(await ledgerConnector.isConnected()).toBe(true);
      expect(await ledgerConnector.getAddress()).toBe(TEST_PUBLIC_KEY);
    });

    it("throws actionable error if device is not selected during connect", async () => {
      setLedgerTransportFactory(async () => {
        const err = new Error("No device selected");
        err.name = "NotFoundError";
        throw err;
      });

      await expect(ledgerConnector.connect()).rejects.toThrow(
        "No Ledger device was selected"
      );
      expect(await ledgerConnector.isConnected()).toBe(false);
      expect(await ledgerConnector.getAddress()).toBeNull();
    });

    it("throws actionable error if Stellar app is not open during connect", async () => {
      mockStellarApp.getPublicKey.mockRejectedValueOnce(
        new Error("Ledger 0x6e00: CLA_NOT_SUPPORTED")
      );

      await expect(ledgerConnector.connect()).rejects.toThrow(
        "The Stellar app is not open on your Ledger device"
      );
      expect(await ledgerConnector.isConnected()).toBe(false);
    });

    it("cleans up session and closes transport on disconnect", async () => {
      await ledgerConnector.connect();
      expect(await ledgerConnector.isConnected()).toBe(true);

      await ledgerConnector.disconnect();
      expect(await ledgerConnector.isConnected()).toBe(false);
      expect(await ledgerConnector.getAddress()).toBeNull();
      expect(mockTransport.close).toHaveBeenCalled();
    });
  });

  describe("Transaction Signing Flow", () => {
    function buildTestTransactionXdr(): string {
      const sourceAccount = new Account(TEST_KEYPAIR.publicKey(), "100");
      const tx = new TransactionBuilder(sourceAccount, {
        fee: "100",
        networkPassphrase: Networks.TESTNET,
      })
        .setTimeout(30)
        .build();
      return tx.toXDR();
    }

    it("throws error if signing without connecting first", async () => {
      const xdr = buildTestTransactionXdr();
      await expect(ledgerConnector.signTransaction(xdr)).rejects.toThrow(
        "Ledger is not connected"
      );
    });

    it("signs transaction XDR on testnet with valid decorated signature", async () => {
      await ledgerConnector.connect();

      const rawXdr = buildTestTransactionXdr();
      const signedXdr = await ledgerConnector.signTransaction(rawXdr, {
        networkPassphrase: Networks.TESTNET,
      });

      expect(signedXdr).toBeDefined();
      expect(typeof signedXdr).toBe("string");

      // Verify that the Stellar app was called with derivation path and signature base
      expect(mockStellarApp.signTransaction).toHaveBeenCalledWith(
        "44'/148'/0'",
        expect.any(Buffer)
      );

      // Verify the resulting transaction has the decorated signature
      const parsedTx = TransactionBuilder.fromXDR(signedXdr, Networks.TESTNET);
      expect(parsedTx.signatures.length).toBeGreaterThan(0);
      expect(parsedTx.signatures[0].hint()).toEqual(TEST_KEYPAIR.signatureHint());
    });

    it("translates device rejection into actionable error during signing", async () => {
      await ledgerConnector.connect();
      mockStellarApp.signTransaction.mockRejectedValueOnce(
        new Error("Ledger error 0x6985: User denied")
      );

      const rawXdr = buildTestTransactionXdr();
      await expect(
        ledgerConnector.signTransaction(rawXdr, { networkPassphrase: Networks.TESTNET })
      ).rejects.toThrow("Operation was rejected on your Ledger device");
    });
  });
});
