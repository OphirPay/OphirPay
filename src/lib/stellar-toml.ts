// SPDX-License-Identifier: MIT

/**
 * SEP-0001 (stellar.toml) generator and validator for OphirPay.
 *
 * Provides structured generation of discovery metadata for Stellar wallets,
 * anchors, and block explorers, dynamically synchronized with environment
 * variables so contract IDs, accounts, and network configuration never drift.
 *
 * Specification: https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0001.md
 */

export interface StellarTomlDocumentation {
  orgName?: string;
  orgDba?: string;
  orgUrl?: string;
  orgLogo?: string;
  orgDescription?: string;
  orgPhysicalAddress?: string;
  orgPhoneNumber?: string;
  orgKeybase?: string;
  orgTwitter?: string;
  orgGithub?: string;
  orgOfficialEmail?: string;
  orgSupportEmail?: string;
}

export interface StellarTomlContract {
  id: string;
  name?: string;
  desc?: string;
}

export interface StellarTomlCurrency {
  code: string;
  issuer?: string;
  displayDecimals?: number;
  name?: string;
  desc?: string;
  status?: string;
}

export interface StellarTomlConfig {
  version: string;
  networkPassphrase?: string;
  horizonUrl?: string;
  signingKey?: string;
  accounts?: string[];
  documentation?: StellarTomlDocumentation;
  contracts?: StellarTomlContract[];
  currencies?: StellarTomlCurrency[];
}

/**
 * Extract Stellar TOML configuration from environment variables.
 */
export function getStellarTomlConfigFromEnv(
  env: Record<string, string | undefined> = process.env
): StellarTomlConfig {
  const isPublic = env.NEXT_PUBLIC_STELLAR_NETWORK === "PUBLIC";

  const networkPassphrase =
    env.STELLAR_NETWORK_PASSPHRASE ||
    (isPublic
      ? "Public Global Stellar Network ; September 2015"
      : "Test SDF Network ; September 2015");

  const horizonUrl =
    env.NEXT_PUBLIC_STELLAR_HORIZON_URL ||
    (isPublic
      ? "https://horizon.stellar.org"
      : "https://horizon-testnet.stellar.org");

  const signingKey = env.STELLAR_TOML_SIGNING_KEY || env.SIGNING_KEY || undefined;

  let accounts: string[] = [];
  if (env.STELLAR_TOML_ACCOUNTS) {
    try {
      if (env.STELLAR_TOML_ACCOUNTS.trim().startsWith("[")) {
        accounts = JSON.parse(env.STELLAR_TOML_ACCOUNTS);
      } else {
        accounts = env.STELLAR_TOML_ACCOUNTS.split(",")
          .map((s) => s.trim())
          .filter(Boolean);
      }
    } catch {
      accounts = env.STELLAR_TOML_ACCOUNTS.split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    }
  }

  const contracts: StellarTomlContract[] = [];
  if (env.NEXT_PUBLIC_CONTRACT_ID) {
    contracts.push({
      id: env.NEXT_PUBLIC_CONTRACT_ID,
      name: "OphirPay Core",
      desc: "Core payment routing and settlement contract",
    });
  }
  if (env.NEXT_PUBLIC_EMITTER_CONTRACT_ID) {
    contracts.push({
      id: env.NEXT_PUBLIC_EMITTER_CONTRACT_ID,
      name: "OphirPay Emitter",
      desc: "Lifecycle event emission contract",
    });
  }

  let currencies: StellarTomlCurrency[] = [];
  if (env.STELLAR_TOML_CURRENCIES) {
    try {
      currencies = JSON.parse(env.STELLAR_TOML_CURRENCIES);
    } catch {
      currencies = [];
    }
  }

  const documentation: StellarTomlDocumentation = {
    orgName: env.STELLAR_TOML_ORG_NAME || "OphirPay",
    orgUrl: env.STELLAR_TOML_ORG_URL || env.NEXT_PUBLIC_APP_URL || "https://ophirpay.com",
    orgDescription:
      env.STELLAR_TOML_ORG_DESCRIPTION ||
      "Payment orchestration and settlement on the Stellar network.",
    orgGithub: env.STELLAR_TOML_ORG_GITHUB || "https://github.com/OphirPay/OphirPay",
    orgOfficialEmail: env.STELLAR_TOML_ORG_EMAIL || "support@ophirpay.com",
    orgSupportEmail: env.STELLAR_TOML_SUPPORT_EMAIL || "support@ophirpay.com",
  };

  return {
    version: "2.0.0",
    networkPassphrase,
    horizonUrl,
    signingKey,
    accounts: accounts.length > 0 ? accounts : undefined,
    documentation,
    contracts: contracts.length > 0 ? contracts : undefined,
    currencies: currencies.length > 0 ? currencies : undefined,
  };
}

function escapeTomlString(str: string): string {
  return JSON.stringify(str);
}

/**
 * Serialize a StellarTomlConfig object into RFC-compliant TOML syntax.
 */
export function serializeStellarToml(config: StellarTomlConfig): string {
  const lines: string[] = [
    "# Stellar Ecosystem Proposal 0001 (SEP-1) — stellar.toml",
    "# OphirPay Deployment Discovery Metadata",
    "",
  ];

  // General Information
  lines.push(`VERSION = ${escapeTomlString(config.version || "2.0.0")}`);
  if (config.networkPassphrase) {
    lines.push(`NETWORK_PASSPHRASE = ${escapeTomlString(config.networkPassphrase)}`);
  }
  if (config.horizonUrl) {
    lines.push(`HORIZON_URL = ${escapeTomlString(config.horizonUrl)}`);
  }
  if (config.signingKey) {
    lines.push(`SIGNING_KEY = ${escapeTomlString(config.signingKey)}`);
  }
  if (config.accounts && config.accounts.length > 0) {
    const formattedAccounts = config.accounts.map((acc) => escapeTomlString(acc)).join(", ");
    lines.push(`ACCOUNTS = [${formattedAccounts}]`);
  }

  // [DOCUMENTATION]
  if (config.documentation) {
    lines.push("");
    lines.push("[DOCUMENTATION]");
    const doc = config.documentation;
    if (doc.orgName) lines.push(`ORG_NAME = ${escapeTomlString(doc.orgName)}`);
    if (doc.orgDba) lines.push(`ORG_DBA = ${escapeTomlString(doc.orgDba)}`);
    if (doc.orgUrl) lines.push(`ORG_URL = ${escapeTomlString(doc.orgUrl)}`);
    if (doc.orgLogo) lines.push(`ORG_LOGO = ${escapeTomlString(doc.orgLogo)}`);
    if (doc.orgDescription) lines.push(`ORG_DESCRIPTION = ${escapeTomlString(doc.orgDescription)}`);
    if (doc.orgPhysicalAddress) lines.push(`ORG_PHYSICAL_ADDRESS = ${escapeTomlString(doc.orgPhysicalAddress)}`);
    if (doc.orgPhoneNumber) lines.push(`ORG_PHONE_NUMBER = ${escapeTomlString(doc.orgPhoneNumber)}`);
    if (doc.orgKeybase) lines.push(`ORG_KEYBASE = ${escapeTomlString(doc.orgKeybase)}`);
    if (doc.orgTwitter) lines.push(`ORG_TWITTER = ${escapeTomlString(doc.orgTwitter)}`);
    if (doc.orgGithub) lines.push(`ORG_GITHUB = ${escapeTomlString(doc.orgGithub)}`);
    if (doc.orgOfficialEmail) lines.push(`ORG_OFFICIAL_EMAIL = ${escapeTomlString(doc.orgOfficialEmail)}`);
    if (doc.orgSupportEmail) lines.push(`ORG_SUPPORT_EMAIL = ${escapeTomlString(doc.orgSupportEmail)}`);
  }

  // [[CONTRACTS]]
  if (config.contracts && config.contracts.length > 0) {
    for (const contract of config.contracts) {
      lines.push("");
      lines.push("[[CONTRACTS]]");
      lines.push(`ID = ${escapeTomlString(contract.id)}`);
      if (contract.name) lines.push(`NAME = ${escapeTomlString(contract.name)}`);
      if (contract.desc) lines.push(`DESC = ${escapeTomlString(contract.desc)}`);
    }
  }

  // [[CURRENCIES]]
  if (config.currencies && config.currencies.length > 0) {
    for (const currency of config.currencies) {
      lines.push("");
      lines.push("[[CURRENCIES]]");
      lines.push(`code = ${escapeTomlString(currency.code)}`);
      if (currency.issuer) lines.push(`issuer = ${escapeTomlString(currency.issuer)}`);
      if (currency.displayDecimals !== undefined) {
        lines.push(`display_decimals = ${currency.displayDecimals}`);
      }
      if (currency.name) lines.push(`name = ${escapeTomlString(currency.name)}`);
      if (currency.desc) lines.push(`desc = ${escapeTomlString(currency.desc)}`);
      if (currency.status) lines.push(`status = ${escapeTomlString(currency.status)}`);
    }
  }

  lines.push("");
  return lines.join("\n");
}

/**
 * Generate a complete stellar.toml content directly from process.env or overrides.
 */
export function buildStellarToml(env: Record<string, string | undefined> = process.env): string {
  const config = getStellarTomlConfigFromEnv(env);
  return serializeStellarToml(config);
}

export interface ParsedStellarToml {
  VERSION?: string;
  NETWORK_PASSPHRASE?: string;
  HORIZON_URL?: string;
  SIGNING_KEY?: string;
  ACCOUNTS?: string[];
  DOCUMENTATION?: Record<string, string>;
  CONTRACTS?: Array<{ ID?: string; NAME?: string; DESC?: string }>;
  CURRENCIES?: Array<{
    code?: string;
    issuer?: string;
    display_decimals?: number;
    name?: string;
    desc?: string;
    status?: string;
  }>;
  [key: string]: unknown;
}

/**
 * Simple parser to validate and inspect basic TOML structures (keys, sections, table arrays).
 */
export function parseStellarToml(content: string): ParsedStellarToml {
  const result: ParsedStellarToml = {};
  let currentSection: string | null = null;
  let currentArrayTable: string | null = null;

  const lines = content.split("\n");
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    // Array of tables [[NAME]]
    const arrayMatch = line.match(/^\[\[([A-Za-z0-9_]+)\]\]$/);
    if (arrayMatch) {
      currentArrayTable = arrayMatch[1];
      currentSection = null;
      if (!Array.isArray(result[currentArrayTable])) {
        result[currentArrayTable] = [];
      }
      (result[currentArrayTable] as Array<Record<string, unknown>>).push({});
      continue;
    }

    // Single table [NAME]
    const tableMatch = line.match(/^\[([A-Za-z0-9_]+)\]$/);
    if (tableMatch) {
      currentSection = tableMatch[1];
      currentArrayTable = null;
      if (!result[currentSection]) {
        result[currentSection] = {};
      }
      continue;
    }

    // Key-value pair: KEY = VALUE
    const kvMatch = line.match(/^([A-Za-z0-9_]+)\s*=\s*(.+)$/);
    if (kvMatch) {
      const key = kvMatch[1];
      const rawVal = kvMatch[2].trim();
      let parsedVal: unknown;

      if (rawVal.startsWith('"') && rawVal.endsWith('"')) {
        try {
          parsedVal = JSON.parse(rawVal);
        } catch {
          parsedVal = rawVal.slice(1, -1);
        }
      } else if (rawVal.startsWith("[") && rawVal.endsWith("]")) {
        try {
          parsedVal = JSON.parse(rawVal);
        } catch {
          parsedVal = rawVal
            .slice(1, -1)
            .split(",")
            .map((s) => s.trim().replace(/^"(.*)"$/, "$1"));
        }
      } else if (!isNaN(Number(rawVal))) {
        parsedVal = Number(rawVal);
      } else if (rawVal === "true") {
        parsedVal = true;
      } else if (rawVal === "false") {
        parsedVal = false;
      } else {
        parsedVal = rawVal;
      }

      if (currentArrayTable) {
        const arr = result[currentArrayTable] as Array<Record<string, unknown>>;
        arr[arr.length - 1][key] = parsedVal;
      } else if (currentSection) {
        const sec = result[currentSection] as Record<string, unknown>;
        sec[key] = parsedVal;
      } else {
        result[key] = parsedVal;
      }
    }
  }

  return result;
}
