// SPDX-License-Identifier: MIT

/**
 * SEP-1 stellar.toml asset metadata resolution.
 *
 * Custom Stellar assets are identified on-chain only by a code and an issuer
 * address — opaque to users reviewing a payment or batch. SEP-1 defines a
 * standard discovery mechanism: the issuing account publishes a `home_domain`
 * on-chain, and that domain serves a `/.well-known/stellar.toml` file whose
 * `[[CURRENCIES]]` section describes each asset (name, display decimals, …).
 *
 * This module resolves that metadata with the same defensive posture as every
 * other outbound fetch in the app:
 *
 *   • SSRF guard — the issuer controls `home_domain`, so the TOML URL is
 *     validated with the shared webhook URL safety helper before fetching.
 *   • Shared timeout — fetches abort after the same default budget the price
 *     feed uses (DEFAULT_PRICE_TIMEOUT_MS).
 *   • Size limit — the TOML body is streamed with a hard byte cap; oversized
 *     or over-declared responses are rejected before parsing.
 *   • Per-domain caching with a TTL — metadata is cached per issuer *domain*
 *     (not per asset), and failures are negatively cached so an unreachable
 *     issuer doesn't stampede the network on every render.
 *
 * Every failure mode (no home domain, unreachable host, malformed TOML, no
 * matching currency, timeout, SSRF rejection) degrades to `resolved: false`
 * — callers always get a usable result and never an exception.
 */

import { isValidAssetIssuer } from "@/lib/assets";
import { isSafeWebhookUrl } from "@/lib/webhook-url-guard";
import { DEFAULT_PRICE_TIMEOUT_MS } from "@/lib/price";
import { HORIZON_URL } from "@/lib/stellar";
import { logger } from "@/lib/logger";

// ── Constants ──────────────────────────────────────────────────

/** How long resolved (or failed) metadata is cached per domain. */
export const ASSET_METADATA_CACHE_TTL_MS = 5 * 60_000; // 5 minutes

/** Outbound fetch budget — shared with the price feed default. */
export const ASSET_METADATA_TIMEOUT_MS = DEFAULT_PRICE_TIMEOUT_MS; // 5s

/** Hard cap on a stellar.toml response body (these files are a few KB). */
export const MAX_STELLAR_TOML_BYTES = 100 * 1024; // 100 KB

const ASSET_CODE_RE = /^[A-Za-z0-9]{1,12}$/;
const HOSTNAME_RE =
  /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

// ── Types ──────────────────────────────────────────────────────

/** A single `[[CURRENCIES]]` entry from a stellar.toml. */
export interface TomlCurrency {
  code: string;
  issuer?: string;
  name?: string;
  desc?: string;
  image?: string;
  displayDecimals?: number;
}

/** Resolution result — always returned, never thrown. */
export interface AssetMetadataResult {
  code: string;
  issuer: string;
  /** True when a display name was resolved from the issuer's TOML. */
  resolved: boolean;
  /** Resolved display name, or null when degraded to code + issuer. */
  name: string | null;
  /** Issuer home domain the metadata came from (null when unknown). */
  domain: string | null;
  /** TOML display_decimals hint, when published. */
  displayDecimals: number | null;
}

/** Test seams — production callers use the defaults. */
export interface ResolveAssetMetadataOptions {
  fetchFn?: typeof fetch;
  horizonUrl?: string;
  timeoutMs?: number;
  maxTomlBytes?: number;
  ttlMs?: number;
}

// ── Caches ─────────────────────────────────────────────────────

interface DomainCacheEntry {
  fetchedAt: number;
  /** null = negative cache (fetch/parse failed or domain rejected). */
  currencies: TomlCurrency[] | null;
}

interface HomeDomainCacheEntry {
  fetchedAt: number;
  domain: string | null;
}

const domainCache = new Map<string, DomainCacheEntry>();
const homeDomainCache = new Map<string, HomeDomainCacheEntry>();
const pendingDomainFetches = new Map<
  string,
  Promise<TomlCurrency[] | null>
>();
const pendingHomeDomainFetches = new Map<string, Promise<string | null>>();

/** Clear all caches and in-flight dedup entries. Primarily for tests. */
export function clearAssetMetadataCache(): void {
  domainCache.clear();
  homeDomainCache.clear();
  pendingDomainFetches.clear();
  pendingHomeDomainFetches.clear();
}

// ── Fetch helpers ──────────────────────────────────────────────

async function fetchWithTimeout(
  fetchFn: typeof fetch,
  url: string,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchFn(url, {
      signal: controller.signal,
      headers: { Accept: "*/*" },
    });
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Read a response body with a hard byte cap. Checks Content-Length up front
 * and enforces the cap while streaming so an oversized body is rejected
 * before it is fully buffered.
 */
async function readBodyWithLimit(
  res: Response,
  maxBytes: number,
): Promise<string> {
  const declared = Number(res.headers.get("content-length") ?? 0);
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new Error(`Response exceeds size limit (${declared} > ${maxBytes})`);
  }

  if (!res.body) {
    const text = await res.text();
    if (new TextEncoder().encode(text).byteLength > maxBytes) {
      throw new Error("Response exceeds size limit");
    }
    return text;
  }

  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value && value.byteLength > 0) {
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new Error(`Response exceeds size limit (${total} > ${maxBytes})`);
      }
      chunks.push(value);
    }
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

// ── TOML parsing ───────────────────────────────────────────────

/**
 * Parse a string value at the start of `raw`, returning the value and the
 * number of characters consumed. Throws on unterminated strings or invalid
 * escapes — malformed TOML must fail loudly here so the caller can degrade.
 */
function parseTomlString(raw: string): { value: string; consumed: number } {
  let out = "";
  for (let i = 1; i < raw.length; i++) {
    const ch = raw[i]!;
    if (ch === "\\") {
      const next = raw[i + 1];
      if (next === '"' || next === "\\") {
        out += next;
        i++;
        continue;
      }
      if (next === "n") {
        out += "\n";
        i++;
        continue;
      }
      if (next === "t") {
        out += "\t";
        i++;
        continue;
      }
      throw new Error(`Invalid escape sequence in TOML string`);
    }
    if (ch === '"') {
      return { value: out, consumed: i + 1 };
    }
    out += ch;
  }
  throw new Error("Unterminated string in TOML");
}

function parseTomlValue(raw: string): string | number | boolean {
  const trimmed = raw.trim();
  if (trimmed.startsWith('"')) {
    return parseTomlString(trimmed).value;
  }
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (/^-?\d+$/.test(trimmed)) return parseInt(trimmed, 10);
  if (/^-?\d+\.\d+$/.test(trimmed)) return parseFloat(trimmed);
  throw new Error(`Unsupported TOML value: ${trimmed.slice(0, 32)}`);
}

/** Strip a trailing `# comment` that appears outside of a quoted string. */
function stripTrailingComment(line: string): string {
  let inString = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (inString && ch === "\\") {
      i++;
      continue;
    }
    if (ch === '"') inString = !inString;
    if (!inString && ch === "#") return line.slice(0, i);
  }
  return line;
}

/**
 * Extract the `[[CURRENCIES]]` entries from a stellar.toml document.
 *
 * This is a deliberately small parser for the SEP-1 subset (table-array
 * headers, bare keys, string/number/boolean values, comments). Anything
 * outside that subset — unterminated strings, bare words, broken headers —
 * throws, so callers treat the document as unusable and degrade.
 */
export function parseStellarTomlCurrencies(toml: string): TomlCurrency[] {
  const currencies: TomlCurrency[] = [];
  let current: Record<string, string | number | boolean> | null = null;

  const lines = toml.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = stripTrailingComment(lines[i]!).trim();
    if (line === "") continue;

    // Section headers
    if (line.startsWith("[")) {
      current = null;
      const arrayMatch = line.match(/^\[\[([A-Za-z0-9_.-]+)\]\]$/);
      if (arrayMatch) {
        if (arrayMatch[1] === "CURRENCIES") {
          current = {};
          currencies.push(current as unknown as TomlCurrency);
        }
        continue;
      }
      if (/^\[[A-Za-z0-9_.-]+\]$/.test(line)) continue;
      throw new Error(`Malformed TOML section header on line ${i + 1}`);
    }

    // key = value
    const eq = line.indexOf("=");
    if (eq <= 0) {
      throw new Error(`Malformed TOML line ${i + 1}: expected key = value`);
    }
    const key = line.slice(0, eq).trim();
    if (!/^[A-Za-z0-9_-]+$/.test(key)) {
      throw new Error(`Malformed TOML key on line ${i + 1}`);
    }
    const value = parseTomlValue(line.slice(eq + 1));
    if (current) current[key] = value;
  }

  // Normalize raw key/value records into typed currency entries.
  return currencies
    .map((raw) => {
      const entry = raw as unknown as Record<
        string,
        string | number | boolean
      >;
      const currency: TomlCurrency = {
        code: typeof entry.code === "string" ? entry.code : "",
      };
      if (typeof entry.issuer === "string") currency.issuer = entry.issuer;
      if (typeof entry.name === "string") currency.name = entry.name;
      if (typeof entry.desc === "string") currency.desc = entry.desc;
      if (typeof entry.image === "string") currency.image = entry.image;
      if (typeof entry.display_decimals === "number") {
        currency.displayDecimals = entry.display_decimals;
      }
      return currency;
    })
    .filter((c) => c.code !== "");
}

// ── Home domain lookup ─────────────────────────────────────────

/** Validate an on-chain home_domain string before it becomes a fetch URL. */
export function isValidHomeDomain(domain: string): boolean {
  return HOSTNAME_RE.test(domain.toLowerCase());
}

async function fetchHomeDomain(
  issuer: string,
  fetchFn: typeof fetch,
  horizonUrl: string,
  timeoutMs: number,
): Promise<string | null> {
  const base = horizonUrl.replace(/\/+$/, "");
  const res = await fetchWithTimeout(
    fetchFn,
    `${base}/accounts/${encodeURIComponent(issuer)}`,
    timeoutMs,
  );
  if (!res.ok) return null;
  const data = (await res.json()) as { home_domain?: unknown };
  const domain =
    typeof data.home_domain === "string" ? data.home_domain.trim() : "";
  if (!domain || !isValidHomeDomain(domain)) return null;
  return domain.toLowerCase();
}

async function getIssuerHomeDomain(
  issuer: string,
  fetchFn: typeof fetch,
  horizonUrl: string,
  timeoutMs: number,
  ttlMs: number,
): Promise<string | null> {
  const cached = homeDomainCache.get(issuer);
  if (cached && Date.now() - cached.fetchedAt < ttlMs) return cached.domain;

  const pending = pendingHomeDomainFetches.get(issuer);
  if (pending) return pending;

  const fetchPromise = (async (): Promise<string | null> => {
    try {
      const domain = await fetchHomeDomain(
        issuer,
        fetchFn,
        horizonUrl,
        timeoutMs,
      );
      homeDomainCache.set(issuer, { fetchedAt: Date.now(), domain });
      return domain;
    } catch (err) {
      // Unreachable Horizon, timeout, malformed account JSON — negatively
      // cache so repeated renders don't hammer the network.
      homeDomainCache.set(issuer, { fetchedAt: Date.now(), domain: null });
      logger.warn("Asset metadata: home domain lookup failed", {
        issuer,
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  })();

  pendingHomeDomainFetches.set(issuer, fetchPromise);
  try {
    return await fetchPromise;
  } finally {
    pendingHomeDomainFetches.delete(issuer);
  }
}

// ── TOML fetch (cached per domain) ─────────────────────────────

async function fetchDomainCurrencies(
  domain: string,
  fetchFn: typeof fetch,
  timeoutMs: number,
  maxTomlBytes: number,
): Promise<TomlCurrency[] | null> {
  const tomlUrl = `https://${domain}/.well-known/stellar.toml`;

  // The issuer controls home_domain — validate the derived URL with the
  // same SSRF guard used for outbound webhooks before fetching.
  if (!isSafeWebhookUrl(tomlUrl)) {
    logger.warn("Asset metadata: rejected unsafe home domain", { domain });
    return null;
  }

  const res = await fetchWithTimeout(fetchFn, tomlUrl, timeoutMs);
  if (!res.ok) return null;
  const body = await readBodyWithLimit(res, maxTomlBytes);
  return parseStellarTomlCurrencies(body);
}

async function getDomainCurrencies(
  domain: string,
  fetchFn: typeof fetch,
  timeoutMs: number,
  maxTomlBytes: number,
  ttlMs: number,
): Promise<TomlCurrency[] | null> {
  const cached = domainCache.get(domain);
  if (cached && Date.now() - cached.fetchedAt < ttlMs) return cached.currencies;

  // Deduplicate concurrent resolutions against the same domain.
  const pending = pendingDomainFetches.get(domain);
  if (pending) return pending;

  const fetchPromise = (async (): Promise<TomlCurrency[] | null> => {
    try {
      const currencies = await fetchDomainCurrencies(
        domain,
        fetchFn,
        timeoutMs,
        maxTomlBytes,
      );
      domainCache.set(domain, { fetchedAt: Date.now(), currencies });
      return currencies;
    } catch (err) {
      // Timeout, network failure, oversized body, malformed TOML —
      // negatively cache and degrade to code + issuer.
      domainCache.set(domain, { fetchedAt: Date.now(), currencies: null });
      logger.warn("Asset metadata: TOML fetch/parse failed", {
        domain,
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  })();

  pendingDomainFetches.set(domain, fetchPromise);
  try {
    return await fetchPromise;
  } finally {
    pendingDomainFetches.delete(domain);
  }
}

// ── Public API ─────────────────────────────────────────────────

/**
 * Resolve the display metadata for a custom asset from its issuer's SEP-1
 * stellar.toml. Never throws — every failure degrades to
 * `{ resolved: false, name: null }` so the UI can fall back to the raw
 * code plus issuer without an error surface.
 */
export async function resolveAssetMetadata(
  code: string,
  issuer: string,
  options: ResolveAssetMetadataOptions = {},
): Promise<AssetMetadataResult> {
  const fetchFn = options.fetchFn ?? fetch;
  const horizonUrl = options.horizonUrl ?? HORIZON_URL;
  const timeoutMs = options.timeoutMs ?? ASSET_METADATA_TIMEOUT_MS;
  const maxTomlBytes = options.maxTomlBytes ?? MAX_STELLAR_TOML_BYTES;
  const ttlMs = options.ttlMs ?? ASSET_METADATA_CACHE_TTL_MS;

  const degraded: AssetMetadataResult = {
    code,
    issuer,
    resolved: false,
    name: null,
    domain: null,
    displayDecimals: null,
  };

  // Input preconditions — invalid code/issuer can never resolve.
  if (!ASSET_CODE_RE.test(code) || !isValidAssetIssuer(issuer)) {
    return degraded;
  }

  try {
    const domain = await getIssuerHomeDomain(
      issuer,
      fetchFn,
      horizonUrl,
      timeoutMs,
      ttlMs,
    );
    if (!domain) return degraded;

    const currencies = await getDomainCurrencies(
      domain,
      fetchFn,
      timeoutMs,
      maxTomlBytes,
      ttlMs,
    );
    if (!currencies) return { ...degraded, domain };

    // Match on code, preferring entries whose issuer (when published in the
    // TOML) matches the asset issuer exactly.
    const match =
      currencies.find(
        (c) => c.code === code && (!c.issuer || c.issuer === issuer),
      ) ??
      currencies.find(
        (c) =>
          c.code.toUpperCase() === code.toUpperCase() &&
          (!c.issuer || c.issuer === issuer),
      );

    if (!match || !match.name) {
      return {
        ...degraded,
        domain,
        displayDecimals: match?.displayDecimals ?? null,
      };
    }

    return {
      code,
      issuer,
      resolved: true,
      name: match.name,
      domain,
      displayDecimals: match.displayDecimals ?? null,
    };
  } catch (err) {
    logger.warn("Asset metadata: resolution failed", {
      code,
      issuer,
      error: err instanceof Error ? err.message : String(err),
    });
    return degraded;
  }
}
