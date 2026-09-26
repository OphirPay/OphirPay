// SPDX-License-Identifier: MIT

/**
 * SEP-1 asset metadata resolution.
 *
 * Custom Stellar assets are identified by (code, issuer). The issuer publishes
 * a `stellar.toml` at `https://<home_domain>/.well-known/stellar.toml` whose
 * `[[CURRENCIES]]` entries carry the human-readable name for that asset (SEP-1).
 *
 * Resolution is best-effort and never throws: any failure (unknown issuer,
 * unreachable issuer, malformed TOML, unsafe URL) degrades to `null` so the UI
 * can fall back to displaying the raw code plus issuer.
 *
 * Fetches go through the same guards as every other outbound request:
 *   • shared timeout (`withTimeout`)
 *   • response size limit
 *   • the shared URL safety helper (`isSafeWebhookUrl`)
 * Results are cached **per home domain** (not per asset) with a TTL, because a
 * single issuer typically publishes several assets in one TOML document.
 */

import { withTimeout } from "./timeout";
import { isSafeWebhookUrl } from "./webhook-url-guard";

/** Horizon base URL used to discover an issuer's home domain. */
const DEFAULT_HORIZON_URL = "https://horizon.stellar.org";

/** How long a resolved domain's metadata stays fresh. */
export const ASSET_METADATA_TTL_MS = 60 * 60 * 1000; // 1 hour

/** Max bytes we will read from a stellar.toml document. */
export const ASSET_METADATA_MAX_BYTES = 100 * 1024; // 100 KiB

/** Timeout for each outbound HTTP request. */
export const ASSET_METADATA_TIMEOUT_MS = 5_000;

/** A currency entry parsed out of an issuer's stellar.toml. */
export interface TomlCurrency {
  code: string;
  issuer?: string;
  name?: string;
  desc?: string;
  display_decimals?: number;
}

/** Resolved display metadata for a custom asset. */
export interface ResolvedAssetMetadata {
  /** Home domain the metadata came from, e.g. `centre.io`. */
  domain: string;
  /** Display name from CURRENCIES (falls back to `desc`, then the code). */
  name: string;
  /** Optional long description. */
  description?: string;
  /** Optional display decimals declared by the issuer. */
  displayDecimals?: number;
}

interface CacheEntry {
  value: TomlCurrency[] | null;
  expiresAt: number;
}

const currencyCache = new Map<string, CacheEntry>();

/** Injectable seam so tests can run without network access. */
export interface AssetMetadataDeps {
  /** Resolve an issuer account's home domain, or null. */
  fetchHomeDomain(issuer: string): Promise<string | null>;
  /** Fetch raw TOML text for a domain, or null. */
  fetchToml(domain: string): Promise<string | null>;
  /** Current time in ms. */
  now(): number;
}

// ── TOML parsing (SEP-1 CURRENCIES subset) ──────────────────────

function parseTomlString(raw: string): string {
  const trimmed = raw.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'") && trimmed.length >= 2)
  ) {
    const inner = trimmed.slice(1, -1);
    return inner.replace(/\\\\"/g, '"').replace(/\\\\n/g, "\n").replace(/\\\\\\\\/g, "\\");
  }
  return trimmed;
}

/**
 * Extract `[[CURRENCIES]]` tables from a SEP-1 stellar.toml document.
 *
 * Deliberately minimal: a full TOML parser is unnecessary (and a dependency)
 * for the one table shape SEP-1 defines. Unknown keys and unrelated tables are
 * ignored. Malformed documents yield an empty list rather than an exception.
 */
export function parseTomlCurrencies(toml: string): TomlCurrency[] {
  if (typeof toml !== "string" || toml.length === 0) return [];

  const currencies: TomlCurrency[] = [];
  let current: TomlCurrency | null = null;

  for (const rawLine of toml.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith("#")) continue;

    const tableMatch = line.match(/^\[\[?\s*([A-Za-z0-9_.-]+)\s*\]?\]$/);
    if (tableMatch) {
      if (tableMatch[1] === "CURRENCIES" && line.startsWith("[[")) {
        current = { code: "" };
        currencies.push(current);
      } else if (line.startsWith("[[")) {
        current = null;
      }
      continue;
    }

    if (!current) continue;

    const kv = line.match(/^([A-Za-z0-9_-]+)\s*=\s*(.+)$/);
    if (!kv) continue;

    const key = kv[1]!;
    const value = parseTomlString(kv[2]!);

    switch (key) {
      case "code":
        current.code = value;
        break;
      case "issuer":
        current.issuer = value;
        break;
      case "name":
        current.name = value;
        break;
      case "desc":
        current.desc = value;
        break;
      case "display_decimals": {
        const n = Number(value);
        if (Number.isFinite(n) && n >= 0 && n <= 18) current.display_decimals = n;
        break;
      }
      default:
        break;
    }
  }

  return currencies.filter((c) => c.code.length > 0);
}

// ── Fetch helpers ──────────────────────────────────────────────

async function readCapped(res: Response, maxBytes: number): Promise<string> {
  const body = res.body;
  if (!body) {
    const text = await res.text();
    return text.length > maxBytes ? text.slice(0, maxBytes) : text;
  }
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let out = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    out += decoder.decode(value, { stream: true });
    if (total >= maxBytes) {
      try {
        await reader.cancel();
      } catch {
        /* ignore */
      }
      break;
    }
  }
  out += decoder.decode();
  return out;
}

/** Normalise a user/issuer-supplied home domain into a bare hostname. */
export function normalizeHomeDomain(raw: string): string | null {
  if (typeof raw !== "string") return null;
  let value = raw.trim().toLowerCase();
  if (value.length === 0) return null;
  value = value.replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/\.$/, "");
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(value)) return null;
  return value;
}

const defaultDeps: AssetMetadataDeps = {
  async fetchHomeDomain(issuer: string): Promise<string | null> {
    try {
      const url = `${DEFAULT_HORIZON_URL}/accounts/${encodeURIComponent(issuer)}`;
      const res = await withTimeout(
        fetch(url, { headers: { Accept: "application/json" } }),
        ASSET_METADATA_TIMEOUT_MS,
        "horizon account lookup timed out"
      );
      if (!res.ok) return null;
      const data = (await withTimeout(
        res.json(),
        ASSET_METADATA_TIMEOUT_MS,
        "horizon account read timed out"
      )) as { home_domain?: unknown };
      const home = typeof data.home_domain === "string" ? data.home_domain : null;
      return home ? normalizeHomeDomain(home) : null;
    } catch {
      return null;
    }
  },

  async fetchToml(domain: string): Promise<string | null> {
    try {
      const url = `https://${domain}/.well-known/stellar.toml`;
      if (!isSafeWebhookUrl(url)) return null;
      const res = await withTimeout(
        fetch(url, { headers: { Accept: "text/plain, application/toml" } }),
        ASSET_METADATA_TIMEOUT_MS,
        "stellar.toml fetch timed out"
      );
      if (!res.ok) return null;
      const text = await withTimeout(
        readCapped(res, ASSET_METADATA_MAX_BYTES),
        ASSET_METADATA_TIMEOUT_MS,
        "stellar.toml read timed out"
      );
      return text;
    } catch {
      return null;
    }
  },

  now: () => Date.now(),
};

// ── Public API ─────────────────────────────────────────────────

/** Cached per-domain currency list. `null` caches a negative result. */
async function getDomainCurrencies(
  domain: string,
  deps: AssetMetadataDeps
): Promise<TomlCurrency[] | null> {
  const cached = currencyCache.get(domain);
  const now = deps.now();
  if (cached && cached.expiresAt > now) return cached.value;

  const toml = await deps.fetchToml(domain);
  const value = toml === null ? null : parseTomlCurrencies(toml);
  currencyCache.set(domain, { value, expiresAt: now + ASSET_METADATA_TTL_MS });
  return value;
}

/**
 * Resolve display metadata for a custom asset from its issuer's SEP-1 TOML.
 *
 * Returns `null` when no metadata can be resolved — callers must degrade to
 * the raw code plus issuer. Never throws.
 */
export async function resolveAssetMetadata(
  code: string,
  issuer: string,
  deps: AssetMetadataDeps = defaultDeps
): Promise<ResolvedAssetMetadata | null> {
  if (!code || !issuer) return null;
  try {
    const domain = await deps.fetchHomeDomain(issuer);
    if (!domain) return null;

    const currencies = await getDomainCurrencies(domain, deps);
    if (!currencies || currencies.length === 0) return null;

    const upper = code.toUpperCase();
    const match =
      currencies.find(
        (c) => c.code.toUpperCase() === upper && (!c.issuer || c.issuer === issuer)
      ) ?? currencies.find((c) => c.code.toUpperCase() === upper);

    if (!match) return null;

    const name = match.name?.trim() || match.desc?.trim() || match.code;
    return {
      domain,
      name,
      ...(match.desc ? { description: match.desc } : {}),
      ...(match.display_decimals !== undefined
        ? { displayDecimals: match.display_decimals }
        : {}),
    };
  } catch {
    return null;
  }
}

/** Build the display label for an asset: resolved name, else raw code. */
export function formatAssetDisplayName(
  code: string,
  metadata: ResolvedAssetMetadata | null
): string {
  const upper = code.toUpperCase();
  if (metadata && metadata.name) return `${metadata.name} (${upper})`;
  return upper;
}

/** Test/ops helper: drop cached metadata (optionally for one domain). */
export function clearAssetMetadataCache(domain?: string): void {
  if (domain) currencyCache.delete(domain);
  else currencyCache.clear();
}
