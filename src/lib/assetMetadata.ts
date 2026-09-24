import { Asset } from "./assets";
import { fetchWithTimeout, FETCH_SIZE_LIMIT, FETCH_TIMEOUT_MS } from "./timeout";
import toml from "toml";
import { Horizon } from "stellar-sdk";

// Simple in‑memory cache per domain
interface CacheEntry {
  metadata: AssetMetadata | null;
  expires: number;
}
const cache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

export interface AssetMetadata {
  code: string;
  issuer: string;
  name?: string;
  issuerName?: string;
}

/**
 * Resolve metadata for a custom asset.
 * @param asset Stellar asset (code + issuer)
 * @returns AssetMetadata with optional name fields
 */
export async function resolveAssetMetadata(asset: Asset): Promise<AssetMetadata> {
  if (asset.isNative) {
    return {
      code: "XLM",
      issuer: "",
      name: "Stellar Lumens",
      issuerName: "Stellar",
    };
  }

  const domain = await getHomeDomain(asset.issuer);
  if (!domain) {
    return { code: asset.code, issuer: asset.issuer };
  }

  const cacheKey = domain;
  const now = Date.now();
  const cached = cache.get(cacheKey);
  if (cached && cached.expires > now) {
    return cached.metadata ?? { code: asset.code, issuer: asset.issuer };
  }

  const url = `https://${domain}/.well-known/stellar.toml`;
  let tomlText: string | null = null;
  try {
    tomlText = await fetchWithTimeout(url, {
      method: "GET",
      headers: { "Accept": "text/plain" },
      timeout: FETCH_TIMEOUT_MS,
      sizeLimit: FETCH_SIZE_LIMIT,
    });
  } catch (e) {
    // Any fetch error results in fallback
    cache.set(cacheKey, { metadata: null, expires: now + CACHE_TTL_MS });
    return { code: asset.code, issuer: asset.issuer };
  }

  if (!tomlText) {
    cache.set(cacheKey, { metadata: null, expires: now + CACHE_TTL_MS });
    return { code: asset.code, issuer: asset.issuer };
  }

  let parsed: any;
  try {
    parsed = toml.parse(tomlText);
  } catch {
    cache.set(cacheKey, { metadata: null, expires: now + CACHE_TTL_MS });
    return { code: asset.code, issuer: asset.issuer };
  }

  const currencies: any[] = parsed?.CURRENCIES ?? [];
  const entry = currencies.find(
    (c) => c.code === asset.code && c.issuer === asset.issuer
  );

  const metadata: AssetMetadata = {
    code: asset.code,
    issuer: asset.issuer,
  };

  if (entry) {
    metadata.name = entry.name;
    metadata.issuerName = entry.issuer_name ?? entry.issuer;
  }

  cache.set(cacheKey, { metadata, expires: now + CACHE_TTL_MS });
  return metadata;
}

/**
 * Fetch the home_domain for an account via Horizon.
 * @param issuer Public key of the issuing account
 */
async function getHomeDomain(issuer: string): Promise<string | null> {
  try {
    const horizon = new Horizon.Server(process.env.NEXT_PUBLIC_HORIZON_URL ?? "https://horizon.stellar.org");
    const account = await horizon.accounts().accountId(issuer).call();
    return account.home_domain ?? null;
  } catch {
    return null;
  }
}
