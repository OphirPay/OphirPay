// SPDX-License-Identifier: MIT

/**
 * SEP-1: stellar.toml generation utility for OphirPay.
 *
 * SEP-1 specifies a standardized discovery format for Stellar ecosystem accounts,
 * currencies, signing keys, and smart contracts.
 * @see https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0001.md
 */

export interface StellarTomlOptions {
  network?: string;
  networkPassphrase?: string;
  appUrl?: string;
  contractId?: string;
  emitterContractId?: string;
  signingKey?: string;
}

export function generateStellarToml(opts?: StellarTomlOptions): string {
  const network = opts?.network || process.env.NEXT_PUBLIC_STELLAR_NETWORK || "TESTNET";
  const passphrase =
    opts?.networkPassphrase ||
    process.env.STELLAR_NETWORK_PASSPHRASE ||
    (network === "PUBLIC"
      ? "Public Global Stellar Network ; September 2015"
      : "Test SDF Network ; September 2015");

  const appUrl = (
    opts?.appUrl ||
    process.env.NEXT_PUBLIC_APP_URL ||
    "https://ophirpay.vercel.app"
  ).replace(/\/+$/, "");

  const contractId =
    opts?.contractId ||
    process.env.NEXT_PUBLIC_CONTRACT_ID ||
    "CCQGGUJRRVXMHNEX2RYPODGJE2YRMYY4Y7A3KTJH3QP2LWZLTCOPRPET";

  const emitterId =
    opts?.emitterContractId ||
    process.env.NEXT_PUBLIC_EMITTER_CONTRACT_ID ||
    "CDAVU2XJ7C2Y52GRJZKRG3HDI7AJ2K2FHAFH5FPDTSUQAV7XNBQNNVAN";

  const signingKey =
    opts?.signingKey ||
    process.env.NEXT_PUBLIC_CHAIN_READ_SOURCE ||
    "GACNKEDGJYLLVQDXWYEEPB47Y3JEV5JNZ3RQANTJIVKKEOXX4NC4YWHU";

  const usdcIssuer =
    network === "PUBLIC"
      ? "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN"
      : "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";

  return `# SEP-1: Stellar.toml for OphirPay
# Standard discovery file for Stellar wallets, explorers, and ecosystem tooling.
VERSION="2.0.0"
NETWORK_PASSPHRASE="${passphrase}"
FEDERATION_SERVER="${appUrl}/api/federation"

[DOCUMENTATION]
ORG_NAME="OphirPay"
ORG_URL="${appUrl}"
ORG_DESCRIPTION="Open-source payment orchestration layer for Stellar — smart contracts, webhooks, batch payments, refunds, multisig, governance, and real-time event streaming"
ORG_LOGO="${appUrl}/icon.svg"
ORG_GITHUB="https://github.com/OphirPay/OphirPay"

[PRINCIPALS]
NAME="OphirPay Team"
EMAIL="security@ophirpay.com"

[[CURRENCIES]]
code="USDC"
issuer="${usdcIssuer}"
display_decimals=7
status="live"

[[CURRENCIES]]
code="XLM"
display_decimals=7
status="live"

[ACCOUNTS]
ACCOUNTS=["${signingKey}"]

[CONTRACTS]
PAYMENT_CONTRACT="${contractId}"
EMITTER_CONTRACT="${emitterId}"
`;
}
