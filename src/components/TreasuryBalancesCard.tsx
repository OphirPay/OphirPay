"use client";
// SPDX-License-Identifier: MIT

import { useState } from "react";
import { useApiQuery } from "@/hooks/useApiQuery";
import { useWallet } from "@/hooks/useMultiWallet";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { LoadingSkeleton } from "@/components/LoadingSkeleton";
import { shortenAddress } from "@/lib/utils";
import type { TreasuryMultiAssetBalancesResponse } from "@/types";

export function TreasuryBalancesCard() {
  const { wallet } = useWallet();
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [selectedAsset, setSelectedAsset] = useState<string | null>(null);

  const endpoint = wallet.publicKey
    ? `/api/treasury/balances?wallets=${wallet.publicKey}`
    : "/api/treasury/balances";

  const { data, isLoading, error, refetch } = useApiQuery<TreasuryMultiAssetBalancesResponse>(
    ["treasury", "balances", wallet.publicKey || "current"],
    endpoint,
    {
      enabled: Boolean(wallet.connected || wallet.publicKey),
      staleTime: 30_000,
    }
  );

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      const res = await fetch(`${endpoint}${endpoint.includes("?") ? "&" : "?"}refresh=true`);
      if (res.ok) {
        await refetch();
      }
    } catch {
      // Ignored: refetch will handle error state
    } finally {
      setIsRefreshing(false);
    }
  };

  if (!wallet.connected && !wallet.publicKey) {
    return null;
  }

  return (
    <Card
      title="Multi-Asset Treasury Balances"
      actions={
        <div className="flex items-center gap-2">
          {data?.cached && (
            <span className="text-[11px] text-gray-400 dark:text-gray-500">
              Cached (30s TTL)
            </span>
          )}
          <Button
            size="sm"
            variant="secondary"
            onClick={handleRefresh}
            loading={isRefreshing || isLoading}
          >
            Refresh Balances
          </Button>
        </div>
      }
    >
      {isLoading && !data ? (
        <LoadingSkeleton variant="table" lines={3} />
      ) : error ? (
        <div className="p-3 rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800">
          <p className="text-sm text-red-700 dark:text-red-400">
            Failed to load aggregated balances: {error.message}
          </p>
        </div>
      ) : data?.assets?.length === 0 ? (
        <div className="text-center py-6 text-sm text-gray-500 dark:text-gray-400">
          No balances or trustlines found.
        </div>
      ) : (
        <div className="space-y-4">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-800">
                  <th className="pb-3 font-medium">Asset</th>
                  <th className="pb-3 font-medium">Total Balance</th>
                  <th className="pb-3 font-medium">Wallets Holding</th>
                  <th className="pb-3 font-medium">Trustline Status</th>
                  <th className="pb-3 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {data?.assets.map((asset) => (
                  <tr
                    key={`${asset.assetCode}:${asset.assetIssuer || "native"}`}
                    className="border-b border-gray-100 dark:border-gray-800/50 hover:bg-gray-50 dark:hover:bg-gray-800/30 transition-colors"
                  >
                    <td className="py-3 pr-4">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-gray-900 dark:text-white">
                          {asset.assetCode}
                        </span>
                        {asset.assetType === "native" ? (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 font-medium">
                            Native
                          </span>
                        ) : (
                          <span
                            className="text-xs text-gray-400 font-mono"
                            title={asset.assetIssuer}
                          >
                            {asset.assetIssuer ? shortenAddress(asset.assetIssuer, 4) : ""}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-gray-400">{asset.displayName}</p>
                    </td>

                    <td className="py-3 pr-4 font-mono font-medium text-gray-900 dark:text-white">
                      {asset.totalBalanceFormatted} {asset.assetCode}
                    </td>

                    <td className="py-3 pr-4 text-gray-600 dark:text-gray-300">
                      {asset.walletsHoldingCount} of {data.summary.totalWallets}
                    </td>

                    <td className="py-3 pr-4">
                      {asset.assetType === "native" ? (
                        <Badge variant="success">Native Trust</Badge>
                      ) : asset.untrustedWalletsCount === 0 ? (
                        <Badge variant="success">All Trusted</Badge>
                      ) : asset.untrustedWalletsCount === data.summary.totalWallets ? (
                        <Badge variant="warning">No Trustlines</Badge>
                      ) : (
                        <Badge variant="warning">
                          {asset.untrustedWalletsCount} Missing Trust
                        </Badge>
                      )}
                    </td>

                    <td className="py-3 text-right">
                      <button
                        onClick={() =>
                          setSelectedAsset(
                            selectedAsset === asset.assetCode ? null : asset.assetCode
                          )
                        }
                        className="text-xs text-ophir-600 dark:text-ophir-400 hover:underline font-medium"
                      >
                        {selectedAsset === asset.assetCode ? "Hide Details" : "View Wallets"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Expanded Breakdown */}
          {selectedAsset && (
            <div className="p-4 rounded-lg bg-gray-50 dark:bg-gray-800/40 border border-gray-200 dark:border-gray-700/50 mt-2 space-y-2">
              <h4 className="text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider">
                Wallet Breakdown for {selectedAsset}
              </h4>
              {data?.assets
                .find((a) => a.assetCode === selectedAsset)
                ?.walletBreakdown.map((w, idx) => (
                  <div
                    key={idx}
                    className="flex items-center justify-between text-xs py-1.5 border-b border-gray-200/50 dark:border-gray-700/30 last:border-0"
                  >
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-gray-700 dark:text-gray-300">
                        {shortenAddress(w.publicKey, 6)}
                      </span>
                      <span className="text-gray-400">({w.accountName})</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="font-mono font-semibold text-gray-900 dark:text-white">
                        {w.balanceFormatted} {selectedAsset}
                      </span>
                      {w.hasTrustline ? (
                        <span className="text-green-600 dark:text-green-400 font-medium">
                          ✓ Trusted
                        </span>
                      ) : (
                        <span className="text-amber-500 font-medium">
                          ⚠ Untrusted
                        </span>
                      )}
                    </div>
                  </div>
                ))}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
