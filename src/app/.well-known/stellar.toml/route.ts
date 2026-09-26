// SPDX-License-Identifier: MIT

import { NETWORK_PASSPHRASE, SOROBAN_RPC_URL, HORIZON_URL, STELLAR_NETWORK } from "@/lib/stellar";
import { DEFAULT_CONTRACT_ID, EMITTER_CONTRACT_ID } from "@/lib/contracts";
import { USDC_MAINNET, USDC_TESTNET } from "@/lib/assets";

export const dynamic = "force-dynamic";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function tomlString(value: string): string {
  return JSON.stringify(value);
}

export function generateStellarToml(): string {
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL || "https://ophirpay.vercel.app").replace(/\/$/, "");
  const usdc = STELLAR_NETWORK === "PUBLIC" ? USDC_MAINNET : USDC_TESTNET;
  const accounts = [usdc.issuer].filter((account): account is string => Boolean(account));
  const lines = [
    "VERSION = \"2.0.0\"",
    `NETWORK_PASSPHRASE = ${tomlString(NETWORK_PASSPHRASE)}`,
    `HORIZON_URL = ${tomlString(HORIZON_URL)}`,
    `ACCOUNTS = [${accounts.map(tomlString).join(", ")}]`,
    `DOCUMENTATION = ${tomlString("https://github.com/OphirPay/OphirPay/blob/main/docs/DEPLOYMENT.md")}`,
    `SECURITY = ${tomlString(`${appUrl}/.well-known/security.txt`)}`,
    `ORG_NAME = ${tomlString("OphirPay")}`,
    `ORG_URL = ${tomlString(appUrl)}`,
    `ORG_DESCRIPTION = ${tomlString("Open-source payment orchestration on Stellar")}`,
    `OPHIRPAY_CONTRACT_ID = ${tomlString(DEFAULT_CONTRACT_ID)}`,
    `EMITTER_CONTRACT_ID = ${tomlString(EMITTER_CONTRACT_ID)}`,
    "",
    "[SOROBAN_RPC]",
    `URL = ${tomlString(SOROBAN_RPC_URL)}`,
    `NETWORK_PASSPHRASE = ${tomlString(NETWORK_PASSPHRASE)}`,
    "",
    "[[CURRENCIES]]",
    `code = ${tomlString(usdc.code)}`,
    `issuer = ${tomlString(usdc.issuer ?? "")}`,
    `display_decimals = ${usdc.decimals}`,
    `name = ${tomlString(usdc.displayName)}`,
    "",
  ];
  return lines.join("\n");
}

function response(): Response {
  return new Response(generateStellarToml(), {
    headers: {
      ...CORS_HEADERS,
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=300, stale-while-revalidate=3600",
    },
  });
}

export function GET(): Response {
  return response();
}

export function HEAD(): Response {
  return new Response(null, { headers: response().headers });
}

export function OPTIONS(): Response {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}