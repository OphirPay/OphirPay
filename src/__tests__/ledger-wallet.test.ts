// SPDX-License-Identifier: MIT

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ledgerConnector, hasWebUsb } from "@/lib/wallets/ledger";
import { WALLET_REGISTRY } from "@/lib/wallets";

describe("Ledger Hardware Wallet Connector", () => {
  const originalNavigator = globalThis.navigator;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    Object.defineProperty(globalThis, "navigator", {
      value: originalNavigator,
      configurable: true,
      writable: true,
    });
  });

  it("is marked as pending and unsupported in WALLET_REGISTRY", () => {
    const entry = WALLET_REGISTRY.find((w) => w.id === "ledger");
    expect(entry).toBeDefined();
    expect(entry?.supported).toBe(false);
    expect(entry?.status).toBe("pending");
    expect(entry?.description).toContain("Pending");
  });

  it("returns false for isAvailable() so it is not offered in UI as active", () => {
    expect(ledgerConnector.isAvailable()).toBe(false);
  });

  it("detects WebUSB presence via hasWebUsb()", () => {
    // With usb in navigator
    Object.defineProperty(globalThis, "navigator", {
      value: { usb: {} },
      configurable: true,
      writable: true,
    });
    expect(hasWebUsb()).toBe(true);

    // Without usb in navigator (e.g. Firefox/Safari)
    Object.defineProperty(globalThis, "navigator", {
      value: {},
      configurable: true,
      writable: true,
    });
    expect(hasWebUsb()).toBe(false);
  });

  it("connect() throws informative error about WebUSB in non-Chromium environments", async () => {
    Object.defineProperty(globalThis, "navigator", {
      value: {},
      configurable: true,
      writable: true,
    });

    await expect(ledgerConnector.connect()).rejects.toThrow(
      /WebUSB is not available in this browser.*Chromium-based browser/i,
    );
  });

  it("connect() throws informative error about pending package integration even when WebUSB exists", async () => {
    Object.defineProperty(globalThis, "navigator", {
      value: { usb: {} },
      configurable: true,
      writable: true,
    });

    await expect(ledgerConnector.connect()).rejects.toThrow(
      /pending full integration.*@ledgerhq/i,
    );
  });

  it("signTransaction() throws when called while disconnected", async () => {
    await expect(ledgerConnector.signTransaction("dummy_xdr")).rejects.toThrow(
      /Ledger not connected/i,
    );
  });
});
