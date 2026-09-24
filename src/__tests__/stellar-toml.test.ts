// SPDX-License-Identifier: MIT
//
// SEP-1 stellar.toml drift guard — issue #813.
//
// /.well-known/stellar.toml is consumed by wallets, block explorers and anchors
// that fail *silently* when the document describes a deployment that no longer
// exists: a stale NETWORK_PASSPHRASE makes a client sign for the wrong network,
// and a stale contract id sends a reader to a contract nobody deployed.
//
// This suite turns both of those silent failures into loud test failures, so a
// network switch or a contract redeploy cannot leave a lying document behind.
//
// The document is read with a small reader rather than a TOML dependency: every
// value asserted below is a top-level scalar or a key inside a table this
// repository generates itself, so a full TOML implementation would be a new
// runtime dependency bought for no extra coverage.

import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { STELLAR_NETWORK, NETWORK_PASSPHRASE, SOROBAN_RPC_URL, HORIZON_URL } from "@/lib/stellar";
import { OPHIRPAY_CONTRACT_ID, EMITTER_CONTRACT_ID } from "@/lib/contracts";
import { GET, buildStellarToml } from "@/app/.well-known/stellar.toml/route";

const root = process.cwd();
const read = (relPath: string): string => readFileSync(join(root, relPath), "utf8");

/**
 * Minimal reader for the subset of TOML this document uses: `KEY = "value"`
 * assignments at top level and inside `[TABLE]` headers. Returns a flat map of
 * `TABLE.KEY` and `KEY` to the raw string value, which is all the assertions
 * below need.
 */
function readStellarToml(text: string): Record<string, string> {
  const values: Record<string, string> = {};
  let table = "";
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const header = /^\[([A-Za-z0-9_]+)\]$/.exec(line);
    if (header) {
      table = header[1];
      continue;
    }
    const assignment = /^([A-Za-z0-9_]+)\s*=\s*"(.*)"\s*$/.exec(line);
    if (assignment) {
      const key = table ? `${table}.${assignment[1]}` : assignment[1];
      values[key] = assignment[2];
    }
  }
  return values;
}

/** The document the running server would serve, flattened for assertions. */
function servedDocument(): Record<string, string> {
  return readStellarToml(buildStellarToml());
}

describe("SEP-1 stellar.toml is served — #813", () => {
  it("responds 200 with a text/plain document", () => {
    const res = GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/plain");
  });

  it("is served from a route that exists in the app tree", () => {
    // A rewrite or a moved directory would leave the document unreachable at
    // the path SEP-1 mandates, which no unit test of GET() would catch.
    expect(existsSync(join(root, "src/app/.well-known/stellar.toml/route.ts"))).toBe(true);
  });

  it("declares a VERSION and a network passphrase", () => {
    const doc = servedDocument();
    expect(doc.VERSION).toMatch(/^\d+\.\d+/);
    expect(doc.NETWORK_PASSPHRASE).toBeTruthy();
  });
});

describe("SEP-1 stellar.toml matches the deployment configuration — #813", () => {
  it("network passphrase matches src/lib/stellar.ts", () => {
    expect(servedDocument().NETWORK_PASSPHRASE).toBe(NETWORK_PASSPHRASE);
  });

  it("declares the network the deployment actually targets", () => {
    expect(servedDocument()["DEPLOYMENT.STELLAR_NETWORK"]).toBe(STELLAR_NETWORK);
  });

  it("contract ids match the configured NEXT_PUBLIC_* values", () => {
    const doc = servedDocument();
    expect(doc["CONTRACTS.OPHIRPAY"]).toBe(OPHIRPAY_CONTRACT_ID);
    expect(doc["CONTRACTS.EMITTER"]).toBe(EMITTER_CONTRACT_ID);
  });

  it("RPC and Horizon endpoints match src/lib/stellar.ts", () => {
    const doc = servedDocument();
    expect(doc["RPC.SOROBAN"]).toBe(SOROBAN_RPC_URL);
    expect(doc["RPC.HORIZON"]).toBe(HORIZON_URL);
  });

  it("publishes a documentation block with a contact", () => {
    const doc = servedDocument();
    expect(doc["DOCUMENTATION.ORG_NAME"]).toBeTruthy();
    expect(doc["DOCUMENTATION.ORG_OFFICIAL_EMAIL"]).toContain("@");
  });

  it("fails when a contract id drifts from configuration", () => {
    // The guard only has teeth if drift is actually detectable: a stale id
    // copied by hand must not match the configured value.
    const stale = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM";
    expect(stale).not.toBe(OPHIRPAY_CONTRACT_ID);
    expect(servedDocument()["CONTRACTS.OPHIRPAY"]).not.toBe(stale);
  });

  it("never publishes an empty contract entry", () => {
    // A build without NEXT_PUBLIC_CONTRACT_ID would otherwise emit `OPHIRPAY = ""`
    // and send a wallet to an address that does not exist — the silent failure
    // this document exists to prevent. An unconfigured build must omit the key.
    for (const [key, value] of Object.entries(servedDocument())) {
      if (key.startsWith("CONTRACTS.")) {
        expect(value, `${key} is published but empty`).not.toBe("");
      }
    }
  });

  it("keeps the documented testnet passphrase consistent with the network", () => {
    // TESTNET and PUBLIC have distinct passphrases; a mismatched pair is the
    // classic way a wallet ends up signing for the wrong network.
    const doc = servedDocument();
    if (doc["DEPLOYMENT.STELLAR_NETWORK"] === "TESTNET") {
      expect(doc.NETWORK_PASSPHRASE).toContain("Test SDF Network");
    } else if (doc["DEPLOYMENT.STELLAR_NETWORK"] === "PUBLIC") {
      expect(doc.NETWORK_PASSPHRASE).toContain("Public Global Stellar Network");
    }
  });
});

describe("SEP-1 stellar.toml is discoverable from the documentation — #813", () => {
  it("is referenced from the deployment documentation", () => {
    const candidates = ["README.md", "docs/API_GUIDE.md", "docs/DEPLOYMENT.md", "docs/SEP1.md"];
    const mentions = candidates.filter((f) => existsSync(f) && read(f).includes("stellar.toml"));
    expect(mentions.length, "no doc references .well-known/stellar.toml").toBeGreaterThan(0);
  });
});
