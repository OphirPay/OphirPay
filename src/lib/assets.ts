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

/** Stellar EURC — Testnet & Mainnet */
export const EURC_TESTNET: AssetInfo = {
  code: "EURC",
  issuer: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
  type: "credit_alphanum4",
  displayName: "EURC (Testnet)",
  decimals: 7,
};

export const EURC_MAINNET: AssetInfo = {
  code: "EURC",
  issuer: "GDHU6WRG4IEQXM5NZ4BMPKOXHW76MZM4Y2IEMFDVXBS3OIQDNO4STTVU",
  type: "credit_alphanum4",
  displayName: "EURC",
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

/** Get network-aware USDC asset info */
export function getKnownUsdcAsset(network: "TESTNET" | "PUBLIC" = "TESTNET"): AssetInfo {
  return network === "PUBLIC" ? USDC_MAINNET : USDC_TESTNET;
}

/** Get network-aware EURC asset info */
export function getKnownEurcAsset(network: "TESTNET" | "PUBLIC" = "TESTNET"): AssetInfo {
  return network === "PUBLIC" ? EURC_MAINNET : EURC_TESTNET;
}

/** Get list of primary known supported assets */
export function getKnownAssets(network: "TESTNET" | "PUBLIC" = "TESTNET"): AssetInfo[] {
  return [XLM_ASSET, getKnownUsdcAsset(network), getKnownEurcAsset(network)];
}

/** Get the known asset info for a given asset code (defaults to XLM). */
export function getAssetInfo(code: string, issuer?: string): AssetInfo {
  const upper = code.toUpperCase();
  if (upper === "XLM" || upper === "NATIVE") return XLM_ASSET;
  if (upper === "USDC") {
    if (issuer) {
      return {
        code: "USDC",
        issuer,
        type: "credit_alphanum4",
        displayName: "USDC",
        decimals: 7,
      };
    }
    return USDC_TESTNET;
  }
  if (upper === "EURC") {
    if (issuer) {
      return {
        code: "EURC",
        issuer,
        type: "credit_alphanum4",
        displayName: "EURC",
        decimals: 7,
      };
    }
    return EURC_TESTNET;
  }
  const type = upper.length <= 4 ? "credit_alphanum4" : "credit_alphanum12";
  return { code: upper, issuer, type, displayName: upper, decimals: 7 };
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

/** Format an asset identifier string (e.g. "XLM" or "USDC:GBBD...") */
export function formatAssetIdentifier(code: string, issuer?: string): string {
  const upper = code.toUpperCase();
  if (upper === "XLM" || upper === "NATIVE" || !issuer) {
    return upper;
  }
  return `${upper}:${issuer}`;
}

/** Parse an asset identifier string (e.g. "XLM", "USDC:GBBD...", "COOL:GABC...") */
export function parseAssetIdentifier(
  identifier: string,
  defaultNetwork: "TESTNET" | "PUBLIC" = "TESTNET"
): AssetInfo | null {
  const trimmed = identifier.trim();
  if (!trimmed) return null;
  if (trimmed.toUpperCase() === "XLM" || trimmed.toLowerCase() === "native") {
    return XLM_ASSET;
  }

  const parts = trimmed.split(":");
  if (parts.length === 1) {
    const code = parts[0].toUpperCase();
    if (code === "USDC") return getKnownUsdcAsset(defaultNetwork);
    if (code === "EURC") return getKnownEurcAsset(defaultNetwork);
    if (!/^[A-Za-z0-9]{1,12}$/.test(code)) return null;
    return {
      code,
      type: code.length <= 4 ? "credit_alphanum4" : "credit_alphanum12",
      displayName: code,
      decimals: 7,
    };
  }

  if (parts.length === 2) {
    const [codeRaw, issuerRaw] = parts;
    const code = codeRaw.trim().toUpperCase();
    const issuer = issuerRaw.trim();
    if (!/^[A-Za-z0-9]{1,12}$/.test(code)) return null;
    if (!isValidAssetIssuer(issuer)) return null;
    return {
      code,
      issuer,
      type: code.length <= 4 ? "credit_alphanum4" : "credit_alphanum12",
      displayName: code,
      decimals: 7,
    };
  }

  return null;
}

/** Check if two asset definitions refer to the exact same asset */
export function areAssetsEqual(
  a: { code: string; issuer?: string; type?: string },
  b: { code: string; issuer?: string; type?: string }
): boolean {
  const isNativeA = a.code.toUpperCase() === "XLM" || a.type === "native" || !a.issuer;
  const isNativeB = b.code.toUpperCase() === "XLM" || b.type === "native" || !b.issuer;
  if (isNativeA && isNativeB) return true;
  if (isNativeA !== isNativeB) return false;
  return a.code.toUpperCase() === b.code.toUpperCase() && a.issuer === b.issuer;
}

