// SPDX-License-Identifier: MIT

/**
 * SEP-1 stellar.toml document builder.
 *
 * Generated from environment configuration on every request so contract ids
 * and the network passphrase cannot drift from deployment config (issue
 * #813). Wallets and explorers fetch this at /.well-known/stellar.toml.
 */

export interface StellarTomlEnv {
  networkPassphrase: string;
  paymentContractId: string;
  emitterContractId: string;
  appUrl: string;
}

export const STELLAR_TOML_VERSION = "2.0.0";

export function readStellarTomlEnv(): StellarTomlEnv {
  return {
    networkPassphrase:
      process.env.STELLAR_NETWORK_PASSPHRASE || "Test SDF Network ; September 2015",
    paymentContractId: process.env.NEXT_PUBLIC_CONTRACT_ID || "",
    emitterContractId: process.env.NEXT_PUBLIC_EMITTER_CONTRACT_ID || "",
    appUrl: process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000",
  };
}

function quote(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/** Render the SEP-1 document. Pure function of env — trivially testable. */
export function buildStellarToml(env: StellarTomlEnv): string {
  const lines = [
    `# OphirPay SEP-1 stellar.toml — generated from environment, do not edit by hand.`,
    `VERSION=${quote(STELLAR_TOML_VERSION)}`,
    `NETWORK_PASSPHRASE=${quote(env.networkPassphrase)}`,
    ``,
    `[DOCUMENTATION]`,
    `ORG_NAME=${quote("OphirPay")}`,
    `ORG_URL=${quote(env.appUrl)}`,
    ``,
    `# OphirPay deployment metadata (custom section; wallets ignore unknown sections).`,
    `[CONTRACTS]`,
    `PAYMENT=${quote(env.paymentContractId)}`,
    `EMITTER=${quote(env.emitterContractId)}`,
    ``,
  ];
  return lines.join("\n");
}
