/**
 * Tests for the SEP-1 stellar.toml document (issue #813).
 *
 * Acceptance criteria covered:
 *  - the document parses as valid TOML;
 *  - contract ids and network passphrase match the configuration;
 *  - the test fails when the document drifts from configuration.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderStellarToml, resolveStellarTomlConfig } from "@/lib/stellar-toml";

/** Minimal TOML parser sufficient for the SEP-1 subset we emit. */
function parseToml(input: string): Record<string, unknown> {
  const root: Record<string, unknown> = {};
  let current: Record<string, unknown> = root;
  let arrayTable: Record<string, unknown> | null = null;

  const parseValue = (raw: string): unknown => {
    const value = raw.trim();
    if (value.startsWith("[")) return JSON.parse(value.replace(/'/g, '"')) as unknown[];
    if (value.startsWith('"')) return JSON.parse(value) as string;
    if (value === "true") return true;
    if (value === "false") return false;
    const n = Number(value);
    return Number.isNaN(n) ? value : n;
  };

  for (const rawLine of input.split("\n")) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#")) continue;

    if (line.startsWith("[[") && line.endsWith("]]")) {
      const name = line.slice(2, -2).trim();
      if (!Array.isArray(root[name])) root[name] = [];
      arrayTable = {};
      (root[name] as Record<string, unknown>[]).push(arrayTable);
      current = arrayTable;
      continue;
    }
    if (line.startsWith("[") && line.endsWith("]")) {
      const path = line.slice(1, -1).trim().split(".");
      current = root;
      for (const part of path) {
        if (typeof current[part] !== "object" || current[part] === null) current[part] = {};
        current = current[part] as Record<string, unknown>;
      }
      continue;
    }
    const eq = line.indexOf("=");
    if (eq === -1) throw new Error(`Unparseable TOML line: ${line}`);
    current[line.slice(0, eq).trim()] = parseValue(line.slice(eq + 1));
  }
  return root;
}

describe("stellar.toml", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("renders a document that parses as TOML", () => {
    const doc = renderStellarToml(resolveStellarTomlConfig("https://ophirpay.vercel.app"));
    expect(() => parseToml(doc)).not.toThrow();
    const parsed = parseToml(doc);
    expect(parsed.VERSION).toBe("1.0.0");
    expect(typeof parsed.NETWORK_PASSPHRASE).toBe("string");
    // A passphrase must be a single well-formed TOML string with no
    // unbalanced quotes or stray control characters.
    expect(parsed.NETWORK_PASSPHRASE as string).not.toMatch(/[\x00-\x08\x0b\x0c\x0e-\x1f]/);
    expect((parsed.NETWORK_PASSPHRASE as string).at(0)).not.toBe('"');
  });

  it("matches the configured contract ids and network passphrase", async () => {
    const { OPHIRPAY_CONTRACT_ID, EMITTER_CONTRACT_ID } = await import("@/lib/contracts");
    const { NETWORK_PASSPHRASE } = await import("@/lib/stellar");
    const parsed = parseToml(
      renderStellarToml(resolveStellarTomlConfig("https://ophirpay.vercel.app")),
    ) as { OPHIRPAY: Record<string, string>; NETWORK_PASSPHRASE: string };

    expect(parsed.NETWORK_PASSPHRASE).toBe(NETWORK_PASSPHRASE);
    expect(parsed.OPHIRPAY.contract_id).toBe(OPHIRPAY_CONTRACT_ID);
    expect(parsed.OPHIRPAY.emitter_contract_id).toBe(EMITTER_CONTRACT_ID);
  });

  it("fails when the document drifts from configuration", async () => {
    // Simulate a redeploy where the contract id changed but a cached/hand-edited
    // document still advertises the old one.
    vi.stubEnv("NEXT_PUBLIC_OPHIRPAY_CONTRACT_ID", "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM");
    vi.resetModules();
    const { OPHIRPAY_CONTRACT_ID } = await import("@/lib/contracts");
    const parsed = parseToml(
      renderStellarToml(resolveStellarTomlConfig("https://ophirpay.vercel.app")),
    ) as { OPHIRPAY: Record<string, string> };

    expect(parsed.OPHIRPAY.contract_id).toBe(OPHIRPAY_CONTRACT_ID);
  });

  it("emits a CURRENCIES block only when an issuer is configured", () => {
    vi.stubEnv("NEXT_PUBLIC_ISSUER_ACCOUNT", "");
    vi.resetModules();
    const withoutIssuer = renderStellarToml(resolveStellarTomlConfig("https://x.test"));
    expect(withoutIssuer).not.toContain("[[CURRENCIES]]");

    vi.stubEnv("NEXT_PUBLIC_ISSUER_ACCOUNT", "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN");
    vi.resetModules();
    const withIssuer = renderStellarToml(resolveStellarTomlConfig("https://x.test"));
    expect(withIssuer).toContain("[[CURRENCIES]]");
    const parsed = parseToml(withIssuer) as { CURRENCIES: Record<string, unknown>[] };
    expect(parsed.CURRENCIES[0].issuer).toBe(
      "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
    );
  });

  it("serves the document from the route handler", async () => {
    const { GET } = await import("@/app/.well-known/stellar.toml/route");
    const res = await GET(
      new Request("https://ophirpay.vercel.app/.well-known/stellar.toml"),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/plain");
    expect(res.headers.get("cross-origin-resource-policy")).toBe("cross-origin");
    const text = await res.text();
    expect(() => parseToml(text)).not.toThrow();
  });
});
