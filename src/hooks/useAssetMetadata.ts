"use client";
// SPDX-License-Identifier: MIT

import { useEffect, useState } from "react";
import { isValidAssetIssuer } from "@/lib/assets";

/**
 * Matches ASSET_METADATA_CACHE_TTL_MS in src/lib/asset-metadata.ts. Duplicated
 * here because that module is server-only (it transitively imports node:net
 * via the webhook URL guard) and must not enter the client bundle.
 */
const METADATA_STALE_TIME_MS = 5 * 60_000;

export interface AssetMetadata {
  resolved: boolean;
  name: string | null;
  domain: string | null;
  displayDecimals: number | null;
}

interface CacheEntry {
  fetchedAt: number;
  value: AssetMetadata | null;
}

// Module-level cache + in-flight dedup. Deliberately not react-query: the
// AssetSelector is rendered by pages and tests that may not be wrapped in a
// QueryClientProvider, and metadata is shared app-wide anyway.
const metadataCache = new Map<string, CacheEntry>();
const pendingFetches = new Map<string, Promise<AssetMetadata | null>>();

function readCache(key: string): AssetMetadata | null | undefined {
  const entry = metadataCache.get(key);
  if (!entry) return undefined;
  if (Date.now() - entry.fetchedAt >= METADATA_STALE_TIME_MS) return undefined;
  return entry.value;
}

async function fetchMetadata(code: string, issuer: string): Promise<AssetMetadata | null> {
  const key = `${code}:${issuer}`;
  const pending = pendingFetches.get(key);
  if (pending) return pending;

  const promise = (async (): Promise<AssetMetadata | null> => {
    try {
      const res = await fetch(
        `/api/asset-metadata?code=${encodeURIComponent(code)}&issuer=${encodeURIComponent(issuer)}`,
      );
      if (!res.ok) return null;
      const json = (await res.json()) as { data?: AssetMetadata };
      return json.data ?? null;
    } catch {
      // Degrade silently — the UI falls back to code + issuer.
      return null;
    }
  })();

  pendingFetches.set(key, promise);
  try {
    const value = await promise;
    metadataCache.set(key, { fetchedAt: Date.now(), value });
    return value;
  } finally {
    pendingFetches.delete(key);
  }
}

/**
 * Resolve SEP-1 display metadata for a custom asset via
 * GET /api/asset-metadata (server-side TOML resolution with per-domain
 * caching). Returns null while loading, on error, or when the asset has no
 * resolvable issuer — callers always fall back to code + issuer display.
 *
 * Native/known assets need no lookup: pass no issuer and the hook stays idle.
 */
export function useAssetMetadata(
  code: string | undefined,
  issuer: string | null | undefined,
): { metadata: AssetMetadata | null; isLoading: boolean } {
  const enabled = Boolean(code && issuer && isValidAssetIssuer(issuer));
  const key = `${code ?? ""}:${issuer ?? ""}`;

  const [metadata, setMetadata] = useState<AssetMetadata | null>(() =>
    enabled ? (readCache(key) ?? null) : null,
  );
  const [isLoading, setIsLoading] = useState(
    () => enabled && readCache(key) === undefined,
  );

  useEffect(() => {
    if (!enabled) {
      setMetadata(null);
      setIsLoading(false);
      return;
    }

    const cached = readCache(key);
    if (cached !== undefined) {
      setMetadata(cached);
      setIsLoading(false);
      return;
    }

    let cancelled = false;
    setIsLoading(true);
    fetchMetadata(code!, issuer!).then((value) => {
      if (cancelled) return;
      setMetadata(value);
      setIsLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [enabled, key, code, issuer]);

  return { metadata, isLoading };
}
