// SPDX-License-Identifier: MIT

/**
 * Browser-side helper for asset metadata (issue #824).
 *
 * The actual resolution runs server-side (`GET /api/assets/metadata`) so the
 * outbound TOML fetch goes through the shared timeout, size limit and DNS/URL
 * guard — that module imports Node built-ins and must never reach the client
 * bundle. This thin wrapper only talks to our own API and caches results in
 * memory for the lifetime of the page.
 */

export interface ClientAssetMetadata {
  code: string;
  issuer: string;
  name: string | null;
  description: string | null;
  image: string | null;
  decimals: number | null;
  orgName: string | null;
  homeDomain: string | null;
  source: "toml" | "cache" | "fallback";
  fetchedAt: string;
}

const cache = new Map<string, ClientAssetMetadata | null>();

/** Clear the in-memory cache (used by tests). */
export function clearAssetMetadataClientCache(): void {
  cache.clear();
}

/**
 * Resolve metadata for an asset. Returns `null` on any failure so callers can
 * fall back to the raw code + issuer without an error surface.
 */
export async function fetchAssetMetadata(
  code: string,
  issuer: string
): Promise<ClientAssetMetadata | null> {
  const key = `${code}:${issuer}`;
  if (cache.has(key)) return cache.get(key) ?? null;

  try {
    const params = new URLSearchParams({ code, issuer });
    const res = await fetch(`/api/assets/metadata?${params.toString()}`);
    if (!res.ok) {
      cache.set(key, null);
      return null;
    }
    const json = (await res.json()) as {
      success?: boolean;
      data?: ClientAssetMetadata;
    };
    const data = json?.success ? (json.data ?? null) : null;
    cache.set(key, data);
    return data;
  } catch {
    // Network error — degrade silently; the caller renders code + issuer.
    return null;
  }
}
