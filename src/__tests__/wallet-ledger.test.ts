// SPDX-License-Identifier: MIT

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import {
  Account,
  Asset,
  Keypair,
  Networks,
  Operation,
  StrKey,
  TransactionBuilder,
} from "@stellar/stellar-sdk";

const {
  closeTransport,
  createTransport,
  getPublicKey,
  signTransaction,
} = vi.hoisted(() => ({
  closeTransport: vi.fn(),
  createTransport: vi.fn(),
  getPublicKey: vi.fn(),
  signTransaction: vi.fn(),
}));

vi.mock("@ledgerhq/hw-transport-webusb", () => ({
  default: { create: createTransport },
}));

vi.mock("@ledgerhq/hw-app-str", () => ({
  default: class MockStellarApp {
    getPublicKey(...args: unknown[]) {
      return getPublicKey(...args);
    }

    signTransaction(...args: unknown[]) {
      return signTransaction(...args);
    }
  },
}));

import { isWebUsbSupported, ledgerConnector } from "@/lib/wallets/ledger";

let signer: Keypair;

beforeEach(() => {
  signer = Keypair.random();
  closeTransport.mockReset();
  closeTransport.mockResolvedValue(undefined);
  createTransport.mockReset();
  createTransport.mockResolvedValue({ close: closeTransport });
  getPublicKey.mockReset();
  getPublicKey.mockResolvedValue({
    rawPublicKey: StrKey.decodeEd25519PublicKey(signer.publicKey()),
  });
  signTransaction.mockReset();
  signTransaction.mockImplementation(
    async (_path: string, signatureBase: Buffer) => ({
      signature: signer.sign(
        createHash("sha256").update(signatureBase).digest()
      ),
    })
  );
  Object.defineProperty(window, "isSecureContext", {
    configurable: true,
    value: true,
  });
  Object.defineProperty(navigator, "usb", {
    configurable: true,
    value: {},
  });
});

afterEach(async () => {
  if (await ledgerConnector.isConnected()) {
    await ledgerConnector.disconnect();
  }
});

function makeTransaction(): string {
  return new TransactionBuilder(new Account(signer.publicKey(), "1"), {
    fee: "100",
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(
      Operation.payment({
        destination: Keypair.random().publicKey(),
        asset: Asset.native(),
        amount: "1",
      })
    )
    .setTimeout(300)
    .build()
    .toXDR();
}

describe("Ledger wallet connector", () => {
  it("is available only in secure contexts with WebUSB", () => {
    expect(isWebUsbSupported()).toBe(true);
    Object.defineProperty(window, "isSecureContext", {
      configurable: true,
      value: false,
    });
    expect(isWebUsbSupported()).toBe(false);
  });

  it("connects to the Stellar app and signs transaction envelopes", async () => {
    const connection = await ledgerConnector.connect();
    expect(connection).toEqual({ publicKey: signer.publicKey(), network: "TESTNET" });
    expect(getPublicKey).toHaveBeenCalledWith("44'/148'/0'", true);
    expect(await ledgerConnector.getAddress()).toBe(signer.publicKey());
    expect(await ledgerConnector.isConnected()).toBe(true);

    const signedXdr = await ledgerConnector.signTransaction(makeTransaction(), {
      networkPassphrase: Networks.TESTNET,
    });
    expect(signTransaction.mock.calls[0]?.[0]).toBe("44'/148'/0'");
    expect(signTransaction.mock.calls[0]?.[1]).toBeDefined();
    const signedTransaction = TransactionBuilder.fromXDR(
      signedXdr,
      Networks.TESTNET
    );
    expect(signedTransaction.signatures).toHaveLength(1);
    expect(
      signer.verify(
        signedTransaction.hash(),
        signedTransaction.signatures[0].signature()
      )
    ).toBe(true);

    await ledgerConnector.disconnect();
    expect(closeTransport).toHaveBeenCalledOnce();
    expect(await ledgerConnector.getAddress()).toBeNull();
    expect(await ledgerConnector.isConnected()).toBe(false);
  });

  it("rejects connection when WebUSB is unavailable", async () => {
    Object.defineProperty(navigator, "usb", {
      configurable: true,
      value: undefined,
    });

    await expect(ledgerConnector.connect()).rejects.toThrow(
      /requires WebUSB in a Chromium-based browser/
    );
    expect(createTransport).not.toHaveBeenCalled();
  });

  it("closes the transport when address derivation fails", async () => {
    getPublicKey.mockRejectedValueOnce(new Error("Stellar app is not open"));

    await expect(ledgerConnector.connect()).rejects.toThrow(
      "Stellar app is not open"
    );
    expect(closeTransport).toHaveBeenCalledOnce();
    expect(await ledgerConnector.isConnected()).toBe(false);
  });
});
