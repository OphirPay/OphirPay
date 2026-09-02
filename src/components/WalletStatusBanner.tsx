"use client";
// SPDX-License-Identifier: MIT


import { useState, useEffect } from "react";
import { useWallet } from "@/hooks/useMultiWallet";
import { WALLET_REGISTRY } from "@/lib/wallets";

/**
 * Banner that surfaces the wallet reconnecting / missing-provider state.
 *
 * - Shows "Reconnecting..." while the provider is restoring the session on
 *   page load.
 * - Shows a persistent banner if the previously-used wallet extension is no
 *   longer detected (and the user has not connected a different wallet).
 */
export function WalletStatusBanner() {
  const { isReconnecting, missingWallet, wallet } = useWallet();
  const [dismissed, setDismissed] = useState(false);

  // Reset dismissal when the missing wallet changes.
  useEffect(() => {
    setDismissed(false);
  }, [missingWallet]);

  if (isReconnecting) {
    return (
      <div className="sticky top-0 z-50 w-full bg-ophir-600 text-white text-center py-2 text-sm font-medium animate-pulse">
        Reconnecting wallet…
      </div>
    );
  }

  if (!missingWallet || wallet.connected || dismissed) return null;

  const info = WALLET_REGISTRY.find((w) => w.id === missingWallet);
  const name = info?.name ?? missingWallet;

  return (
    <div className="sticky top-0 z-50 w-full bg-amber-500 text-white px-4 py-2 text-sm font-medium">
      <div className="max-w-7xl mx-auto flex items-center justify-between gap-4">
        <span>
          {name} wallet extension not detected. Please reinstall it or connect a
          different wallet.
        </span>
        <button
          onClick={() => setDismissed(true)}
          className="shrink-0 underline hover:no-underline"
          aria-label="Dismiss wallet banner"
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}
