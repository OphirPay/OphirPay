// SPDX-License-Identifier: MIT

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { generateStellarToml } from "@/lib/stellar-toml";
import { GET, OPTIONS } from "@/app/.well-known/stellar.toml/route";

describe("SEP-1 stellar.toml generator and route", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env.STELLAR_NETWORK_PASSPHRASE = "Test SDF Network ; September 2015";
    process.env.NEXT_PUBLIC_STELLAR_HORIZON_URL = "https://horizon-testnet.stellar.org";
    process.env.NEXT_PUBLIC_STELLAR_RPC_URL = "https://soroban-testnet.stellar.org:443";
    process.env.NEXT_PUBLIC_CONTRACT_ID = "CCQGGUJRRVXMHNEX2RYPODGJE2YRMYY4Y7A3KTJH3QP2LWZLTCOPRPET";
    process.env.NEXT_PUBLIC_EMITTER_CONTRACT_ID = "CDAVU2XJ7C2Y52GRJZKRG3HDI7AJ2K2FHAFH5FPDTSUQAV7XNBQNNVAN";
    process.env.NEXT_PUBLIC_APP_URL = "https://ophirpay.vercel.app";
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("generates a valid SEP-1 document containing required version and network passphrase", () => {
    const toml = generateStellarToml();
    expect(toml).toContain('VERSION = "2.0.0"');
    expect(toml).toContain('NETWORK_PASSPHRASE = "Test SDF Network ; September 2015"');
    expect(toml).toContain('HORIZON_URL = "https://horizon-testnet.stellar.org"');
    expect(toml).toContain('RPC_SERVER = "https://soroban-testnet.stellar.org:443"');
  });

  it("includes deployed contract IDs and ACCOUNTS array matching configuration", () => {
    const toml = generateStellarToml();
    expect(toml).toContain("CCQGGUJRRVXMHNEX2RYPODGJE2YRMYY4Y7A3KTJH3QP2LWZLTCOPRPET");
    expect(toml).toContain("CDAVU2XJ7C2Y52GRJZKRG3HDI7AJ2K2FHAFH5FPDTSUQAV7XNBQNNVAN");
    expect(toml).toContain('OPHIRPAY_CONTRACT_ID = "CCQGGUJRRVXMHNEX2RYPODGJE2YRMYY4Y7A3KTJH3QP2LWZLTCOPRPET"');
    expect(toml).toContain('EMITTER_CONTRACT_ID = "CDAVU2XJ7C2Y52GRJZKRG3HDI7AJ2K2FHAFH5FPDTSUQAV7XNBQNNVAN"');
  });

  it("includes DOCUMENTATION, PRINCIPALS, and native CURRENCIES sections", () => {
    const toml = generateStellarToml();
    expect(toml).toContain("[DOCUMENTATION]");
    expect(toml).toContain('ORG_NAME = "OphirPay"');
    expect(toml).toContain("[PRINCIPALS]");
    expect(toml).toContain('email = "security@ophirpay.com"');
    expect(toml).toContain("[[CURRENCIES]]");
    expect(toml).toContain('code = "XLM"');
    expect(toml).toContain("is_asset_native = true");
  });

  it("GET handler returns 200 with text/plain content type and wildcard CORS header", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/plain; charset=utf-8");
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");

    const body = await res.text();
    expect(body).toContain('VERSION = "2.0.0"');
    expect(body).toContain("CCQGGUJRRVXMHNEX2RYPODGJE2YRMYY4Y7A3KTJH3QP2LWZLTCOPRPET");
  });

  it("OPTIONS handler returns 204 with CORS headers", async () => {
    const res = await OPTIONS();
    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(res.headers.get("Access-Control-Allow-Methods")).toContain("GET");
  });

  it("fails or reflects custom parameters when passed explicitly", () => {
    const custom = generateStellarToml({
      contractId: "CCUSTOM_CONTRACT_12345",
      networkPassphrase: "Public Global Stellar Network ; September 2015",
    });
    expect(custom).toContain("CCUSTOM_CONTRACT_12345");
    expect(custom).toContain("Public Global Stellar Network ; September 2015");
  });
});
