// SPDX-License-Identifier: MIT
//
// SEP-1 `stellar.toml` document builder — issue #813.
//
// The document is generated from the same configuration the app already uses at
// runtime (`src/lib/stellar.ts`, `src/lib/contracts.ts`) instead of being a
// hand-maintained file. A hand-maintained file drifts silently: the network is
// switched for a deploy, the TOML still advertises the old passphrase, and
// wallets/countersigners keep resolving against the wrong network with no error
// anywhere. Generating it means the drift is impossible by construction, and
// `src/__tests__/stellar-toml.test.ts` turns any remaining divergence into a
// loud failure.

import { NETWORK_PASSPHRASE, STELLAR_NETWORK, HORIZON_URL } from "@/lib/stellar";
import { OPHIRPAY_CONTRACT_ID, EMITTER_CONTRACT_ID } from "@/lib/contracts";

/** Passphrase a given network MUST use, per SEP-1 / Stellar core. */
export const EXPECTED_PASSPHRASE: Record<"TESTNET" | "PUBLIC", string> = {
  TESTNET: "Test SDF Network ; September 2015",
  PUBLIC: "Public Global Stellar Network ; September 2015",
};

export interface StellarTomlInput {
  appUrl?: string;
  network?: "TESTNET" | "PUBLIC";
  networkPassphrase?: string;
  horizonUrl?: string;
  contractId?: string;
  emitterContractId?: string;
  accounts?: string[];
}

function appUrl(): string {
  const raw = process.env.NEXT_PUBLIC_APP_URL ?? "https://ophirpay.vercel.app";
  return raw.replace(/\/+$/, "");
}

/** Escape a value for a TOML basic string (SEP-1 uses basic strings). */
function tomlString(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/**
 * Build the SEP-1 document.
 *
 * Only keys we can actually substantiate are emitted — SEP-1 validators reject
 * documents that advertise capabilities the service does not have, and an
 * empty/placeholder value is worse than an absent key.
 */
export function buildStellarToml(input: StellarTomlInput = {}): string {
  const network = input.network ?? STELLAR_NETWORK;
  const passphrase = input.networkPassphrase ?? NETWORK_PASSPHRASE;
  const horizon = input.horizonUrl ?? HORIZON_URL;
  const contractId = input.contractId ?? OPHIRPAY_CONTRACT_ID;
  const emitterContractId = input.emitterContractId ?? EMITTER_CONTRACT_ID;
  const accounts = input.accounts ?? [];
  const base = input.appUrl?.replace(/\/+$/, "") ?? appUrl();

  const lines: string[] = [
    "# OphirPay SEP-1 stellar.toml",
    "#",
    "# Generated from application configuration — do not hand-edit values here.",
    "# Canonical source: src/lib/stellar-toml.ts (served at /.well-known/stellar.toml).",
    "",
    'VERSION = "1.0.0"',
    "",
    `NETWORK_PASSPHRASE = ${tomlString(passphrase)}`,
    "",
  ];

  if (accounts.length > 0) {
    lines.push("ACCOUNTS = [" + accounts.map(tomlString).join(", ") + "]", "");
  }

  lines.push(
    "[DOCUMENTATION]",
    `ORG_NAME = "OphirPay"`,
    `ORG_URL = ${tomlString(base)}`,
    `ORG_OFFICIAL_EMAIL = "security@ophirpay.com"`,
    `ORG_SUPPORT_EMAIL = "security@ophirpay.com"`,
    ""
  );

  lines.push(
    "[PRINCIPALS]",
    `name = "OphirPay"`,
    `url = ${tomlString(base)}`,
    ""
  );

  // SEP-1 has no first-class contract key yet; the Soroban ids are published in
  // the conventional `[CONTRACTS]` table so integrators can discover them from
  // the well-known location rather than scraping the app.
  lines.push(
    "[CONTRACTS]",
    `NETWORK = ${tomlString(network)}`,
    `HORIZON_URL = ${tomlString(horizon)}`,
    `OPHIRPAY_CONTRACT_ID = ${tomlString(contractId)}`,
    `EMITTER_CONTRACT_ID = ${tomlString(emitterContractId)}`,
    ""
  );

  return lines.join("\n");
}

/** Machine-readable view of what the document advertises (test/drift helper). */
export function stellarTomlFacts() {
  return {
    network: STELLAR_NETWORK,
    networkPassphrase: NETWORK_PASSPHRASE,
    expectedPassphrase: EXPECTED_PASSPHRASE[STELLAR_NETWORK],
    horizonUrl: HORIZON_URL,
    contractId: OPHIRPAY_CONTRACT_ID,
    emitterContractId: EMITTER_CONTRACT_ID,
  };
}
