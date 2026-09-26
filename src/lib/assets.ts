// SPDX-License-Identifier: MIT

/**
 * Multi-asset support for Stellar payments beyond native XLM.
 * Includes USDC on Stellar, custom token validation helpers,
 * and SEP-1 TOML asset metadata resolution with domain-level caching.
 */

import { withTimeout } from "./timeout";
import { getHorizonServer } from "./stellar";
import { isSafeWebhookUrl } from "./webhook-url-guard";

export interface AssetInfo {
  code: string;
  issuer?: string;
  type: "native" | "credit_alphanum4" | "credit_alphanum12";
  displayName: string;
  decimals: number;
  domain?: string;
  orgName?: string;
  description?: string;
}

export interface CurrencyMetadata {
  code: string;
  name?: string;
  desc?: string;
  issuer?: string;
}

interface DomainTomlCacheEntry {
  currencies: Map<string, CurrencyMetadata>;
  fetchedAt: number;
}

// ── Cache & Network Constraints ────────────────────────────────

export const DEFAULT_DOMAIN_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour per domain
export const MAX_TOML_SIZE_BYTES = 100 * 1024; // 100 KB max limit
export const DEFAULT_METADATA_TIMEOUT_MS = 5000; // 5s timeout

const domainTomlCache = new Map<string, DomainTomlCacheEntry>();

/** Clear the domain metadata cache (useful for testing or cache eviction). */
export function clearDomainMetadataCache(): void {
  domainTomlCache.clear();
}

/** Get the current number of cached domains. */
export function getDomainMetadataCacheSize(): number {
  return domainTomlCache.size;
}

/** Manually set a domain cache entry (useful for deterministic tests). */
export function setDomainMetadataCacheEntry(
  domain: string,
  currencies: Map<string, CurrencyMetadata>,
  ttlMs = DEFAULT_DOMAIN_CACHE_TTL_MS
): void {
  domainTomlCache.set(domain.toLowerCase(), {
    currencies,
    fetchedAt: Date.now() - (DEFAULT_DOMAIN_CACHE_TTL_MS - ttlMs),
  });
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
  domain: "circle.com",
  orgName: "Circle Financial",
};

/** Native XLM */
export const XLM_ASSET: AssetInfo = {
  code: "XLM",
  type: "native",
  displayName: "Stellar Lumens",
  decimals: 7,
};

// ── Helpers ────────────────────────────────────────────────────

/** Format an issuer address to a compact string (e.g. GAB...123). */
export function truncateIssuer(issuer: string): string {
  if (!issuer || issuer.length < 8) return issuer || "";
  return `${issuer.slice(0, 4)}...${issuer.slice(-4)}`;
}

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

// ── SEP-1 TOML Parser ──────────────────────────────────────────

/**
 * Lightweight, zero-dependency parser for the [[CURRENCIES]] section of a stellar.toml file.
 * Safely extracts code, name, desc, and issuer without throwing on malformed lines.
 */
export function parseSep1TomlCurrencies(tomlContent: string): Map<string, CurrencyMetadata> {
  const currencies = new Map<string, CurrencyMetadata>();
  if (!tomlContent || typeof tomlContent !== "string") return currencies;

  // Split into [[CURRENCIES]] blocks
  const blocks = tomlContent.split(/\[\[\s*CURRENCIES\s*\]\]/i);
  // The first segment is document header; skip it
  for (let i = 1; i < blocks.length; i++) {
    const block = blocks[i];
    // Read key-value pairs until the next table header or end of block
    const lines = block.split(/\r?\n/);
    let currentCode: string | undefined;
    let currentName: string | undefined;
    let currentDesc: string | undefined;
    let currentIssuer: string | undefined;

    for (const rawLine of lines) {
      const line = rawLine.trim();
      // If we encounter a new table (e.g. [DOCUMENT_INFO] or [[PRINCIPALS]]), stop
      if (line.startsWith("[") && !line.startsWith("[[")) break;
      if (line.startsWith("#") || !line.includes("=")) continue;

      const equalIdx = line.indexOf("=");
      const key = line.slice(0, equalIdx).trim().toLowerCase();
      let val = line.slice(equalIdx + 1).trim();

      // Strip enclosing quotes if string
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }

      if (key === "code") currentCode = val;
      else if (key === "name") currentName = val;
      else if (key === "desc") currentDesc = val;
      else if (key === "issuer") currentIssuer = val;
    }

    if (currentCode) {
      const upper = currentCode.trim().toUpperCase();
      currencies.set(upper, {
        code: upper,
        name: currentName,
        desc: currentDesc,
        issuer: currentIssuer,
      });
    }
  }

  return currencies;
}

// ── Safe Outbound Domain Fetcher ────────────────────────────────

const BLOCKED_DOMAIN_SUFFIXES = [
  "localhost",
  ".local",
  ".internal",
  ".lan",
  ".home",
  ".corp",
  ".priv",
  ".test",
  ".example",
  ".invalid",
];

/**
 * Validate that a home domain is syntactically sound and passes SSRF checks.
 */
export function isSafeHomeDomain(domain: string): boolean {
  if (!domain || typeof domain !== "string") return false;
  const clean = domain.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  // Must be a valid hostname (no spaces, no special punctuation besides dots and hyphens)
  if (!/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/.test(clean)) {
    return false;
  }
  // Check private and local domain suffixes
  if (
    clean === "localhost" ||
    BLOCKED_DOMAIN_SUFFIXES.some((suffix) => clean.endsWith(suffix))
  ) {
    return false;
  }
  // Construct destination URL and check SSRF guard
  const targetUrl = `https://${clean}/.well-known/stellar.toml`;
  return isSafeWebhookUrl(targetUrl);
}

/**
 * Fetch and parse SEP-1 TOML metadata from an issuer's home domain.
 * Enforces size limits, request timeouts, and caches results per-domain.
 */
export async function fetchDomainToml(
  domain: string,
  timeoutMs = DEFAULT_METADATA_TIMEOUT_MS
): Promise<Map<string, CurrencyMetadata> | null> {
  if (!domain) return null;
  const cleanDomain = domain.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");

  // 1. Check in-memory cache
  const cached = domainTomlCache.get(cleanDomain);
  if (cached && Date.now() - cached.fetchedAt < DEFAULT_DOMAIN_CACHE_TTL_MS) {
    return cached.currencies;
  }

  // 2. Validate domain safety against SSRF
  if (!isSafeHomeDomain(cleanDomain)) {
    return null;
  }

  const tomlUrl = `https://${cleanDomain}/.well-known/stellar.toml`;

  try {
    const fetchPromise = (async () => {
      const res = await fetch(tomlUrl, {
        method: "GET",
        headers: { Accept: "text/plain, application/toml, */*" },
      });
      if (!res.ok) return null;

      // Check Content-Length header if provided
      const contentLength = res.headers.get("content-length");
      if (contentLength && parseInt(contentLength, 10) > MAX_TOML_SIZE_BYTES) {
        return null;
      }

      // Read text while enforcing MAX_TOML_SIZE_BYTES
      const text = await res.text();
      if (text.length > MAX_TOML_SIZE_BYTES) {
        return null;
      }
      return text;
    })();

    const tomlContent = await withTimeout(fetchPromise, timeoutMs, "TOML fetch timed out");
    if (!tomlContent) {
      return null;
    }

    const currencies = parseSep1TomlCurrencies(tomlContent);
    domainTomlCache.set(cleanDomain, {
      currencies,
      fetchedAt: Date.now(),
    });
    return currencies;
  } catch {
    // Graceful degradation: never throw on unreachable or malformed domains
    return null;
  }
}

// ── Asset Metadata Resolution ───────────────────────────────────

/**
 * Resolves full asset metadata for a given asset code and issuer address.
 * 1. Checks known hardcoded assets (XLM, USDC).
 * 2. Fetches the issuer account's home_domain from Horizon.
 * 3. Fetches the domain's SEP-1 stellar.toml (cached per domain with TTL).
 * 4. Merges the resolved display name, or gracefully degrades to CODE (ISSUER_TRUNCATED).
 */
export async function resolveAssetMetadata(
  code: string,
  issuer?: string,
  options?: {
    timeoutMs?: number;
    horizonServer?: any;
  }
): Promise<AssetInfo> {
  const upperCode = (code || "XLM").trim().toUpperCase();

  // 1. Native XLM
  if (upperCode === "XLM" || !issuer) {
    return XLM_ASSET;
  }

  // 2. Known USDC
  if (upperCode === "USDC") {
    if (issuer === USDC_TESTNET.issuer) return USDC_TESTNET;
    if (issuer === USDC_MAINNET.issuer) return USDC_MAINNET;
  }

  const assetType: "credit_alphanum4" | "credit_alphanum12" =
    upperCode.length <= 4 ? "credit_alphanum4" : "credit_alphanum12";

  // Base degraded representation
  const truncated = truncateIssuer(issuer);
  const fallbackInfo: AssetInfo = {
    code: upperCode,
    issuer,
    type: assetType,
    displayName: `${upperCode} (${truncated})`,
    decimals: 7,
  };

  // If invalid issuer format, return fallback immediately
  if (!isValidAssetIssuer(issuer)) {
    return fallbackInfo;
  }

  try {
    const timeoutMs = options?.timeoutMs ?? DEFAULT_METADATA_TIMEOUT_MS;
    const server = options?.horizonServer ?? getHorizonServer();

    // Fetch account from Horizon to discover home_domain
    const accountPromise = server.loadAccount(issuer);
    const account = await withTimeout(
      accountPromise,
      timeoutMs,
      "Horizon loadAccount timed out"
    );

    const homeDomain: string | undefined = account?.home_domain;
    if (!homeDomain || typeof homeDomain !== "string") {
      return fallbackInfo;
    }

    // Resolve SEP-1 TOML metadata
    const currencies = await fetchDomainToml(homeDomain, timeoutMs);
    if (!currencies) {
      return {
        ...fallbackInfo,
        domain: homeDomain,
      };
    }

    const matched = currencies.get(upperCode);
    if (matched && matched.name) {
      return {
        code: upperCode,
        issuer,
        type: assetType,
        displayName: `${matched.name} (${upperCode})`,
        decimals: 7,
        domain: homeDomain,
        orgName: matched.name,
        description: matched.desc,
      };
    }

    return {
      ...fallbackInfo,
      domain: homeDomain,
    };
  } catch {
    // Graceful degradation: never surface errors to the caller
    return fallbackInfo;
  }
}

