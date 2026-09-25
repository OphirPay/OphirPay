// SPDX-License-Identifier: MIT
//
// SEP-1 `stellar.toml` drift guard — issue #813.
//
// The document at /.well-known/stellar.toml is machine-read by wallets,
// anchors and countersigners. When it drifts from the configuration the app
// actually runs with, every one of those integrations fails quietly: a wrong
// NETWORK_PASSPHRASE makes a client sign a transaction for a network the
// service is not on, and nothing surfaces an error until funds are stuck.
//
// These assertions make that drift loud.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  buildStellarToml,
  stellarTomlFacts,
  EXPECTED_PASSPHRASE,
} from "@/lib/stellar-toml";
import { NETWORK_PASSPHRASE, STELLAR_NETWORK, HORIZON_URL } from "@/lib/stellar";
import { OPHIRPAY_CONTRACT_ID, EMITTER_CONTRACT_ID } from "@/lib/contracts";

const ROOT = join(__dirname, "..", "..");

/** Minimal TOML reader for the scalar keys SEP-1 clients consume. */
function parseScalars(toml: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of toml.split("\n")) {
    const m = /^([A-Za-z0-9_]+)\s*=\s*"((?:[^"\\]|\\.)*)"\s*$/.exec(line.trim());
    if (m) out[m[1]] = m[2].replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  }
  return out;
}

describe("SEP-1 stellar.toml document — #813", () => {
  const toml = buildStellarToml();

  it("is a well-formed SEP-1 document with a VERSION", () => {
    expect(toml).toMatch(/^VERSION\s*=\s*"1\.0\.0"/m);
    // Balanced, non-escaped quotes on every emitted key.
    for (const line of toml.split("\n")) {
      if (!line.includes("=") || line.trimStart().startsWith("#")) continue;
      const quotes = (line.match(/(?<!\\)"/g) ?? []).length;
      expect(quotes % 2, `unbalanced quotes: ${line}`).toBe(0);
    }
  });

  it("advertises the passphrase of the configured network", () => {
    const scalars = parseScalars(toml);
    expect(scalars.NETWORK_PASSPHRASE).toBe(NETWORK_PASSPHRASE);
    expect(NETWORK_PASSPHRASE).toBe(EXPECTED_PASSPHRASE[STELLAR_NETWORK]);
  });

  it("advertises the configured contract ids", () => {
    const scalars = parseScalars(toml);
    expect(scalars.OPHIRPAY_CONTRACT_ID).toBe(OPHIRPAY_CONTRACT_ID);
    expect(scalars.EMITTER_CONTRACT_ID).toBe(EMITTER_CONTRACT_ID);
    expect(scalars.HORIZON_URL).toBe(HORIZON_URL);
  });

  it("fails when the file drifts from configuration", () => {
    // Simulate a config change (network switched to PUBLIC) and assert the
    // generated document moves with it — this is the drift the old
    // hand-maintained file could not detect.
    const publicToml = buildStellarToml({
      network: "PUBLIC",
      networkPassphrase: EXPECTED_PASSPHRASE.PUBLIC,
    });
    const scalars = parseScalars(publicToml);
    expect(scalars.NETWORK_PASSPHRASE).toBe(EXPECTED_PASSPHRASE.PUBLIC);
    expect(scalars.NETWORK_PASSPHRASE).not.toBe(NETWORK_PASSPHRASE);

    // …and that a stale passphrase is detectable.
    expect(parseScalars(toml).NETWORK_PASSPHRASE).not.toBe(
      EXPECTED_PASSPHRASE[STELLAR_NETWORK === "PUBLIC" ? "TESTNET" : "PUBLIC"]
    );
  });

  it("exposes facts that match the runtime config module", () => {
    expect(stellarTomlFacts()).toMatchObject({
      network: STELLAR_NETWORK,
      networkPassphrase: NETWORK_PASSPHRASE,
      contractId: OPHIRPAY_CONTRACT_ID,
      emitterContractId: EMITTER_CONTRACT_ID,
    });
  });

  it("is referenced from the deployment documentation", () => {
    const doc = readFileSync(join(ROOT, "docs", "DEPLOYMENT.md"), "utf8");
    expect(doc).toContain("stellar.toml");
    expect(doc).toMatch(/\.well-known\/stellar\.toml/);
  });
});
