// SPDX-License-Identifier: MIT
//
// SEP-1 stellar.toml — served from configuration so contract ids and the
// network passphrase cannot drift from the deployment they describe.
//
// Wallets, block explorers and anchors fetch /.well-known/stellar.toml to
// discover an issuing account, its currencies, its signing keys and its
// documentation. Before this route the deployment shipped only
// .well-known/security.txt, so ecosystem tooling had no machine-readable way
// to resolve an asset issued here.
//
// The values are generated from the same source of truth the application uses
// (src/lib/stellar.ts and src/lib/contracts.ts) rather than hand-copied, so a
// network switch or a contract redeploy updates the document automatically.
// src/__tests__/config-drift.test.ts fails loudly if the served document drifts.

import { STELLAR_NETWORK, NETWORK_PASSPHRASE, SOROBAN_RPC_URL, HORIZON_URL } from "@/lib/stellar";
import { OPHIRPAY_CONTRACT_ID, EMITTER_CONTRACT_ID } from "@/lib/contracts";

export const dynamic = "force-static";
export const revalidate = 3600;

/** SEP-1 requires a UTF-8 TOML document served as text/plain. */
function tomlString(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/**
 * Build the SEP-1 document.
 *
 * Contract ids are emitted only when they are actually configured. A build that
 * has no `NEXT_PUBLIC_CONTRACT_ID` would otherwise publish `OPHIRPAY = ""` and
 * send a wallet or explorer to an address that does not exist — the exact
 * silent failure this document is supposed to prevent. Omitting the entry
 * leaves the reader with no contract to resolve rather than a wrong one.
 */
function buildStellarToml(): string {
  const contractLines: string[] = [];
  if (OPHIRPAY_CONTRACT_ID) contractLines.push("OPHIRPAY = " + tomlString(OPHIRPAY_CONTRACT_ID));
  if (EMITTER_CONTRACT_ID) contractLines.push("EMITTER = " + tomlString(EMITTER_CONTRACT_ID));

  const lines: string[] = [
    "# OphirPay SEP-1 stellar.toml",
    "#",
    "# Generated from the deployment configuration: the contract ids and the",
    "# network passphrase below are read from the same source the application",
    "# uses, so this document cannot drift from what is actually deployed.",
    "#",
    "# See: https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0001.md",
    "",
    "VERSION = " + tomlString("2.0.0"),
    "NETWORK_PASSPHRASE = " + tomlString(NETWORK_PASSPHRASE),
    "",
    "# The application is reachable over HTTPS; wallets may open this origin.",
    "WEB_AUTH_ENDPOINT = " + tomlString("https://ophirpay.vercel.app/api/auth"),
    "",
    "[DOCUMENTATION]",
    "ORG_NAME = " + tomlString("OphirPay"),
    "ORG_URL = " + tomlString("https://github.com/OphirPay/OphirPay"),
    "ORG_LOGO = " + tomlString("https://ophirpay.vercel.app/ophirpay-banner.svg"),
    "ORG_DESCRIPTION = " + tomlString("Open-source payment orchestration layer for Stellar"),
    "ORG_OFFICIAL_EMAIL = " + tomlString("security@ophirpay.com"),
    "",
    "# The payment and emitter Soroban contracts this deployment targets, so an",
    "# explorer can tie a transaction back to the exact deployed code. An entry",
    "# appears only when the corresponding NEXT_PUBLIC_* value is configured.",
  ];
  if (contractLines.length > 0) {
    lines.push("[CONTRACTS]", ...contractLines, "");
  }
  lines.push(
    "[RPC]",
    "SOROBAN = " + tomlString(SOROBAN_RPC_URL),
    "HORIZON = " + tomlString(HORIZON_URL),
    "",
    "[DEPLOYMENT]",
    "STELLAR_NETWORK = " + tomlString(STELLAR_NETWORK),
    "",
  );
  return lines.join("\n");
}

export function GET(): Response {
  return new Response(buildStellarToml(), {
    status: 200,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
}

export { buildStellarToml };
