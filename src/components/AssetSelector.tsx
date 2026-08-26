"use client";
// SPDX-License-Identifier: MIT


import { useState, useEffect, useCallback } from "react";
import { cn } from "@/lib/utils";
import {
  XLM_ASSET,
  USDC_TESTNET,
  USDC_MAINNET,
  type AssetInfo,
} from "@/lib/assets";
import { fetchAllBalances, type AssetBalance } from "@/lib/stellar";
import { checkTrustline } from "@/lib/trustline";
import { STELLAR_NETWORK } from "@/lib/stellar";

// ── Helpers ────────────────────────────────────────────────────

const KNOWN_ASSETS: AssetInfo[] = [
  XLM_ASSET,
  STELLAR_NETWORK === "PUBLIC" ? USDC_MAINNET : USDC_TESTNET,
];

function findAssetBalance(
  balances: AssetBalance[],
  asset: AssetInfo,
): string {
  if (asset.type === "native") {
    return balances.find((b) => b.type === "native")?.balance ?? "0";
  }
  return (
    balances.find(
      (b) => b.assetCode === asset.code && b.assetIssuer === asset.issuer,
    )?.balance ?? "0"
  );
}

interface AssetSelectorProps {
  publicKey: string | null;
  selectedAsset: AssetInfo;
  onSelect: (asset: AssetInfo) => void;
  className?: string;
  disabled?: boolean;
}

// ── Component ──────────────────────────────────────────────────

export function AssetSelector({
  publicKey,
  selectedAsset,
  onSelect,
  className,
  disabled = false,
}: AssetSelectorProps) {
  const [balances, setBalances] = useState<AssetBalance[]>([]);
  const [trustlineStatus, setTrustlineStatus] = useState<
    Record<string, { hasTrustline: boolean; checking: boolean }>
  >({});
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);

  const fetchBalances = useCallback(async () => {
    if (!publicKey) return;
    setLoading(true);
    try {
      const allBalances = await fetchAllBalances(publicKey);
      setBalances(allBalances);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, [publicKey]);

  useEffect(() => {
    fetchBalances();
  }, [fetchBalances]);

  const handleSelect = async (asset: AssetInfo) => {
    // For non-native assets, check trustline before selecting
    if (asset.type !== "native" && asset.issuer && publicKey) {
      const key = `${asset.code}:${asset.issuer}`;
      setTrustlineStatus((prev) => ({
        ...prev,
        [key]: { ...prev[key], checking: true },
      }));

      const info = await checkTrustline(publicKey, asset.code, asset.issuer);

      setTrustlineStatus((prev) => ({
        ...prev,
        [key]: { hasTrustline: info.hasTrustline, checking: false },
      }));
    }

    onSelect(asset);
    setOpen(false);
  };

  const balance = findAssetBalance(balances, selectedAsset);

  return (
    <div className={cn("relative", className)}>
      <button
        type="button"
        onClick={() => !disabled && setOpen(!open)}
        disabled={disabled}
        className={cn(
          "w-full flex items-center justify-between gap-2 px-4 py-2.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm transition-colors",
          !disabled &&
            "hover:border-gray-300 dark:hover:border-gray-600 cursor-pointer",
          disabled && "opacity-50 cursor-not-allowed",
        )}
      >
        <span className="flex items-center gap-2">
          <span className="w-6 h-6 rounded-full bg-ophir-100 dark:bg-ophir-900/30 flex items-center justify-center text-xs font-bold text-ophir-700 dark:text-ophir-300">
            {selectedAsset.code.slice(0, 2)}
          </span>
          <span className="text-gray-900 dark:text-white font-medium">
            {selectedAsset.code}
          </span>
        </span>

        <span className="flex items-center gap-2">
          <span className="text-xs text-gray-400">
            {loading ? "..." : balance}
          </span>
          <svg
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={2}
            stroke="currentColor"
            className={cn(
              "w-4 h-4 text-gray-400 transition-transform",
              open && "rotate-180",
            )}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M19.5 8.25l-7.5 7.5-7.5-7.5"
            />
          </svg>
        </span>
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute z-20 top-full left-0 right-0 mt-1 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-xl py-1 animate-fade-in">
            {KNOWN_ASSETS.map((asset) => {
              const bal = findAssetBalance(balances, asset);
              const key = `${asset.code}:${asset.issuer}`;
              const tl = trustlineStatus[key];

              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => handleSelect(asset)}
                  className={cn(
                    "w-full flex items-center justify-between px-4 py-2.5 text-sm hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors",
                    selectedAsset.code === asset.code &&
                      selectedAsset.issuer === asset.issuer &&
                      "bg-ophir-50 dark:bg-ophir-950/20",
                  )}
                >
                  <div className="flex items-center gap-2">
                    <span className="w-6 h-6 rounded-full bg-ophir-100 dark:bg-ophir-900/30 flex items-center justify-center text-xs font-bold text-ophir-700 dark:text-ophir-300">
                      {asset.code.slice(0, 2)}
                    </span>
                    <div className="text-left">
                      <span className="text-gray-900 dark:text-white font-medium">
                        {asset.code}
                      </span>
                      <span className="block text-xs text-gray-400">
                        {asset.displayName}
                      </span>
                    </div>
                  </div>
                  <div className="text-right">
                    <span className="text-xs text-gray-500 dark:text-gray-400">
                      {bal}
                    </span>
                    {asset.type !== "native" && (
                      <span
                        className={cn(
                          "block text-xs",
                          tl?.checking
                            ? "text-gray-400"
                            : tl?.hasTrustline
                              ? "text-green-500"
                              : "text-amber-500",
                        )}
                      >
                        {tl?.checking
                          ? "checking..."
                          : tl?.hasTrustline
                            ? "✓ trustline"
                            : "no trustline"}
                      </span>
                    )}
                  </div>
                </button>
              );
            })}

            {/* Custom token input */}
            <div className="border-t border-gray-100 dark:border-gray-700 mt-1 pt-1 px-3 pb-2">
              <p className="text-xs text-gray-400 px-1 mb-1">
                Custom token coming soon
              </p>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
