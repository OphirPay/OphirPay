// SPDX-License-Identifier: MIT

/**
 * @vitest-environment node
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { GET, OPTIONS } from "@/app/.well-known/stellar.toml/route";
import { generateStellarToml } from "@/lib/stellar-toml";

describe("SEP-1 stellar.toml Endpoint and Generator (Issue #813)", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("serves a valid SEP-1 document via GET /.well-known/stellar.toml", async () => {
    const res = await GET();
    expect(res.status).toBe(200);

    const contentType = res.headers.get("Content-Type");
    expect(contentType).toContain("text/plain");

    const cors = res.headers.get("Access-Control-Allow-Origin");
    expect(cors).toBe("*");

    const body = await res.text();
    expect(body).toContain('VERSION="2.0.0"');
    expect(body).toContain("NETWORK_PASSPHRASE=");
    expect(body).toContain("[DOCUMENTATION]");
    expect(body).toContain("[[CURRENCIES]]");
    expect(body).toContain("[CONTRACTS]");
  });

  it("handles OPTIONS preflight with CORS headers", async () => {
    const res = await OPTIONS();
    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(res.headers.get("Access-Control-Allow-Methods")).toContain("GET");
  });

  it("ensures contract ids and network passphrase match environment configuration", async () => {
    const testContractId = "CCQGGUJRRVXMHNEX2RYPODGJE2YRMYY4Y7A3KTJH3QP2LWZLTCOPRPET";
    const testEmitterId = "CDAVU2XJ7C2Y52GRJZKRG3HDI7AJ2K2FHAFH5FPDTSUQAV7XNBQNNVAN";
    const testPassphrase = "Test SDF Network ; September 2015";

    process.env.NEXT_PUBLIC_CONTRACT_ID = testContractId;
    process.env.NEXT_PUBLIC_EMITTER_CONTRACT_ID = testEmitterId;
    process.env.STELLAR_NETWORK_PASSPHRASE = testPassphrase;

    const toml = generateStellarToml();

    expect(toml).toContain(`NETWORK_PASSPHRASE="${testPassphrase}"`);
    expect(toml).toContain(`PAYMENT_CONTRACT="${testContractId}"`);
    expect(toml).toContain(`EMITTER_CONTRACT="${testEmitterId}"`);
  });

  it("fails when configuration drifts from expected contract IDs", () => {
    const customContractId = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
    const toml = generateStellarToml({ contractId: customContractId });

    expect(toml).toContain(`PAYMENT_CONTRACT="${customContractId}"`);
    expect(toml).not.toContain(
      'PAYMENT_CONTRACT="CCQGGUJRRVXMHNEX2RYPODGJE2YRMYY4Y7A3KTJH3QP2LWZLTCOPRPET"'
    );
  });

  it("switches network passphrase and USDC issuer when configured for PUBLIC mainnet", () => {
    process.env.NEXT_PUBLIC_STELLAR_NETWORK = "PUBLIC";
    delete process.env.STELLAR_NETWORK_PASSPHRASE;

    const toml = generateStellarToml();
    expect(toml).toContain('NETWORK_PASSPHRASE="Public Global Stellar Network ; September 2015"');
    // Mainnet circle USDC issuer
    expect(toml).toContain('issuer="GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN"');
  });

  it("verifies static public/.well-known/stellar.toml exists and is valid", () => {
    const staticPath = join(process.cwd(), "public", ".well-known", "stellar.toml");
    expect(existsSync(staticPath)).toBe(true);

    const content = readFileSync(staticPath, "utf8");
    expect(content).toContain('VERSION="2.0.0"');
    expect(content).toContain("PAYMENT_CONTRACT=");
    expect(content).toContain("EMITTER_CONTRACT=");
  });
});
