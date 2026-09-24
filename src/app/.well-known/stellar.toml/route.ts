// SPDX-License-Identifier: MIT
// SEP-0001 stellar.toml Route Handler
// Serves configuration for wallet discovery, block explorers, and anchor resolution.

import { NextResponse } from "next/server";

export function generateStellarToml(): string {
  const version = "2.0.0";
  const networkPassphrase =
    process.env.STELLAR_NETWORK_PASSPHRASE ||
    "Test SDF Network ; September 2015";
  const horizonUrl =
    process.env.NEXT_PUBLIC_STELLAR_HORIZON_URL ||
    "https://horizon-testnet.stellar.org";
  const appUrl =
    process.env.NEXT_PUBLIC_APP_URL || "https://ophirpay.vercel.app";
  const contractId =
    process.env.NEXT_PUBLIC_CONTRACT_ID ||
    "CCQGGUJRRVXMHNEX2RYPODGJE2YRMYY4Y7A3KTJH3QP2LWZLTCOPRPET";
  const emitterId =
    process.env.NEXT_PUBLIC_EMITTER_CONTRACT_ID ||
    "CDAVU2XJ7C2Y52GRJZKRG3HDI7AJ2K2FHAFH5FPDTSUQAV7XNBQNNVAN";

  return `# Stellar.toml (SEP-1)
VERSION="${version}"
NETWORK_PASSPHRASE="${networkPassphrase}"
URI_REQUEST_SIGNING_KEY=""

# Network Endpoints
HORIZON_URL="${horizonUrl}"

[DOCUMENTATION]
ORG_NAME="OphirPay"
ORG_URL="${appUrl}"
ORG_DESCRIPTION="Open-source payment orchestration layer for Stellar"
ORG_GITHUB="https://github.com/OphirPay/OphirPay"
ORG_OFFICIAL_EMAIL="support@ophirpay.com"

[CONTRACTS]
OPHIRPAY="${contractId}"
EMITTER="${emitterId}"

[[CURRENCIES]]
code="USDC"
issuer="GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5"
display_decimals=7
`;
}

export async function GET() {
  const content = generateStellarToml();

  return new NextResponse(content, {
    status: 200,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Cache-Control": "public, max-age=3600, s-maxage=3600",
    },
  });
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}
