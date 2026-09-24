// SPDX-License-Identifier: MIT

/**
 * SEP-1 asset metadata resolution for custom Stellar assets.
 *
 * Custom assets are identified by a raw code plus an opaque issuer address.
 * Stellar issuers publish human-readable metadata via the SEP-1 stellar.toml
 * file at the issuer's home domain (CURRENCIES section). This module:
 *
 *   1. Discovers an issuer's home domain from the Horizon account record
 *      (the `home_domain` field).
 *   2. Safely fetches `https://<domain>/.well-known/stellar.toml`, reusing
 *      the shared SSRF guard, timeout and response-size limits.
 *   3. Parses the TOML CURRENCIES section and matches the asset by
 *      code + issuer.
 *   4. Caches the parsed TOML per issuer DOMAIN (not per asset) with a TTL.
 *   5. Degrades gracefully — any failure resolves to null so callers fall
 *      back to showing the raw code + issuer without surfacing an error.
 *
 * The TOML parser is intentionally dependency-free: SEP-1 currency entries
 * are flat `[[CURRENCIES]]` tables with scalar values, which we need only a
 * subset of. This avoids pulling a TOML library into the client/server graph
 * and keeps the attack surface small.
 */

import { withTimeout } from "@/lib/timeout";
import { isSafeWebhookUrlAtDelivery } from "@/lib/webhook-url-guard";

// ── Tunables (shared outbound-fetch posture) ───────────────────

/** Fetch timeout for account + TOML requests. */
export const ASSET_METADATA_TIMEOUT_MS = 5000;

/** Maximum stellar.toml size we will read (SEP-1 recommends staying small). */
export const ASSET_METADATA_MAX_BYTES = 100_000;

/** How long a resolved TOML document is cached per domain. */
export const ASSET_METADATA_TTL_MS = 60 * 60 * 1000; // 1 hour

/** Horizon host used to look up an issuer's home domain. */
const HORIZON_HOSTS: Record<string, string> = {
  PUBLIC: "https://horizon.stellar.org",
  TESTNET: "https://horizon-testnet.stellar.org",
};

// ── Types ──────────────────────────────────────────────────────

export interface ResolvedAssetMetadata {
  /** Display name, e.g. EUR Tether (resolved CURRENCIES.name). */
  name: string;
  /** The asset code, normalised upper-case. */
  code: string;
  /** Issuer account id. */
  issuer: string;
  /** Origin home domain the metadata came from. */
  domain: string;
  /** Optional issuer-provided description. */
  description?: string;
}

interface CachedToml {
  /** Parsed currency rows keyed for fast code+issuer matching. */
  currencies: TomlCurrency[];
  /** Expiry timestamp (ms epoch). */
  expiresAt: number;
}

interface TomlCurrency {
  code?: string;
  issuer?: string;
  name?: string;
  desc?: string;
  [key: string]: string | undefined;
}

// ── Per-domain TTL cache ───────────────────────────────────────
// Module-level cache is safe here: keys are home domains, values are bounded
// TOML documents, and entries expire. Cache is keyed by DOMAIN so every asset
// from the same issuer shares a single fetch.

const domainCache = new Map<string, CachedToml>();

/** Exposed for tests to reset cache state. */
export function clearAssetMetadataCache(): void {
  domainCache.clear();
}

function getCached(domain: string): CachedToml | undefined {
  const entry = domainCache.get(domain);
  if (!entry) return undefined;
  if (entry.expiresAt <= Date.now()) {
    domainCache.delete(domain);
    return undefined;
  }
  return entry;
}

function setCached(domain: string, currencies: TomlCurrency[]): void {
  domainCache.set(domain, {
    currencies,
    expiresAt: Date.now() + ASSET_METADATA_TTL_MS,
  });
}

// ── Minimal TOML `[[CURRENCIES]]` parser ───────────────────────

/**
 * Parse the CURRENCIES array from a SEP-1 stellar.toml document.
 * Only flat scalar key = "value" pairs are captured. Returns [] when the
 * document contains no CURRENCIES table or is malformed.
 */
export function parseCurrencies(toml: string): TomlCurrency[] {
  const lines = toml.split(/\r?\n/);
  const currencies: TomlCurrency[] = [];
  let inCurrencies = false;
  let current: TomlCurrency | null = null;

  const startCurrency = (): void => {
    current = {} as TomlCurrency;
    currencies.push(current);
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();

    // Table headers define scope.
    if (line.startsWith("[[")) {
      inCurrencies =
        line.replace(/[\[\]]/g, "").trim().toUpperCase() === "CURRENCIES";
      if (inCurrencies) startCurrency();
      else current = null;
      continue;
    }
    if (line.startsWith("[")) {
      // A different (non-array) table ends CURRENCIES scope.
      inCurrencies = false;
      current = null;
      continue;
    }

    if (!inCurrencies || current == null) continue;
    if (!line || line.startsWith("#")) continue;

    const eq = line.indexOf("=");
    if (eq === -1) continue; // malformed line inside a table — ignore

    const key = line.slice(0, eq).trim().toLowerCase();
    const rawValue = line.slice(eq + 1).trim();

    const row: Record<string, string | undefined> = current;
    row[key] = unquote(stripInlineComment(rawValue));
  }

  return currencies;
}

/**
 * Remove a trailing `# comment`, but only when the `#` is not enclosed in a
 * quoted string. Handles both single and double quotes; a backslash escapes
 * the next character so e.g. `\#` or `\"` do not end the string.
 */
export function stripInlineComment(value: string): string {
  let quote: string | null = null;
  for (let i = 0; i < value.length; i++) {
    const ch = value[i];
    if (ch === "\\" && quote !== null) {
      i++; // skip escaped character
      continue;
    }
    if (quote !== null) {
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === "#") {
      return value.slice(0, i).trim();
    }
  }
  return value.trim();
}

function unquote(value: string): string {
  if (
    value.length >= 2 &&
    ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'")))
  ) {
    return value.slice(1, -1).trim();
  }
  return value.trim();
}

// ── Safe outbound fetch ────────────────────────────────────────

/**
 * Fetch a URL with the shared SSRF guard, timeout and size cap.
 * Throws on any policy/network violation. Reads at most maxBytes from the
 * body and rejects oversized responses.
 */
async function safeFetchText(
  url: string,
  maxBytes = ASSET_METADATA_MAX_BYTES,
): Promise<string> {
  // Re-validate the resolved address at fetch time (DNS-rebinding guard).
  if (!(await isSafeWebhookUrlAtDelivery(url))) {
    throw new Error("URL resolved to a private or internal address");
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ASSET_METADATA_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      redirect: "manual",
      headers: { Accept: "application/toml, text/plain, */*" },
      signal: controller.signal,
    });

    if (!response.ok || response.body == null) {
      throw new Error(`HTTP ${response.status} fetching asset metadata`);
    }

    // Read with an explicit byte cap so a hostile large response can't exhaust
    // memory. We consume the stream incrementally and stop at the limit.
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let received = 0;

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        received += value.byteLength;
        if (received > maxBytes) {
          await reader.cancel().catch(() => undefined);
          throw new Error("Asset metadata response exceeded size limit");
        }
        chunks.push(value);
      }
    }

    return new TextDecoder().decode(concat(chunks));
  } finally {
    clearTimeout(timer);
  }
}

function concat(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, c) => sum + c.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}

// ── Public API ─────────────────────────────────────────────────

/** Fetch an issuer account's home_domain from Horizon. */
export async function fetchHomeDomain(
  issuer: string,
  network: "PUBLIC" | "TESTNET" = "PUBLIC",
): Promise<string | null> {
  const host = HORIZON_HOSTS[network];
  const url = `${host}/accounts/${issuer}`;
  const text = await safeFetchText(url);
  const account = JSON.parse(text) as { home_domain?: string };
  return account.home_domain ? normalizeDomain(account.home_domain) : null;
}

/**
 * Fetch (or read from cache) the parsed CURRENCIES table for an issuer's
 * home domain. Cached per domain with a TTL.
 */
export async function fetchCurrenciesForDomain(
  domain: string,
): Promise<TomlCurrency[]> {
  const normalized = normalizeDomain(domain);
  const cached = getCached(normalized);
  if (cached) return cached.currencies;

  const tomlUrl = `https://${normalized}/.well-known/stellar.toml`;
  const toml = await safeFetchText(tomlUrl);
  const currencies = parseCurrencies(toml);
  setCached(normalized, currencies);
  return currencies;
}

/**
 * Resolve display metadata for a custom asset. Returns null on ANY failure
 * (no home domain, unreachable/malformed TOML, no matching currency) so
 * callers can silently degrade to raw code + issuer. Never throws.
 */
export async function resolveAssetMetadata(
  code: string,
  issuer: string,
  network: "PUBLIC" | "TESTNET" = "PUBLIC",
): Promise<ResolvedAssetMetadata | null> {
  try {
    const domain = await fetchHomeDomain(issuer, network);
    if (!domain) return null;

    const currencies = await fetchCurrenciesForDomain(domain);
    const upperCode = code.toUpperCase();
    const match = currencies.find(
      (c) =>
        (c.code ?? "").toUpperCase() === upperCode &&
        (c.issuer ?? "") === issuer,
    );

    if (!match || !match.name) return null;

    return {
      name: match.name,
      code: upperCode,
      issuer,
      domain,
      description: match.desc,
    };
  } catch {
    // Deliberate graceful degradation — do not surface an error to the user.
    return null;
  }
}

function normalizeDomain(domain: string): string {
  let d = domain.trim().toLowerCase();
  d = d.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  return d;
}

/** Re-export withTimeout so tests can assert the documented bound if needed. */
export { withTimeout };
