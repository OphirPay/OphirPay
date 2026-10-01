// SPDX-License-Identifier: MIT

/**
 * Asset metadata resolution from an issuer's SEP-1 `stellar.toml` (issue #824).
 *
 * Custom Stellar assets are identified only by `code` + `issuer`, so a user
 * reviewing a batch sees an opaque `G…` address where a named asset would be.
 * Stellar's standard mechanism for this is the issuing account's home domain:
 * the account record carries a `home_domain`, and that domain publishes a
 * `stellar.toml` whose `[[CURRENCIES]]` entries carry the human metadata.
 *
 * This module:
 *
 *   • resolves the issuer's home domain through Horizon,
 *   • fetches and parses `https://<domain>/.well-known/stellar.toml` through the
 *     SDK resolver (which enforces a timeout and the protocol 100 KiB size cap,
 *     `STELLAR_TOML_MAX_SIZE`),
 *   • runs the same DNS/URL safety guard the webhook pipeline uses, so a
 *     malicious issuer cannot point us at an internal address,
 *   • caches the parsed TOML **per issuer domain** (with a TTL) so every asset
 *     from one issuer shares a single fetch, and
 *   • degrades to `{ code, issuer }` — never throwing, never surfacing an error
 *     — when metadata is unknown or unreachable.
 */

import { StellarToml } from "@stellar/stellar-sdk";
import { getHorizonServer } from "@/lib/stellar";
import { getStellarTimeoutMs } from "@/lib/timeout";
import { isSafeWebhookUrlAtDelivery } from "@/lib/webhook-url-guard";
import { logger } from "@/lib/logger";

// ── Types ──────────────────────────────────────────────────────

/** A `[[CURRENCIES]]` entry (only the fields we consume). */
export interface TomlCurrency {
  code?: string;
  issuer?: string;
  name?: string;
  desc?: string;
  image?: string;
  display_decimals?: number;
}

/** The subset of a parsed `stellar.toml` we depend on. */
export interface StellarTomlDocument {
  CURRENCIES?: TomlCurrency[];
  DOCUMENTATION?: { ORG_NAME?: string };
  [key: string]: unknown;
}

/** Where the resolved metadata came from. */
export type AssetMetadataSource = "toml" | "cache" | "fallback";

export interface ResolvedAssetMetadata {
  code: string;
  issuer: string;
  /** Human display name from the TOML, or null when unknown. */
  name: string | null;
  description: string | null;
  image: string | null;
  /** Decimals from `display_decimals`, or null. */
  decimals: number | null;
  /** Publisher / organisation name from the TOML `DOCUMENTATION`. */
  orgName: string | null;
  /** Issuer's home domain, when one was resolved. */
  homeDomain: string | null;
  source: AssetMetadataSource;
  /** When the underlying TOML was sampled (ISO-8601). */
  fetchedAt: string;
}

/** Injectable dependencies, so the network is never hit in unit tests. */
export interface AssetMetadataDependencies {
  /** Resolve an issuer account's `home_domain`. */
  fetchHomeDomain?: (issuer: string) => Promise<string | null>;
  /** Fetch + parse the issuer domain's `stellar.toml`. */
  resolveToml?: (domain: string, timeoutMs: number) => Promise<StellarTomlDocument>;
  /** DNS/URL safety guard for the outbound TOML fetch. */
  isSafeDomain?: (url: string) => Promise<boolean>;
  /** Clock, for deterministic cache/TTL tests. */
  now?: () => number;
}

// ── Configuration ──────────────────────────────────────────────

/** How long a parsed TOML document may be served before refetching. */
export const DEFAULT_ASSET_METADATA_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

/** How long an issuer→home-domain mapping may be reused. */
export const DEFAULT_HOME_DOMAIN_TTL_MS = 60 * 60 * 1000; // 1 hour

/** Read a positive integer TTL from the environment. */
function readTtlEnv(name: string, fallback: number): number {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

export function getAssetMetadataTtlMs(): number {
  return readTtlEnv("ASSET_METADATA_TTL_MS", DEFAULT_ASSET_METADATA_TTL_MS);
}

export function getHomeDomainTtlMs(): number {
  return readTtlEnv("HOME_DOMAIN_TTL_MS", DEFAULT_HOME_DOMAIN_TTL_MS);
}

/** The SEP-1 discovery URL for a home domain. */
export function stellarTomlUrl(domain: string): string {
  return `https://${domain}/.well-known/stellar.toml`;
}

// ── Caches (per issuer domain) ─────────────────────────────────

interface TomlCacheEntry {
  toml: StellarTomlDocument;
  at: number;
}

let tomlCache = new Map<string, TomlCacheEntry>();
let homeDomainCache = new Map<string, { domain: string | null; at: number }>();

/** Clear caches between tests. */
export function resetAssetMetadataCache(): void {
  tomlCache = new Map();
  homeDomainCache = new Map();
}

// ── Default dependencies ───────────────────────────────────────

async function defaultFetchHomeDomain(issuer: string): Promise<string | null> {
  const account = await getHorizonServer().loadAccount(issuer);
  const domain = (account as unknown as { home_domain?: string }).home_domain;
  return domain && domain.trim() !== "" ? domain.trim() : null;
}

async function defaultResolveToml(
  domain: string,
  timeoutMs: number
): Promise<StellarTomlDocument> {
  // `Resolver.resolve` only talks HTTP(S), caps the body at the protocol
  // `STELLAR_TOML_MAX_SIZE` (100 KiB) and honours the timeout budget.
  return (await StellarToml.Resolver.resolve(domain, {
    allowHttp: false,
    timeout: timeoutMs,
  })) as unknown as StellarTomlDocument;
}

// ── Resolution ─────────────────────────────────────────────────

/** A degraded result with no metadata — code + issuer only. */
function fallbackMetadata(
  code: string,
  issuer: string,
  homeDomain: string | null,
  source: AssetMetadataSource,
  at: number
): ResolvedAssetMetadata {
  return {
    code,
    issuer,
    name: null,
    description: null,
    image: null,
    decimals: null,
    orgName: null,
    homeDomain,
    source,
    fetchedAt: new Date(at).toISOString(),
  };
}

async function getHomeDomain(
  issuer: string,
  deps: Required<Pick<AssetMetadataDependencies, "fetchHomeDomain">> &
    Pick<AssetMetadataDependencies, "now">,
  now: number
): Promise<string | null> {
  const ttl = getHomeDomainTtlMs();
  const cached = homeDomainCache.get(issuer);
  if (cached && now - cached.at < ttl) return cached.domain;

  const domain = await deps.fetchHomeDomain(issuer);
  homeDomainCache.set(issuer, { domain, at: now });
  return domain;
}

async function getToml(
  domain: string,
  deps: Required<
    Pick<AssetMetadataDependencies, "resolveToml" | "isSafeDomain">
  >,
  now: number
): Promise<{ toml: StellarTomlDocument; cached: boolean; at: number }> {
  const ttl = getAssetMetadataTtlMs();
  const cached = tomlCache.get(domain);
  if (cached && now - cached.at < ttl) {
    return { toml: cached.toml, cached: true, at: cached.at };
  }

  const url = stellarTomlUrl(domain);
  if (!(await deps.isSafeDomain(url))) {
    throw new Error(`TOML domain rejected by the URL guard: ${domain}`);
  }

  const toml = await deps.resolveToml(domain, getStellarTimeoutMs());
  tomlCache.set(domain, { toml, at: now });
  return { toml, cached: false, at: now };
}

/**
 * Resolve display metadata for a `code`/`issuer` pair.
 *
 * Never throws: an unknown issuer, unreachable/unparseable TOML, an unsafe
 * domain or a missing currency entry all produce a `fallback` result the UI
 * can render as "code + issuer" without an error surface.
 *
 * @param asset  The asset to resolve (`code` + `issuer`).
 * @param deps   Optional injected dependencies (tests).
 */
export async function resolveAssetMetadata(
  asset: { code: string; issuer: string },
  deps: AssetMetadataDependencies = {}
): Promise<ResolvedAssetMetadata> {
  const { code, issuer } = asset;
  const now = deps.now?.() ?? Date.now();
  const fetchHomeDomain = deps.fetchHomeDomain ?? defaultFetchHomeDomain;
  const resolveToml = deps.resolveToml ?? defaultResolveToml;
  const isSafeDomain = deps.isSafeDomain ?? isSafeWebhookUrlAtDelivery;

  let homeDomain: string | null = null;
  try {
    homeDomain = await getHomeDomain(issuer, { fetchHomeDomain, now: deps.now }, now);
  } catch (err) {
    logger.warn("Asset metadata: home domain lookup failed", {
      issuer,
      error: err instanceof Error ? err.message : String(err),
    });
    return fallbackMetadata(code, issuer, null, "fallback", now);
  }

  if (!homeDomain) return fallbackMetadata(code, issuer, null, "fallback", now);

  try {
    const { toml, cached, at } = await getToml(
      homeDomain,
      { resolveToml, isSafeDomain },
      now
    );

    const currencies = Array.isArray(toml.CURRENCIES) ? toml.CURRENCIES : [];
    const currency = currencies.find(
      (c) =>
        typeof c?.code === "string" &&
        c.code.toUpperCase() === code.toUpperCase() &&
        (!c.issuer || c.issuer === issuer)
    );

    if (!currency) {
      return fallbackMetadata(code, issuer, homeDomain, "fallback", at);
    }

    return {
      code,
      issuer,
      name: currency.name ?? null,
      description: currency.desc ?? null,
      image: currency.image ?? null,
      decimals:
        typeof currency.display_decimals === "number"
          ? currency.display_decimals
          : null,
      orgName: toml.DOCUMENTATION?.ORG_NAME ?? null,
      homeDomain,
      source: cached ? "cache" : "toml",
      fetchedAt: new Date(at).toISOString(),
    };
  } catch (err) {
    logger.warn("Asset metadata: TOML resolution failed", {
      issuer,
      homeDomain,
      error: err instanceof Error ? err.message : String(err),
    });
    return fallbackMetadata(code, issuer, homeDomain, "fallback", now);
  }
}

/**
 * Render an asset for display: `Name (CODE)` when a name resolved, otherwise
 * the raw `CODE`. The issuer stays available separately, on demand.
 */
export function formatAssetDisplay(
  metadata: Pick<ResolvedAssetMetadata, "code" | "name">
): string {
  return metadata.name ? `${metadata.name} (${metadata.code})` : metadata.code;
}
