// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { generateStellarToml } from "@/app/.well-known/stellar.toml/route";

describe("SEP-1 stellar.toml conformance and drift tests", () => {
  const publicTomlPath = path.resolve(process.cwd(), "public/.well-known/stellar.toml");

  it("public/.well-known/stellar.toml exists and is valid TOML format", () => {
    expect(fs.existsSync(publicTomlPath)).toBe(true);
    const content = fs.readFileSync(publicTomlPath, "utf8");
    expect(content).toContain('VERSION="2.0.0"');
    expect(content).toContain("NETWORK_PASSPHRASE=");
    expect(content).toContain("[DOCUMENTATION]");
    expect(content).toContain("[CONTRACTS]");
    expect(content).toContain("[[CURRENCIES]]");
  });

  it("generateStellarToml matches configured environment variables", () => {
    const originalPassphrase = process.env.STELLAR_NETWORK_PASSPHRASE;
    const originalContractId = process.env.NEXT_PUBLIC_CONTRACT_ID;
    const originalEmitterId = process.env.NEXT_PUBLIC_EMITTER_CONTRACT_ID;

    process.env.STELLAR_NETWORK_PASSPHRASE = "Custom Network Passphrase 2026";
    process.env.NEXT_PUBLIC_CONTRACT_ID = "CUSTOM_CONTRACT_123456";
    process.env.NEXT_PUBLIC_EMITTER_CONTRACT_ID = "CUSTOM_EMITTER_654321";

    const toml = generateStellarToml();
    expect(toml).toContain('NETWORK_PASSPHRASE="Custom Network Passphrase 2026"');
    expect(toml).toContain('OPHIRPAY="CUSTOM_CONTRACT_123456"');
    expect(toml).toContain('EMITTER="CUSTOM_EMITTER_654321"');

    // Restore env
    process.env.STELLAR_NETWORK_PASSPHRASE = originalPassphrase;
    process.env.NEXT_PUBLIC_CONTRACT_ID = originalContractId;
    process.env.NEXT_PUBLIC_EMITTER_CONTRACT_ID = originalEmitterId;
  });

  it("static public toml does not drift from default configuration", () => {
    const staticContent = fs.readFileSync(publicTomlPath, "utf8").trim();
    const generatedContent = generateStellarToml().trim();
    expect(staticContent).toBe(generatedContent);
  });
});
