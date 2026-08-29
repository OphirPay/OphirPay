// SPDX-License-Identifier: MIT

/**
 * Multi-asset balance aggregation service for the OphirPay Treasury Dashboard.
 *
 * Features:
 * - Aggregates balances across multiple wallets (Stellar accounts)
 * - Supports native XLM, known stablecoins (USDC, EURC), and arbitrary custom tokens
 * - Full trustline status tracking (hasTrustline, limit, authorization)
 * - Error containment: untrusted assets or missing trustlines do not crash the aggregation
 * - In-memory caching with short TTL (30s) + on-demand cache refresh bypass
 * - Precise 7-decimal fixed-point arithmetic for Stellar amounts
 */

import { getHorizonServer, isAccountNotFound, isValidStellarAddress, STELLAR_NETWORK } from "@/lib/stellar";
import {
  AssetInfo,
  XLM_ASSET,
  getKnownAssets,
  formatAssetAmount,
  formatAssetIdentifier,
  parseAssetIdentifier,
  isValidAssetIssuer,
} from "@/lib/assets";
import { cacheGet, cacheSet, cacheDelete } from "@/lib/api-cache";
import type {
  TreasuryMultiAssetBalancesResponse,
  TreasuryAssetAggregation,
  TreasuryWalletDetail,
  WalletAssetBalance,
  TreasuryBalanceSummary,
} from "@/types";

export const TREASURY_CACHE_TTL_MS = 30_000; // 30 seconds TTL
export const TREASURY_CACHE_PREFIX = "treasury:balances";

export interface WalletQueryInput {
  publicKey: string;
  name?: string;
  id?: string;
}

export interface TreasuryBalancesOptions {
  refresh?: boolean;
  includeAllDiscovered?: boolean;
  targetAssets?: (string | AssetInfo)[];
  ttlMs?: number;
}

// ── Precise 7-decimal Arithmetic ───────────────────────────────

const STROOP_FACTOR = BigInt(10000000);
const BIGINT_ZERO = BigInt(0);

/** Parse a Stellar amount string into integer stroops (bigint) */
export function parseAmountToStroops(amount: string | number): bigint {
  const str = typeof amount === "number" ? amount.toFixed(7) : String(amount || "0").trim();
  if (!str || isNaN(Number(str))) return BIGINT_ZERO;

  const isNegative = str.startsWith("-");
  const clean = str.replace(/^-/, "");
  const [intPart = "0", fracPart = ""] = clean.split(".");
  const paddedFrac = (fracPart + "0000000").slice(0, 7);
  const cleanInt = intPart.replace(/^0+(?=\d)/, "") || "0";

  const stroops = BigInt(cleanInt) * STROOP_FACTOR + BigInt(paddedFrac);
  return isNegative ? -stroops : stroops;
}

/** Convert integer stroops (bigint) into a clean decimal string */
export function stroopsToAmountString(stroops: bigint): string {
  const isNegative = stroops < BIGINT_ZERO;
  const abs = isNegative ? -stroops : stroops;
  const intPart = (abs / STROOP_FACTOR).toString();
  const fracPart = (abs % STROOP_FACTOR).toString().padStart(7, "0");
  const trimmedFrac = fracPart.replace(/0+$/, "");
  const result = trimmedFrac.length > 0 ? `${intPart}.${trimmedFrac}` : intPart;
  return isNegative ? `-${result}` : result;
}

/** Safely add two Stellar decimal amount strings without floating point drift */
export function addStellarAmounts(amountA: string | number, amountB: string | number): string {
  try {
    const stroopsA = parseAmountToStroops(amountA);
    const stroopsB = parseAmountToStroops(amountB);
    return stroopsToAmountString(stroopsA + stroopsB);
  } catch {
    const nA = typeof amountA === "number" ? amountA : parseFloat(amountA) || 0;
    const nB = typeof amountB === "number" ? amountB : parseFloat(amountB) || 0;
    return (nA + nB).toFixed(7).replace(/\.?0+$/, "");
  }
}

// ── Horizon Account Balance Fetching ───────────────────────────

interface RawAccountData {
  publicKey: string;
  name: string;
  id?: string;
  isFunded: boolean;
  error?: string | null;
  nativeBalance: string;
  trustlines: {
    assetCode: string;
    assetIssuer: string;
    assetType: "credit_alphanum4" | "credit_alphanum12";
    balance: string;
    limit?: string;
    isAuthorized: boolean;
  }[];
}

/**
 * Fetch raw account balance and trustline data for a single wallet.
 * Errors are contained: 404 is marked as unfunded; network errors are caught and recorded.
 */
async function fetchWalletRawData(wallet: WalletQueryInput): Promise<RawAccountData> {
  const publicKey = wallet.publicKey.trim();
  const name = wallet.name?.trim() || `Wallet ${publicKey.slice(0, 4)}...${publicKey.slice(-4)}`;

  if (!isValidStellarAddress(publicKey)) {
    return {
      publicKey,
      name,
      id: wallet.id,
      isFunded: false,
      error: "Invalid Stellar public key format",
      nativeBalance: "0",
      trustlines: [],
    };
  }

  try {
    const server = getHorizonServer();
    const account = await server.loadAccount(publicKey);

    let nativeBalance = "0";
    const trustlines: RawAccountData["trustlines"] = [];

    for (const b of account.balances) {
      if (b.asset_type === "native") {
        nativeBalance = b.balance || "0";
      } else if (
        (b.asset_type === "credit_alphanum4" || b.asset_type === "credit_alphanum12") &&
        "asset_code" in b &&
        "asset_issuer" in b
      ) {
        trustlines.push({
          assetCode: b.asset_code as string,
          assetIssuer: b.asset_issuer as string,
          assetType: b.asset_type as "credit_alphanum4" | "credit_alphanum12",
          balance: b.balance || "0",
          limit: "limit" in b ? (b.limit as string) : undefined,
          isAuthorized: "is_authorized" in b ? Boolean(b.is_authorized) : true,
        });
      }
    }

    return {
      publicKey,
      name,
      id: wallet.id,
      isFunded: true,
      error: null,
      nativeBalance,
      trustlines,
    };
  } catch (err: unknown) {
    if (isAccountNotFound(err)) {
      return {
        publicKey,
        name,
        id: wallet.id,
        isFunded: false,
        error: null, // Unfunded account is a standard state, not a system failure
        nativeBalance: "0",
        trustlines: [],
      };
    }

    const message = err instanceof Error ? err.message : "Failed to load account from Horizon";
    return {
      publicKey,
      name,
      id: wallet.id,
      isFunded: false,
      error: message,
      nativeBalance: "0",
      trustlines: [],
    };
  }
}

// ── Cache Key Helper ───────────────────────────────────────────

function generateCacheKey(
  wallets: WalletQueryInput[],
  targetAssets?: (string | AssetInfo)[],
  network: string = STELLAR_NETWORK
): string {
  const sortedPks = wallets
    .map((w) => w.publicKey)
    .sort()
    .join(",");
  const sortedAssets = (targetAssets || [])
    .map((a) => (typeof a === "string" ? a : formatAssetIdentifier(a.code, a.issuer)))
    .sort()
    .join(",");
  return `${TREASURY_CACHE_PREFIX}:${network}:${sortedPks}:${sortedAssets}`;
}

// ── Main Aggregation Function ──────────────────────────────────

/**
 * Aggregates multi-asset balances across multiple wallets for the treasury dashboard.
 */
export async function getTreasuryBalances(
  wallets: WalletQueryInput[],
  options: TreasuryBalancesOptions = {}
): Promise<TreasuryMultiAssetBalancesResponse> {
  const {
    refresh = false,
    includeAllDiscovered = true,
    targetAssets = [],
    ttlMs = TREASURY_CACHE_TTL_MS,
  } = options;

  const validWallets = wallets.filter((w) => Boolean(w.publicKey));
  const cacheKey = generateCacheKey(validWallets, targetAssets, STELLAR_NETWORK);

  // Check cache unless refresh-on-demand is requested
  if (!refresh) {
    const cached = cacheGet<TreasuryMultiAssetBalancesResponse>(cacheKey);
    if (cached) {
      return {
        ...cached,
        cached: true,
      };
    }
  } else {
    cacheDelete(cacheKey);
  }

  // 1. Fetch raw balances for all wallets concurrently with error containment
  const rawAccounts = await Promise.all(validWallets.map((w) => fetchWalletRawData(w)));

  // 2. Build the unified list of assets to inspect
  const assetMap = new Map<string, AssetInfo>();

  // Always include native XLM
  assetMap.set("XLM", XLM_ASSET);

  // Include base known network assets (USDC, EURC)
  for (const known of getKnownAssets(STELLAR_NETWORK)) {
    const id = formatAssetIdentifier(known.code, known.issuer);
    assetMap.set(id, known);
  }

  // Include user-specified target assets
  for (const target of targetAssets) {
    if (typeof target === "string") {
      const parsed = parseAssetIdentifier(target, STELLAR_NETWORK);
      if (parsed) {
        const id = formatAssetIdentifier(parsed.code, parsed.issuer);
        assetMap.set(id, parsed);
      }
    } else if (target && typeof target === "object" && target.code) {
      const id = formatAssetIdentifier(target.code, target.issuer);
      assetMap.set(id, target);
    }
  }

  // If enabled, auto-discover all custom tokens from all accounts' trustlines
  if (includeAllDiscovered) {
    for (const acc of rawAccounts) {
      for (const tl of acc.trustlines) {
        const id = formatAssetIdentifier(tl.assetCode, tl.assetIssuer);
        if (!assetMap.has(id)) {
          assetMap.set(id, {
            code: tl.assetCode,
            issuer: tl.assetIssuer,
            type: tl.assetType,
            displayName: tl.assetCode,
            decimals: 7,
          });
        }
      }
    }
  }

  const assetList = Array.from(assetMap.values());

  // 3. Build wallet details and aggregate per-asset data
  const walletDetails: TreasuryWalletDetail[] = [];
  const assetAggregations: Map<string, TreasuryAssetAggregation> = new Map();

  // Initialize asset aggregation map
  for (const asset of assetList) {
    const assetKey = formatAssetIdentifier(asset.code, asset.issuer);
    let assetError: string | null = null;
    if (asset.issuer && !isValidAssetIssuer(asset.issuer)) {
      assetError = `Invalid asset issuer: ${asset.issuer}`;
    }

    assetAggregations.set(assetKey, {
      assetCode: asset.code,
      assetIssuer: asset.issuer,
      assetType: asset.type,
      displayName: asset.displayName || asset.code,
      decimals: asset.decimals ?? 7,
      totalBalance: "0",
      totalBalanceFormatted: "0.00",
      walletsHoldingCount: 0,
      untrustedWalletsCount: 0,
      walletBreakdown: [],
      error: assetError,
    });
  }

  // Process each wallet against all assets
  for (const acc of rawAccounts) {
    const walletBalances: WalletAssetBalance[] = [];
    let untrustedCount = 0;

    for (const asset of assetList) {
      const assetKey = formatAssetIdentifier(asset.code, asset.issuer);
      const agg = assetAggregations.get(assetKey)!;

      let balance = "0";
      let hasTrustline = false;
      let trustlineLimit: string | null = null;
      let isAuthorized = true;
      let itemError: string | null = null;

      if (asset.type === "native" || asset.code.toUpperCase() === "XLM") {
        hasTrustline = true;
        balance = acc.isFunded ? acc.nativeBalance : "0";
        isAuthorized = true;
      } else {
        // Find matching trustline on account
        const tl = acc.trustlines.find(
          (t) =>
            t.assetCode.toUpperCase() === asset.code.toUpperCase() &&
            (!asset.issuer || t.assetIssuer === asset.issuer)
        );

        if (tl) {
          hasTrustline = true;
          balance = tl.balance;
          trustlineLimit = tl.limit || null;
          isAuthorized = tl.isAuthorized;
        } else {
          // Untrusted asset for this wallet (contained error)
          hasTrustline = false;
          balance = "0";
          trustlineLimit = null;
          isAuthorized = false;
          untrustedCount++;
          itemError = acc.isFunded
            ? "No trustline established for asset"
            : "Account unfunded on ledger";
        }
      }

      if (acc.error) {
        itemError = acc.error;
      }

      const balanceNumber = parseFloat(balance) || 0;
      const balanceFormatted = formatAssetAmount(Math.round(balanceNumber * 1e7), asset);

      const walletItem: WalletAssetBalance = {
        assetCode: asset.code,
        assetIssuer: asset.issuer,
        assetType: asset.type,
        displayName: asset.displayName || asset.code,
        decimals: asset.decimals ?? 7,
        balance,
        balanceFormatted,
        hasTrustline,
        trustlineLimit,
        isAuthorized,
        error: itemError,
      };

      walletBalances.push(walletItem);

      // Update Aggregation
      agg.totalBalance = addStellarAmounts(agg.totalBalance, balance);
      if (balanceNumber > 0) {
        agg.walletsHoldingCount += 1;
      }
      if (!hasTrustline) {
        agg.untrustedWalletsCount += 1;
      }

      agg.walletBreakdown.push({
        accountId: acc.id,
        accountName: acc.name,
        publicKey: acc.publicKey,
        balance,
        balanceFormatted,
        hasTrustline,
        trustlineLimit,
        isAuthorized,
        error: itemError,
      });
    }

    walletDetails.push({
      accountId: acc.id,
      accountName: acc.name,
      publicKey: acc.publicKey,
      isFunded: acc.isFunded,
      balances: walletBalances,
      untrustedAssetsCount: untrustedCount,
      error: acc.error,
    });
  }

  // Format aggregated totals
  const finalAssets: TreasuryAssetAggregation[] = [];
  for (const asset of assetList) {
    const assetKey = formatAssetIdentifier(asset.code, asset.issuer);
    const agg = assetAggregations.get(assetKey)!;
    const totalNum = parseFloat(agg.totalBalance) || 0;
    agg.totalBalanceFormatted = formatAssetAmount(Math.round(totalNum * 1e7), asset);
    finalAssets.push(agg);
  }

  // Sort assets: XLM first, then USDC, then others alphabetically
  finalAssets.sort((a, b) => {
    if (a.assetCode === "XLM") return -1;
    if (b.assetCode === "XLM") return 1;
    if (a.assetCode === "USDC") return -1;
    if (b.assetCode === "USDC") return 1;
    return a.assetCode.localeCompare(b.assetCode);
  });

  // 4. Calculate Summary
  const xlmAgg = finalAssets.find((a) => a.assetCode === "XLM");
  const xlmTotal = xlmAgg ? xlmAgg.totalBalance : "0";
  const xlmTotalFormatted = xlmAgg ? xlmAgg.totalBalanceFormatted : "0.00";

  const summary: TreasuryBalanceSummary = {
    totalWallets: validWallets.length,
    activeWallets: rawAccounts.filter((a) => a.isFunded).length,
    unfundedWallets: rawAccounts.filter((a) => !a.isFunded).length,
    totalDistinctAssets: finalAssets.length,
    xlmTotal,
    xlmTotalFormatted,
  };

  const now = new Date();
  const cachedAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + ttlMs).toISOString();

  const responsePayload: TreasuryMultiAssetBalancesResponse = {
    summary,
    assets: finalAssets,
    wallets: walletDetails,
    cached: false,
    cachedAt,
    expiresAt,
    ttlSeconds: Math.round(ttlMs / 1000),
    ...(refresh ? { refreshedAt: cachedAt } : {}),
  };

  // Cache result
  cacheSet(cacheKey, responsePayload, ttlMs);

  return responsePayload;
}
