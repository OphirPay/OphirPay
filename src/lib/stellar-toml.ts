/**
 * SEP-1 `stellar.toml` generation (issue #813).
 *
 * The file is *generated* from the same configuration that the running app
 * uses, so the contract ids, network passphrase and issuer accounts cannot
 * silently drift from `NEXT_PUBLIC_*` / server configuration. A static file
 * checked into `public/` would rot the moment the contract is redeployed.
 *
 * Spec: https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0001.md
 */
import { NETWORK_PASSPHRASE, STELLAR_NETWORK } from "@/lib/stellar";
import { OPHIRPAY_CONTRACT_ID, EMITTER_CONTRACT_ID } from "@/lib/contracts";

/** Escape a value for a TOML basic (double-quoted) string. */
function tomlString(value: string): string {
  const escaped = value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t");
  return `"${escaped}"`;
}

/** Render a TOML array of strings on a single line. */
function tomlStringArray(values: string[]): string {
  return `[${values.map(tomlString).join(", ")}]`;
}

export interface StellarTomlConfig {
  /** Canonical public origin, no trailing slash. */
  origin: string;
  networkPassphrase: string;
  /** SEP-1 network identifier: PUBLIC | TESTNET | FUTURENET. */
  network: string;
  ophirPayContractId: string;
  emitterContractId: string;
  /** Optional asset issuer (G... account). Omitted when not configured. */
  issuer?: string;
  /** Optional asset code issued by `issuer`. Defaults to OPHIR. */
  assetCode?: string;
  /** Display decimals for the issued asset. Defaults to 7. */
  assetDecimals?: number;
  /** Support/contact e-mail advertised in DOCUMENTATION. */
  supportEmail?: string;
  /** SECURITY.md URL used for the SECURITY section. */
  securityPolicyUrl?: string;
}

/**
 * Resolve the SEP-1 document configuration from the environment.
 *
 * Every value that matters is already part of the app configuration; this
 * function is the single place that maps environment variable names onto the
 * SEP-1 fields. `origin` is passed in because it is request-dependent in the
 * route handler.
 */
export function resolveStellarTomlConfig(origin: string): StellarTomlConfig {
  const issuer = process.env.NEXT_PUBLIC_ISSUER_ACCOUNT?.trim();

  return {
    origin: origin.replace(/\/+$/, ""),
    networkPassphrase: NETWORK_PASSPHRASE,
    network: STELLAR_NETWORK,
    ophirPayContractId: OPHIRPAY_CONTRACT_ID,
    emitterContractId: EMITTER_CONTRACT_ID,
    issuer: issuer && issuer.length > 0 ? issuer : undefined,
    assetCode: process.env.NEXT_PUBLIC_ASSET_CODE?.trim() || "OPHIR",
    assetDecimals: Number(process.env.NEXT_PUBLIC_ASSET_DECIMALS ?? "7"),
    supportEmail: process.env.NEXT_PUBLIC_SUPPORT_EMAIL?.trim() || "security@ophirpay.com",
    securityPolicyUrl:
      process.env.NEXT_PUBLIC_SECURITY_POLICY_URL?.trim() ||
      "https://github.com/OphirPay/OphirPay/blob/main/SECURITY.md",
  };
}

/**
 * Render the SEP-1 `stellar.toml` document.
 *
 * Only sections that have values are emitted — an empty `[[CURRENCIES]]`
 * block is invalid as far as integrators are concerned, and SEP-1 requires
 * `VERSION` and `NETWORK_PASSPHRASE` only.
 */
export function renderStellarToml(config: StellarTomlConfig): string {
  const lines: string[] = [];

  lines.push("# SEP-1 stellar.toml — generated at request time by src/app/.well-known/stellar.toml/route.ts");
  lines.push("# Values are derived from the running configuration; do not edit by hand.");
  lines.push("");
  lines.push(`VERSION = ${tomlString("1.0.0")}`);
  // SEP-1 network identifiers: PUBLIC for mainnet, TESTNET otherwise. A custom
  // passphrase (local/standalone) is still advertised verbatim below.
  lines.push(`NETWORK_PASSPHRASE = ${tomlString(config.networkPassphrase)}`);
  lines.push(`NETWORK = ${tomlString(config.network === "PUBLIC" ? "PUBLIC" : "TESTNET")}`);
  lines.push("");

  lines.push("[DOCUMENTATION]");
  lines.push(`ORG_NAME = ${tomlString("OphirPay")}`);
  lines.push(`ORG_URL = ${tomlString(config.origin)}`);
  lines.push(`ORG_SUPPORT_EMAIL = ${tomlString(config.supportEmail as string)}`);
  lines.push("");
  lines.push("[DOCUMENTATION.DESCRIPTION]");
  lines.push("OphirPay is a Stellar payment, batch-payout and Soroban contract toolkit.");
  lines.push("");

  lines.push("[SECURITY]");
  lines.push(`POLICY = ${tomlString(config.securityPolicyUrl as string)}`);
  lines.push("");

  if (config.issuer) {
    const code = config.assetCode || "OPHIR";
    const decimals = Number.isFinite(config.assetDecimals) ? Number(config.assetDecimals) : 7;
    lines.push("[[CURRENCIES]]");
    lines.push(`code = ${tomlString(code)}`);
    lines.push(`issuer = ${tomlString(config.issuer)}`);
    lines.push(`display_decimals = ${decimals}`);
    lines.push(`name = ${tomlString("OphirPay")}`);
    lines.push(`desc = ${tomlString("Asset issued by the OphirPay deployment.")}`);
    // Anchor/USDC-style assets are not used here; this is a credit asset.
    lines.push(`is_asset_anchored = false`);
    lines.push(`anchor_asset_type = ${tomlString("crypto")}`);
    lines.push("");
  }

  // Soroban contract ids. These are not part of SEP-1 proper, so they live in
  // a namespaced section that integrators can read without confusing a
  // SEP-1-only parser.
  lines.push("[OPHIRPAY]");
  lines.push(`contract_id = ${tomlString(config.ophirPayContractId)}`);
  lines.push(`emitter_contract_id = ${tomlString(config.emitterContractId)}`);
  lines.push(`accounts = ${tomlStringArray([])}`);
  lines.push("");

  return lines.join("\n");
}
