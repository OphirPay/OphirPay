// SPDX-License-Identifier: MIT

/**
 * SEP-1 (stellar.toml) generator.
 *
 * SEP-1 defines a standard configuration file format for Stellar domains:
 * https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0007.md
 * https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0001.md
 *
 * Wallets, block explorers, and anchors fetch /.well-known/stellar.toml to discover
 * network configurations, contract addresses, currencies, and organization metadata.
 */

export interface StellarTomlOptions {
  networkPassphrase?: string;
  horizonUrl?: string;
  rpcUrl?: string;
  contractId?: string;
  emitterContractId?: string;
  appUrl?: string;
  network?: "TESTNET" | "PUBLIC";
}

/**
 * Generates a valid SEP-1 compliant stellar.toml string dynamically from configuration.
 */
export function generateStellarToml(options: StellarTomlOptions = {}): string {
  const networkPassphrase =
    options.networkPassphrase ||
    process.env.STELLAR_NETWORK_PASSPHRASE ||
    "Test SDF Network ; September 2015";

  const horizonUrl =
    options.horizonUrl ||
    process.env.NEXT_PUBLIC_STELLAR_HORIZON_URL ||
    "https://horizon-testnet.stellar.org";

  const rpcUrl =
    options.rpcUrl ||
    process.env.NEXT_PUBLIC_STELLAR_RPC_URL ||
    "https://soroban-testnet.stellar.org:443";

  const contractId =
    options.contractId ||
    process.env.NEXT_PUBLIC_CONTRACT_ID ||
    "CCQGGUJRRVXMHNEX2RYPODGJE2YRMYY4Y7A3KTJH3QP2LWZLTCOPRPET";

  const emitterContractId =
    options.emitterContractId ||
    process.env.NEXT_PUBLIC_EMITTER_CONTRACT_ID ||
    "CDAVU2XJ7C2Y52GRJZKRG3HDI7AJ2K2FHAFH5FPDTSUQAV7XNBQNNVAN";

  const appUrl =
    options.appUrl ||
    process.env.NEXT_PUBLIC_APP_URL ||
    "https://ophirpay.vercel.app";

  const accounts = [contractId, emitterContractId].filter(Boolean);

  const lines: string[] = [
    `# OphirPay SEP-1 stellar.toml configuration`,
    `# Specification: https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0001.md`,
    ``,
    `VERSION = "2.0.0"`,
    `NETWORK_PASSPHRASE = ${JSON.stringify(networkPassphrase)}`,
    `HORIZON_URL = ${JSON.stringify(horizonUrl)}`,
    `RPC_SERVER = ${JSON.stringify(rpcUrl)}`,
    `ACCOUNTS = [${accounts.map((a) => JSON.stringify(a)).join(", ")}]`,
    ``,
    `[DOCUMENTATION]`,
    `ORG_NAME = "OphirPay"`,
    `ORG_URL = ${JSON.stringify(appUrl)}`,
    `ORG_DESCRIPTION = "Non-custodial payment gateway on Stellar and Soroban"`,
    `ORG_GITHUB = "https://github.com/OphirPay/OphirPay"`,
    `ORG_OFFICIAL_EMAIL = "security@ophirpay.com"`,
    ``,
    `[PRINCIPALS]`,
    `name = "OphirPay Security"`,
    `email = "security@ophirpay.com"`,
    ``,
    `[[CURRENCIES]]`,
    `code = "XLM"`,
    `is_asset_native = true`,
    `desc = "Stellar Lumens native asset"`,
    `display_decimals = 7`,
    ``,
    `[CONTRACTS]`,
    `OPHIRPAY_CONTRACT_ID = ${JSON.stringify(contractId)}`,
    `EMITTER_CONTRACT_ID = ${JSON.stringify(emitterContractId)}`,
    ``,
  ];

  return lines.join("\n");
}
