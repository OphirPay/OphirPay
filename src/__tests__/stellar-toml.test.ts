// SPDX-License-Identifier: MIT

// SEP-1 stellar.toml served at /.well-known/stellar.toml (issue #813):
// generated from config, tracks contract ids + passphrase, fails on drift.

import { describe, it, expect, vi, afterEach } from "vitest";
import { buildStellarToml, readStellarTomlEnv } from "@/lib/stellar-toml";

const { GET } = await import("@/app/.well-known/stellar.toml/route");

afterEach(() => {
  vi.unstubAllEnvs();
});

function line(doc: string, key: string): string | undefined {
  return doc
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.startsWith(`${key}=`));
}

describe("buildStellarToml", () => {
  it("emits the configured passphrase and contract ids", () => {
    const doc = buildStellarToml({
      networkPassphrase: "Public Global Stellar Network ; September 2015",
      paymentContractId: "CCQGGUAAAA",
      emitterContractId: "CDAVU2BBBB",
      appUrl: "https://ophirpay.vercel.app",
    });

    expect(line(doc, "VERSION")).toBe('VERSION="2.0.0"');
    expect(line(doc, "NETWORK_PASSPHRASE")).toBe(
      'NETWORK_PASSPHRASE="Public Global Stellar Network ; September 2015"',
    );
    expect(line(doc, "PAYMENT")).toBe('PAYMENT="CCQGGUAAAA"');
    expect(line(doc, "EMITTER")).toBe('EMITTER="CDAVU2BBBB"');
    expect(doc).toContain("https://ophirpay.vercel.app");
  });

  it("changes when configuration changes (drift guard)", () => {
    const base = {
      networkPassphrase: "Test SDF Network ; September 2015",
      paymentContractId: "CAAA",
      emitterContractId: "CBBB",
      appUrl: "http://localhost:3000",
    };
    const rotated = buildStellarToml({ ...base, paymentContractId: "CCCC" });

    expect(rotated).not.toBe(buildStellarToml(base));
    expect(line(rotated, "PAYMENT")).toBe('PAYMENT="CCCC"');
  });
});

describe("GET /.well-known/stellar.toml", () => {
  it("returns text with values matching the live environment", async () => {
    vi.stubEnv("STELLAR_NETWORK_PASSPHRASE", "Test SDF Network ; September 2015");
    vi.stubEnv("NEXT_PUBLIC_CONTRACT_ID", "CCQGGUAAAA");
    vi.stubEnv("NEXT_PUBLIC_EMITTER_CONTRACT_ID", "CDAVU2BBBB");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://ophirpay.vercel.app");

    // Sanity: the builder reads exactly these vars.
    expect(readStellarTomlEnv()).toMatchObject({
      networkPassphrase: "Test SDF Network ; September 2015",
      paymentContractId: "CCQGGUAAAA",
      emitterContractId: "CDAVU2BBBB",
    });

    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/plain");
    const body = await res.text();
    expect(line(body, "NETWORK_PASSPHRASE")).toBe(
      'NETWORK_PASSPHRASE="Test SDF Network ; September 2015"',
    );
    expect(line(body, "PAYMENT")).toBe('PAYMENT="CCQGGUAAAA"');
    expect(line(body, "EMITTER")).toBe('EMITTER="CDAVU2BBBB"');
  });
});
