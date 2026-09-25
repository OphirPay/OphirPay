"use client";
// SPDX-License-Identifier: MIT

/**
 * Client hook + component for resolving a custom asset's SEP-1 display name.
 *
 * Calls GET /api/asset-metadata and degrades silently to null so callers can
 * fall back to the raw code + issuer. Native assets (no issuer) are never
 * resolved through SEP-1.
 */

import { useEffect, useState } from "react";
import { STELLAR_NETWORK } from "@/lib/stellar";
import type { AssetInfo } from "@/lib/assets";

export interface UseResolvedAssetResult {
  /** Resolved display name, or null when unavailable/pending. */
  name: string | null;
  /** True while the first request is in flight. */
  loading: boolean;
}

/**
 * Resolve the SEP-1 display name for a non-native asset. Returns
 * `{ name: null, loading: false }` immediately for native assets or when the
 * asset has no issuer.
 */
export function useResolvedAssetName(asset: AssetInfo): UseResolvedAssetResult {
  const [name, setName] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const issuer = asset.issuer;
  const code = asset.code;
  const type = asset.type;

  useEffect(() => {
    if (type === "native" || !issuer) {
      setName(null);
      return;
    }

    let cancelled = false;
    setLoading(true);

    const params = new URLSearchParams({
      code,
      issuer,
      network: STELLAR_NETWORK,
    });

    fetch(`/api/asset-metadata?${params.toString()}`)
      .then((res) => (res.ok ? res.json() : null))
      .then(
        (json: { data?: { metadata?: { name?: string } | null } } | null) => {
          if (cancelled) return;
          setName(json?.data?.metadata?.name ?? null);
        },
      )
      .catch(() => {
        if (!cancelled) setName(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [code, issuer, type]);

  return { name, loading };
}

interface ResolvedAssetNameProps {
  asset: AssetInfo;
  /** Fallback label shown when no metadata resolves (e.g. asset.displayName). */
  fallback?: string;
  className?: string;
}

/**
 * Renders the resolved SEP-1 name for an asset. Falls back to `fallback` (or
 * the asset's existing displayName) when unresolved. The issuer is exposed on
 * demand via the title tooltip for non-native assets.
 */
export function ResolvedAssetName({
  asset,
  fallback,
  className,
}: ResolvedAssetNameProps) {
  const { name, loading } = useResolvedAssetName(asset);
  const shown = name ?? fallback ?? asset.displayName;

  const title =
    asset.type !== "native" && asset.issuer
      ? `Issuer: ${asset.issuer}`
      : undefined;

  return (
    <span
      className={className}
      title={title}
      data-resolved={name ? "true" : "false"}
      data-loading={loading ? "true" : "false"}
    >
      {shown}
    </span>
  );
}
