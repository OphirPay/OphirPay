// SPDX-License-Identifier: MIT

import { describe, expect, it } from "vitest";
import { DEFAULT_CONTRACT_ID, EMITTER_CONTRACT_ID } from "@/lib/contracts";
import { NETWORK_PASSPHRASE } from "@/lib/stellar";
import { GET, OPTIONS, generateStellarToml } from "@/app/.well-known/stellar.toml/route";

describe("SEP-1 Stellar discovery document", () => {
  it("renders TOML scalar, array, and table syntax with required SEP-1 metadata", () => {
    const toml = generateStellarToml();
    expect(toml).toMatch(/^VERSION = "2\.0\.0"$/m);
    expect(toml).toMatch(/^NETWORK_PASSPHRASE = ".*"$/m);
    expect(toml).toMatch(/^ACCOUNTS = \[.*\]$/m);
    expect(toml).toMatch(/^\[SOROBAN_RPC\]$/m);
    expect(toml).toMatch(/^\[\[CURRENCIES\]\]$/m);
    expect(toml).toContain("DOCUMENTATION = ");
    expect(toml).toContain("SECURITY = ");
  });

  it("keeps network and contract metadata in sync with runtime configuration", () => {
    const toml = generateStellarToml();
    expect(toml).toContain(`NETWORK_PASSPHRASE = ${JSON.stringify(NETWORK_PASSPHRASE)}`);
    expect(toml).toContain(`OPHIRPAY_CONTRACT_ID = ${JSON.stringify(DEFAULT_CONTRACT_ID)}`);
    expect(toml).toContain(`EMITTER_CONTRACT_ID = ${JSON.stringify(EMITTER_CONTRACT_ID)}`);
  });

  it("serves text/plain with wildcard CORS and supports preflight", async () => {
    const response = GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("text/plain; charset=utf-8");
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");

    const preflight = OPTIONS();
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });
});