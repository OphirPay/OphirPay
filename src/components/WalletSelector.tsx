"use client";
// SPDX-License-Identifier: MIT


import { useState } from "react";
import { WALLET_REGISTRY, type WalletId } from "@/lib/wallets";
import { cn } from "@/lib/utils";

interface WalletSelectorProps {
  availableWallets: WalletId[];
  onSelect: (walletId: WalletId) => void;
  isConnecting: boolean;
  connectingWallet?: WalletId | null;
  error?: string | null;
  onClose: () => void;
}

/**
 * Wallet selection modal/dropdown.
 * Shows all registered wallets, highlighting those that are installed.
 */
export function WalletSelector({
  availableWallets,
  onSelect,
  isConnecting,
  connectingWallet,
  error,
  onClose,
}: WalletSelectorProps) {
  const [hovered, setHovered] = useState<WalletId | null>(null);

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/30 backdrop-blur-sm animate-fade-in"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div
          className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 shadow-2xl w-full max-w-sm animate-fade-in-up"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-6 pt-6 pb-4">
            <div>
              <h2 className="text-lg font-bold text-gray-900 dark:text-white">
                Connect Wallet
              </h2>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
                Choose your Stellar wallet
              </p>
            </div>
            <button
              onClick={onClose}
              disabled={isConnecting}
              className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors disabled:opacity-50"
              aria-label="Close"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={2}
                stroke="currentColor"
                className="w-5 h-5"
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Wallet list */}
          <div className="px-4 pb-2 space-y-1">
            {WALLET_REGISTRY.sort((a, b) => a.priority - b.priority).map((wallet) => {
              const isAvailable = availableWallets.includes(wallet.id);
              const isConnectingWallet = connectingWallet === wallet.id;

              return (
                <button
                  key={wallet.id}
                  onClick={() => isAvailable && onSelect(wallet.id)}
                  disabled={!isAvailable || isConnecting}
                  onMouseEnter={() => setHovered(wallet.id)}
                  onMouseLeave={() => setHovered(null)}
                  className={cn(
                    "w-full flex items-center gap-4 px-4 py-3.5 rounded-xl text-left transition-all",
                    isAvailable
                      ? "hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer"
                      : "opacity-50 cursor-not-allowed",
                    hovered === wallet.id &&
                      isAvailable &&
                      "bg-gray-50 dark:bg-gray-800 ring-1 ring-ophir-200 dark:ring-ophir-800",
                  )}
                >
                  {/* Icon */}
                  <span className="text-2xl shrink-0">{wallet.icon}</span>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-900 dark:text-white">
                      {wallet.name}
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      {wallet.description}
                    </p>
                  </div>

                  {/* Status */}
                  <span className="shrink-0">
                    {isConnectingWallet ? (
                      <svg
                        className="animate-spin h-5 w-5 text-ophir-600"
                        xmlns="http://www.w3.org/2000/svg"
                        fill="none"
                        viewBox="0 0 24 24"
                      >
                        <circle
                          className="opacity-25"
                          cx="12"
                          cy="12"
                          r="10"
                          stroke="currentColor"
                          strokeWidth="4"
                        />
                        <path
                          className="opacity-75"
                          fill="currentColor"
                          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                        />
                      </svg>
                    ) : isAvailable ? (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400">
                        Installed
                      </span>
                    ) : (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400">
                        Not found
                      </span>
                    )}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Error */}
          {error && (
            <div className="mx-4 mb-4 p-3 rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800">
              <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
            </div>
          )}

          {/* Footer */}
          <div className="px-6 py-4 border-t border-gray-100 dark:border-gray-800">
            <p className="text-xs text-gray-400 text-center">
              New to Stellar?{" "}
              <a
                href="https://www.stellar.org/wallets"
                target="_blank"
                rel="noopener noreferrer"
                className="text-ophir-600 dark:text-ophir-400 hover:underline"
              >
                Find a wallet →
              </a>
            </p>
          </div>
        </div>
      </div>
    </>
  );
}
