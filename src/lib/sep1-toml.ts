// SPDX-License-Identifier: MIT

/**
 * SEP-1 stellar.toml asset metadata resolution.
 *
 * Custom Stellar assets are identified only by (code, issuer). Stellar's SEP-1
 * convention lets an issuing account publish a `stellar.toml` at
 * `https://<home_domain>/.well-known/stellar.toml` whose `[[CURRENCIES]]`
 * sections carry the human-readable `name`, `desc`, and display decimals.
 *
 * This module resolves that metadata so the UI can show "Circle USD (USDC)"
 * instead of a bare code, and falls back to the raw code on any failure —
 * metadata is a display enhancement, never a hard dependency.
 *
 * Security: the home domain comes from the network, so the request goes through
 * the same SSRF guard used for webhooks, and redirects are not followed.
 */

import { isSafeWebhookUrl } from "./webhook-url-guard";

export interface Sep1Currency {
  code: string;
  issuer?: string;
  name?: string;
  desc?: string;
  decimals?: number;
  displayDecimals?: number;
  isAssetAnchored?: boolean;
  anchorAsset?: string;
}

export interface Sep1Toml {
  currencies: Sep1Currency[];
  orgName?: string;
}

export interface ResolvedAssetMetadata {
  code: string;
  issuer?: string;
  name?: string;
  desc?: string;
  decimals: number;
  source: "sep1" | "fallback";
}

export interface ResolveAssetMetadataOptions {
  /** Override the TOML fetch (used by tests). */
  fetchImpl?: typeof fetch;
  /** Cache TTL in ms. Defaults to 30 minutes. */
  ttlMs?: number;
  /** Request timeout in ms. Defaults to 5000. */
  timeoutMs?: number;
  /** Injectable clock (used by tests). */
  now?: () => number;
}

const DEFAULT_TTL_MS = 30 * 60 * 1000;
const DEFAULT_TIMEOUT_MS = 5000;

/** Minimal, dependency-free slice of TOML needed for `[[CURRENCIES]]` tables. */
export function parseStellarToml(input: string): Sep1Toml {
  const result: Sep1Toml = { currencies: [] };
  let current: Sep1Currency | null = null;
  let section: "none" | "currency" | "doc" = "none";

  for (const rawLine of input.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const table = line.match(/^\[\[?\s*([A-Za-z0-9_.-]+)\s*\]?\]$/);
    if (table) {
      const name = table[1]!.toUpperCase();
      if (name === "CURRENCIES" || name === "CURRENCY") {
        current = { code: "" };
        result.currencies.push(current);
        section = "currency";
      } else if (name === "DOCUMENTATION") {
        section = "doc";
      } else {
        section = "none";
      }
      continue;
    }

    const kv = line.match(/^([A-Za-z0-9_-]+)\s*=\s*(.+)$/);
    if (!kv) continue;
    const key = kv[1]!.toLowerCase();
    const value = unquote(kv[2]!.trim());

    if (section === "currency" && current) {
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
        case "display_decimals":
          current.displayDecimals = toInt(value);
          break;
        case "decimals":
          current.decimals = toInt(value);
          break;
        case "is_asset_anchored":
          current.isAssetAnchored = value.toLowerCase() === "true";
          break;
        case "anchor_asset":
          current.anchorAsset = value;
          break;
        default:
          break;
      }
    } else if (section === "doc" && key === "org_name" && !result.orgName) {
      result.orgName = value;
    }
  }

  result.currencies = result.currencies.filter((c) => c.code.length > 0);
  return result;
}

function unquote(value: string): string {
  const m = value.match(/^"(.*)"$/s) ?? value.match(/^'(.*)'$/s);
  return m ? m[1]! : value;
}

function toInt(value: string): number | undefined {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : undefined;
}

interface CacheEntry {
  value: Sep1Toml;
  expiresAt: number;
}

const tomlCache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<Sep1Toml>>();

/** Clears the module cache. Exported for tests and for forced refreshes. */
export function clearSep1Cache(): void {
  tomlCache.clear();
  inflight.clear();
}

export function sep1TomlUrl(homeDomain: string): string {
  const host = homeDomain.trim().replace(/^https?:\/\//i, "").replace(/\/+$/, "");
  return `https://${host}/.well-known/stellar.toml`;
}

/** Fetch and parse an issuer's stellar.toml, with TTL caching and timeout. */
export async function fetchSep1Toml(
  homeDomain: string,
  options: ResolveAssetMetadataOptions = {},
): Promise<Sep1Toml | null> {
  const now = options.now ?? Date.now;
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const fetchImpl = options.fetchImpl ?? fetch;

  const url = sep1TomlUrl(homeDomain);
  if (!isSafeWebhookUrl(url)) return null;

  const cached = tomlCache.get(url);
  if (cached && cached.expiresAt > now()) return cached.value;

  const pending = inflight.get(url);
  if (pending) return pending;

  const request = (async (): Promise<Sep1Toml> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(url, {
        signal: controller.signal,
        redirect: "error",
        headers: { accept: "text/plain, application/toml, */*" },
      });
      if (!response.ok) return { currencies: [] };
      const text = await response.text();
      return parseStellarToml(text);
    } catch {
      // Unreachable domain, timeout, TLS failure, blocked redirect — all degrade
      // to "no metadata", never to a failed payment flow.
      return { currencies: [] };
    } finally {
      clearTimeout(timer);
      inflight.delete(url);
    }
  })();

  inflight.set(url, request);
  const toml = await request;
  if (toml.currencies.length > 0) {
    tomlCache.set(url, { value: toml, expiresAt: now() + ttlMs });
  }
  return toml;
}

/**
 * Resolve display metadata for a (code, issuer) pair from the issuer's SEP-1
 * TOML. Always resolves — falling back to the raw code when nothing is found,
 * so callers can render unconditionally.
 */
export async function resolveAssetMetadata(
  code: string,
  issuer: string | undefined,
  homeDomain: string | undefined,
  options: ResolveAssetMetadataOptions = {},
): Promise<ResolvedAssetMetadata> {
  const upper = code.toUpperCase();
  const fallback: ResolvedAssetMetadata = {
    code: upper,
    issuer,
    decimals: 7,
    source: "fallback",
  };

  if (!homeDomain) return fallback;

  const toml = await fetchSep1Toml(homeDomain, options);
  if (!toml) return fallback;

  const match = toml.currencies.find(
    (c) => c.code.toUpperCase() === upper && (!issuer || !c.issuer || c.issuer === issuer),
  );
  if (!match) return fallback;

  return {
    code: upper,
    issuer,
    name: match.name,
    desc: match.desc,
    decimals: match.displayDecimals ?? match.decimals ?? 7,
    source: "sep1",
  };
}

/** Display label: "Name (CODE)" when metadata exists, else the raw code. */
export function formatAssetLabel(metadata: ResolvedAssetMetadata): string {
  if (!metadata.name || metadata.name.toUpperCase() === metadata.code) {
    return metadata.code;
  }
  return `${metadata.name} (${metadata.code})`;
}
