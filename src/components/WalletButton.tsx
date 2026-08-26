"use client";
// SPDX-License-Identifier: MIT


import { useState } from "react";
import { useWallet } from "@/hooks/useMultiWallet";
import { shortenAddress, formatAmount } from "@/lib/utils";
import { Button } from "@/components/ui/Button";
import { Tooltip } from "@/components/ui/Tooltip";
import { WalletSelector } from "@/components/WalletSelector";
import { WALLET_REGISTRY, type WalletId } from "@/lib/wallets";

export function WalletButton() {
  const { wallet, connect, disconnect, fetchBalance, isConnecting, error, availableWallets } =
    useWallet();
  const [showSelector, setShowSelector] = useState(false);
  const [connectingWallet, setConnectingWallet] = useState<WalletId | null>(null);

  const handleSelectWallet = async (walletId: WalletId) => {
    setConnectingWallet(walletId);
    try {
      await connect(walletId);
      setShowSelector(false);
    } catch {
      // Error is handled by the provider
    } finally {
      setConnectingWallet(null);
    }
  };

  const activeWalletInfo = wallet.activeWalletId
    ? WALLET_REGISTRY.find((w) => w.id === wallet.activeWalletId)
    : null;

  if (wallet.connected && wallet.publicKey) {
    return (
      <div className="flex items-center gap-3">
        {/* Balance */}
        <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-full bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800">
          {wallet.balanceLoading ? (
            <span className="text-sm text-green-700 dark:text-green-400 animate-pulse">
              Loading...
            </span>
          ) : (
            <>
              <span className="text-sm font-mono font-medium text-green-700 dark:text-green-400">
                {wallet.balance !== null
                  ? formatAmount(parseFloat(wallet.balance), "XLM")
                  : "— XLM"}
              </span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  fetchBalance();
                }}
                className="text-green-500 hover:text-green-700 dark:hover:text-green-300 transition-colors"
                title="Refresh balance"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={2}
                  stroke="currentColor"
                  className="w-3.5 h-3.5"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182M2.985 19.644l3.181-3.182"
                  />
                </svg>
              </button>
            </>
          )}
        </div>

        {/* Network badge */}
        <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-full bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
          </span>
          <span className="text-sm font-medium text-blue-700 dark:text-blue-400">
            {wallet.network || "TESTNET"}
          </span>
        </div>

        {/* Address + wallet icon */}
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700">
          <span className="text-sm" title={activeWalletInfo?.name}>
            {activeWalletInfo?.icon || "🔑"}
          </span>
          <span className="text-sm font-mono text-gray-700 dark:text-gray-300">
            {shortenAddress(wallet.publicKey)}
          </span>
        </div>

        {/* Disconnect */}
        <button
          onClick={disconnect}
          aria-label="Disconnect wallet"
          className="text-sm text-gray-500 hover:text-red-500 dark:text-gray-400 dark:hover:text-red-400 transition-colors duration-200"
          title="Disconnect wallet"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={1.5}
            stroke="currentColor"
            className="w-5 h-5"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15m3 0l3-3m0 0l-3-3m3 3H9"
            />
          </svg>
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Tooltip content="Install Freighter wallet extension" position="bottom">
        <Button
          onClick={() => setShowSelector(true)}
          loading={isConnecting}
          leftIcon={
            <svg
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={1.5}
              stroke="currentColor"
              className="w-5 h-5"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M21 12a2.25 2.25 0 00-2.25-2.25H15a3 3 0 11-6 0H5.25A2.25 2.25 0 003 12m18 0v6a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 18v-6m18 0V9M3 12V9m18 0a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 9m18 0V6a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 6v3"
              />
            </svg>
          }
        >
          {isConnecting ? "Connecting..." : "Connect Wallet"}
        </Button>
      </Tooltip>
      {error && !showSelector && (
        <p className="text-xs text-red-500 dark:text-red-400 max-w-[200px] text-right">
          {error}
        </p>
      )}

      {showSelector && (
        <WalletSelector
          availableWallets={availableWallets}
          onSelect={handleSelectWallet}
          isConnecting={isConnecting}
          connectingWallet={connectingWallet}
          error={error}
          onClose={() => setShowSelector(false)}
        />
      )}
    </div>
  );
}
