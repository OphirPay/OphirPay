// SPDX-License-Identifier: MIT

/**
 * Multi-asset support for Stellar payments beyond native XLM.
 * Includes USDC on Stellar, custom token validation helpers, and
 * SEP-1 asset metadata discovery with TTL caching and safety limits.
 */

import { HORIZON_URL } from "@/lib/stellar";
import { isSafeWebhookUrl } from "@/lib/webhook-url-guard";

export interface AssetInfo {
  code: string;
  issuer?: string;
  type: "native" | "credit_alphanum4" | "credit_alphanum12";
  displayName: string;
  decimals: number;
  domain?: string;
  orgName?: string;
  desc?: string;
}

// ── Known Assets ───────────────────────────────────────────────

/** Stellar USDC (Centre Consortium) — Testnet & Mainnet */
export const USDC_TESTNET: AssetInfo = {
  code: "USDC",
  issuer: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
  type: "credit_alphanum4",
  displayName: "USDC (Testnet)",
  decimals: 7,
  domain: "centre.io",
  orgName: "Centre Consortium",
};

export const USDC_MAINNET: AssetInfo = {
  code: "USDC",
  issuer: "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
  type: "credit_alphanum4",
  displayName: "USDC",
  decimals: 7,
  domain: "centre.io",
  orgName: "Centre Consortium",
};

/** Native XLM */
export const XLM_ASSET: AssetInfo = {
  code: "XLM",
  type: "native",
  displayName: "Stellar Lumens",
  decimals: 7,
};

// ── Helpers ────────────────────────────────────────────────────

/** Get the known asset info for a given asset code (defaults to XLM). */
export function getAssetInfo(code: string): AssetInfo {
  const upper = code.toUpperCase();
  if (upper === "USDC") return USDC_TESTNET;
  if (upper === "XLM") return XLM_ASSET;
  return { code: upper, type: "credit_alphanum4", displayName: upper, decimals: 7 };
}

/** Format a stroop amount based on asset decimals. */
export function formatAssetAmount(stroops: number, asset: AssetInfo): string {
  const divisor = Math.pow(10, asset.decimals);
  return (stroops / divisor).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: asset.decimals,
  });
}

/** Validate an asset issuer address (must be a valid Stellar account). */
export function isValidAssetIssuer(address: string): boolean {
  return /^G[A-Z0-9]{55}$/.test(address);
}

// ── SEP-1 Asset Metadata Resolution ────────────────────────────

export const METADATA_FETCH_TIMEOUT_MS = 5_000; // 5 seconds
export const MAX_TOML_SIZE_BYTES = 100 * 1024; // 100 KB
export const DOMAIN_CACHE_TTL_MS = 300_000; // 5 minutes

export interface Sep1Currency {
  code: string;
  issuer?: string;
  name?: string;
  desc?: string;
  org_name?: string;
  image?: string;
  display_decimals?: number;
  [key: string]: unknown;
}

export interface Sep1TomlData {
  DOCUMENTATION?: {
    ORG_NAME?: string;
    ORG_URL?: string;
    ORG_LOGO?: string;
    ORG_DESCRIPTION?: string;
    [key: string]: unknown;
  };
  CURRENCIES?: Sep1Currency[];
  [key: string]: unknown;
}

export interface CachedDomainMetadata {
  domain: string;
  currencies: Sep1Currency[];
  orgName?: string;
  fetchedAt: number;
}

export interface ResolvedAssetMetadata {
  code: string;
  issuer?: string;
  type: "native" | "credit_alphanum4" | "credit_alphanum12";
  displayName: string;
  name?: string;
  orgName?: string;
  desc?: string;
  domain?: string;
  displayDecimals?: number;
  resolved: boolean;
}

export interface ResolveAssetOptions {
  domain?: string;
  forceRefresh?: boolean;
  timeoutMs?: number;
  signal?: AbortSignal;
}

// In-memory caches: per domain and per issuer account
const domainCache = new Map<string, CachedDomainMetadata>();
const issuerDomainCache = new Map<string, { domain: string | null; fetchedAt: number }>();

/**
 * Clear cached metadata. Useful for tests or cache busting.
 */
export function clearAssetMetadataCache(): void {
  domainCache.clear();
  issuerDomainCache.clear();
}

/**
 * Manually set cached domain metadata (useful for tests).
 */
export function setCachedDomainMetadata(
  domain: string,
  data: Partial<CachedDomainMetadata> & { currencies: Sep1Currency[] }
): void {
  const cleanDomain = domain.toLowerCase().trim();
  domainCache.set(cleanDomain, {
    domain: cleanDomain,
    currencies: data.currencies,
    orgName: data.orgName,
    fetchedAt: data.fetchedAt ?? Date.now(),
  });
}

/**
 * Get current count of cached domains.
 */
export function getDomainCacheSize(): number {
  return domainCache.size;
}

/**
 * Parse SEP-1 TOML content with robust support for [[CURRENCIES]] and [DOCUMENTATION].
 * Degrades gracefully on malformed lines without throwing.
 */
export function parseSep1Toml(content: string): Sep1TomlData {
  const result: Sep1TomlData = {
    CURRENCIES: [],
  };

  let currentSection = "";
  let isCurrencyArray = false;
  let currentCurrency: Sep1Currency | null = null;

  const lines = content.split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    // Array of tables: [[CURRENCIES]]
    const arrayMatch = line.match(/^\[\[([A-Za-z0-9_.-]+)\]\]$/);
    if (arrayMatch) {
      const sectionName = arrayMatch[1];
      if (sectionName.toUpperCase() === "CURRENCIES") {
        isCurrencyArray = true;
        currentSection = "CURRENCIES";
        currentCurrency = { code: "" };
        result.CURRENCIES!.push(currentCurrency);
      } else {
        isCurrencyArray = false;
        currentSection = sectionName;
        currentCurrency = null;
      }
      continue;
    }

    // Section table: [SECTION]
    const tableMatch = line.match(/^\[([A-Za-z0-9_.-]+)\]$/);
    if (tableMatch) {
      const sectionName = tableMatch[1];
      isCurrencyArray = false;
      currentCurrency = null;
      currentSection = sectionName.toUpperCase();
      if (!result[currentSection]) {
        result[currentSection] = {};
      }
      continue;
    }

    // Key-value pair: key = value
    const kvMatch = line.match(/^([A-Za-z0-9_.-]+)\s*=\s*(.+)$/);
    if (kvMatch) {
      const key = kvMatch[1].trim();
      let rawVal = kvMatch[2].trim();

      // Remove trailing inline comments if not in quotes
      if (!rawVal.startsWith('"') && !rawVal.startsWith("'")) {
        const hashIdx = rawVal.indexOf("#");
        if (hashIdx !== -1) {
          rawVal = rawVal.slice(0, hashIdx).trim();
        }
      }

      let parsedVal: string | number | boolean = rawVal;
      if (
        (rawVal.startsWith('"') && rawVal.endsWith('"')) ||
        (rawVal.startsWith("'") && rawVal.endsWith("'"))
      ) {
        parsedVal = rawVal.slice(1, -1);
      } else if (rawVal === "true") {
        parsedVal = true;
      } else if (rawVal === "false") {
        parsedVal = false;
      } else if (/^-?\d+(\.\d+)?$/.test(rawVal)) {
        parsedVal = Number(rawVal);
      }

      if (isCurrencyArray && currentCurrency) {
        (currentCurrency as Record<string, unknown>)[key] = parsedVal;
        if (key === "display_decimals" && typeof parsedVal === "number") {
          currentCurrency.display_decimals = parsedVal;
        }
      } else if (currentSection && result[currentSection] && typeof result[currentSection] === "object") {
        (result[currentSection] as Record<string, unknown>)[key] = parsedVal;
      } else {
        result[key] = parsedVal;
      }
    }
  }

  return result;
}

/**
 * Fetch and parse SEP-1 TOML for an issuer domain.
 * Enforces timeout, size limits, SSRF guard, and caches result per domain.
 */
export async function fetchDomainToml(
  domain: string,
  options?: { timeoutMs?: number; signal?: AbortSignal; forceRefresh?: boolean }
): Promise<CachedDomainMetadata | null> {
  const cleanDomain = domain.toLowerCase().trim();
  const now = Date.now();

  if (!options?.forceRefresh) {
    const cached = domainCache.get(cleanDomain);
    if (cached && now - cached.fetchedAt < DOMAIN_CACHE_TTL_MS) {
      return cached;
    }
  }

  const tomlUrl = `https://${cleanDomain}/.well-known/stellar.toml`;

  // SSRF guard
  if (!isSafeWebhookUrl(tomlUrl)) {
    return null;
  }

  const timeoutMs = options?.timeoutMs ?? METADATA_FETCH_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(tomlUrl, {
      method: "GET",
      headers: { Accept: "text/plain, text/toml, application/toml, */*" },
      signal: controller.signal,
    });

    if (!res.ok) {
      return null;
    }

    const contentLength = res.headers.get("content-length");
    if (contentLength && parseInt(contentLength, 10) > MAX_TOML_SIZE_BYTES) {
      return null;
    }

    const text = await res.text();
    if (text.length > MAX_TOML_SIZE_BYTES) {
      return null;
    }

    const parsed = parseSep1Toml(text);
    const orgName = parsed.DOCUMENTATION?.ORG_NAME as string | undefined;
    const currencies = parsed.CURRENCIES || [];

    const entry: CachedDomainMetadata = {
      domain: cleanDomain,
      currencies,
      orgName,
      fetchedAt: now,
    };

    domainCache.set(cleanDomain, entry);
    return entry;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Lookup the home_domain for a Stellar issuing account from Horizon.
 */
export async function fetchIssuerHomeDomain(
  issuer: string,
  options?: { timeoutMs?: number; signal?: AbortSignal; forceRefresh?: boolean }
): Promise<string | null> {
  const now = Date.now();
  if (!options?.forceRefresh) {
    const cached = issuerDomainCache.get(issuer);
    if (cached && now - cached.fetchedAt < DOMAIN_CACHE_TTL_MS) {
      return cached.domain;
    }
  }

  if (!isValidAssetIssuer(issuer)) {
    return null;
  }

  const timeoutMs = options?.timeoutMs ?? METADATA_FETCH_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const url = `${HORIZON_URL}/accounts/${issuer}`;
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) {
      issuerDomainCache.set(issuer, { domain: null, fetchedAt: now });
      return null;
    }

    const data = await res.json();
    const domain = (data?.home_domain as string)?.toLowerCase().trim() || null;
    issuerDomainCache.set(issuer, { domain, fetchedAt: now });
    return domain;
  } catch {
    issuerDomainCache.set(issuer, { domain: null, fetchedAt: now });
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Resolve asset metadata from the issuer's SEP-1 TOML.
 *
 * • Checks built-in known assets first.
 * • Resolves issuer's home domain via Horizon (or provided domain option).
 * • Fetches and parses SEP-1 TOML adhering to size/timeout limits.
 * • Caches results per issuer domain with TTL.
 * • Gracefully degrades to raw code + issuer when metadata is missing or unreachable.
 */
export async function resolveAssetMetadata(
  code: string,
  issuer?: string,
  options?: ResolveAssetOptions
): Promise<ResolvedAssetMetadata> {
  const upperCode = code.toUpperCase().trim();
  const assetType =
    upperCode === "XLM" && !issuer
      ? "native"
      : upperCode.length <= 4
      ? "credit_alphanum4"
      : "credit_alphanum12";

  // Native XLM
  if (upperCode === "XLM" && !issuer) {
    return {
      code: "XLM",
      type: "native",
      displayName: "Stellar Lumens",
      name: "Stellar Lumens",
      resolved: true,
    };
  }

  // Known USDC shortcuts
  if (issuer === USDC_TESTNET.issuer) {
    return {
      code: "USDC",
      issuer: USDC_TESTNET.issuer,
      type: "credit_alphanum4",
      displayName: "USDC (Testnet)",
      name: "USD Coin",
      orgName: "Centre Consortium",
      domain: "centre.io",
      displayDecimals: 7,
      resolved: true,
    };
  }
  if (issuer === USDC_MAINNET.issuer) {
    return {
      code: "USDC",
      issuer: USDC_MAINNET.issuer,
      type: "credit_alphanum4",
      displayName: "USDC",
      name: "USD Coin",
      orgName: "Centre Consortium",
      domain: "centre.io",
      displayDecimals: 7,
      resolved: true,
    };
  }

  // Default fallback: raw code and issuer
  const fallbackResult: ResolvedAssetMetadata = {
    code: upperCode,
    issuer,
    type: assetType,
    displayName: upperCode,
    resolved: false,
  };

  try {
    let domain = options?.domain;
    if (!domain && issuer) {
      domain = (await fetchIssuerHomeDomain(issuer, options)) || undefined;
    }

    if (!domain) {
      return fallbackResult;
    }

    fallbackResult.domain = domain;

    const domainMeta = await fetchDomainToml(domain, options);
    if (!domainMeta) {
      return fallbackResult;
    }

    const currency = domainMeta.currencies.find((c) => {
      const matchCode = c.code?.toUpperCase() === upperCode;
      if (!matchCode) return false;
      if (issuer && c.issuer) {
        return c.issuer === issuer;
      }
      return true;
    });

    if (currency) {
      const displayName = currency.name || upperCode;
      return {
        code: upperCode,
        issuer: currency.issuer || issuer,
        type: assetType,
        displayName,
        name: currency.name,
        desc: currency.desc,
        orgName: currency.org_name || domainMeta.orgName,
        domain,
        displayDecimals: currency.display_decimals,
        resolved: true,
      };
    }

    return fallbackResult;
  } catch {
    return fallbackResult;
  }
}
