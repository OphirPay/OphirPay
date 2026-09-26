// SPDX-License-Identifier: MIT

/**
 * Multi-asset support for Stellar payments beyond native XLM.
 * Includes USDC on Stellar and custom token validation helpers.
 */

export interface AssetInfo {
  code: string;
  issuer?: string;
  type: "native" | "credit_alphanum4" | "credit_alphanum12";
  displayName: string;
  decimals: number;
}

// ── Known Assets ───────────────────────────────────────────────

/** Stellar USDC (Centre Consortium) — Testnet & Mainnet */
export const USDC_TESTNET: AssetInfo = {
  code: "USDC",
  issuer: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
  type: "credit_alphanum4",
  displayName: "USDC (Testnet)",
  decimals: 7,
};

export const USDC_MAINNET: AssetInfo = {
  code: "USDC",
  issuer: "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
  type: "credit_alphanum4",
  displayName: "USDC",
  decimals: 7,
};

/** Native XLM */
export const XLM_ASSET: AssetInfo = {
  code: "XLM",
  type: "native",
  displayName: "Stellar Lumens",
  decimals: 7,
};

// ── Helpers ────────────────────────────────────────────────────

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

// ── Display labels (SEP-1 metadata aware) ─────────────────────

export interface AssetDisplayParts {
  /** Primary label — resolved metadata name when available, else the code. */
  title: string;
  /** Secondary label — the code when a name resolved, else the short issuer. */
  subtitle: string;
}

/**
 * Compact issuer label for display: "GABCD…WXYZ". Returns "" for empty input.
 */
export function shortenAssetIssuer(issuer: string, chars = 5): string {
  if (!issuer) return "";
  if (issuer.length <= chars * 2 + 3) return issuer;
  return `${issuer.slice(0, chars)}…${issuer.slice(-chars)}`;
}

/**
 * Build display labels for an asset whose SEP-1 metadata may or may not have
 * resolved (see src/lib/asset-metadata.ts). When a name resolved, show it
 * alongside the code; otherwise degrade to the raw code plus a shortened
 * issuer so a custom asset never renders as a bare opaque address.
 */
export function getAssetDisplayParts(
  code: string,
  issuer?: string | null,
  metadataName?: string | null,
): AssetDisplayParts {
  if (metadataName) {
    return { title: metadataName, subtitle: code };
  }
  if (issuer) {
    return { title: code, subtitle: shortenAssetIssuer(issuer) };
  }
  return { title: code, subtitle: "" };
}
