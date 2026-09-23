// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest";
import { GET, OPTIONS } from "@/app/.well-known/stellar.toml/route";
import {
  buildStellarToml,
  parseStellarToml,
} from "@/lib/stellar-toml";

describe("SEP-1 stellar.toml — Route Handler", () => {
  it("GET /.well-known/stellar.toml returns 200 OK with text/plain and CORS headers", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/plain; charset=utf-8");
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(res.headers.get("Cache-Control")).toContain("public");

    const body = await res.text();
    expect(body).toContain("VERSION = \"2.0.0\"");
    expect(body).toContain("OphirPay");
  });

  it("OPTIONS /.well-known/stellar.toml returns 204 with CORS preflight headers", async () => {
    const res = await OPTIONS();
    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(res.headers.get("Access-Control-Allow-Methods")).toContain("GET");
  });
});

describe("SEP-1 stellar.toml — Configuration and Drift Protection", () => {
  const sampleEnv: Record<string, string | undefined> = {
    NEXT_PUBLIC_STELLAR_NETWORK: "TESTNET",
    STELLAR_NETWORK_PASSPHRASE: "Test SDF Network ; September 2015",
    NEXT_PUBLIC_STELLAR_HORIZON_URL: "https://horizon-testnet.stellar.org",
    NEXT_PUBLIC_CONTRACT_ID: "CCQGGUJRRVXMHNEX2RYPODGJE2YRMYY4Y7A3KTJH3QP2LWZLTCOPRPET",
    NEXT_PUBLIC_EMITTER_CONTRACT_ID: "CDAVU2XJ7C2Y52GRJZKRG3HDI7AJ2K2FHAFH5FPDTSUQAV7XNBQNNVAN",
    NEXT_PUBLIC_APP_URL: "https://test.ophirpay.com",
    STELLAR_TOML_SIGNING_KEY: "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H",
    STELLAR_TOML_ACCOUNTS: "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN7,GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H",
  };

  it("produces valid TOML matching environment configuration", () => {
    const toml = buildStellarToml(sampleEnv);
    const parsed = parseStellarToml(toml);

    expect(parsed.VERSION).toBe("2.0.0");
    expect(parsed.NETWORK_PASSPHRASE).toBe(sampleEnv.STELLAR_NETWORK_PASSPHRASE);
    expect(parsed.HORIZON_URL).toBe(sampleEnv.NEXT_PUBLIC_STELLAR_HORIZON_URL);
    expect(parsed.SIGNING_KEY).toBe(sampleEnv.STELLAR_TOML_SIGNING_KEY);
    expect(parsed.ACCOUNTS).toHaveLength(2);
    expect(parsed.DOCUMENTATION?.ORG_NAME).toBe("OphirPay");
    expect(parsed.DOCUMENTATION?.ORG_URL).toBe("https://test.ophirpay.com");

    expect(parsed.CONTRACTS).toBeDefined();
    expect(parsed.CONTRACTS).toHaveLength(2);
    expect(parsed.CONTRACTS![0].ID).toBe(sampleEnv.NEXT_PUBLIC_CONTRACT_ID);
    expect(parsed.CONTRACTS![1].ID).toBe(sampleEnv.NEXT_PUBLIC_EMITTER_CONTRACT_ID);
  });

  it("detects configuration drift when contract IDs change", () => {
    const originalToml = buildStellarToml(sampleEnv);
    const updatedEnv = {
      ...sampleEnv,
      NEXT_PUBLIC_CONTRACT_ID: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    };
    const updatedToml = buildStellarToml(updatedEnv);

    expect(originalToml).not.toBe(updatedToml);
    expect(originalToml).toContain(sampleEnv.NEXT_PUBLIC_CONTRACT_ID!);
    expect(updatedToml).toContain("CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA");
    expect(updatedToml).not.toContain(sampleEnv.NEXT_PUBLIC_CONTRACT_ID!);
  });

  it("adapts network passphrase automatically for public mainnet", () => {
    const mainnetEnv: Record<string, string | undefined> = {
      NEXT_PUBLIC_STELLAR_NETWORK: "PUBLIC",
      NEXT_PUBLIC_CONTRACT_ID: "C_MAINNET_CONTRACT",
    };
    const toml = buildStellarToml(mainnetEnv);
    const parsed = parseStellarToml(toml);

    expect(parsed.NETWORK_PASSPHRASE).toBe("Public Global Stellar Network ; September 2015");
    expect(parsed.HORIZON_URL).toBe("https://horizon.stellar.org");
    expect(parsed.CONTRACTS![0].ID).toBe("C_MAINNET_CONTRACT");
  });

  it("handles custom currencies declarations when provided in JSON", () => {
    const currencyEnv: Record<string, string | undefined> = {
      ...sampleEnv,
      STELLAR_TOML_CURRENCIES: JSON.stringify([
        {
          code: "OPHIR",
          issuer: "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H",
          displayDecimals: 7,
          name: "Ophir Token",
          desc: "Settlement utility token",
        },
      ]),
    };
    const toml = buildStellarToml(currencyEnv);
    const parsed = parseStellarToml(toml);

    expect(parsed.CURRENCIES).toHaveLength(1);
    expect(parsed.CURRENCIES![0].code).toBe("OPHIR");
    expect(parsed.CURRENCIES![0].display_decimals).toBe(7);
  });
});
