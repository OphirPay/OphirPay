"use client";
// SPDX-License-Identifier: MIT


import { useEffect, useRef } from "react";
import { getFreighter } from "@/hooks/useFreighter"; // Legacy Freighter-specific hook

/**
 * Detects Freighter network changes (e.g., user switches from Testnet to Mainnet).
 * Calls onNetworkChange when the network differs from the initial value.
 *
 * @example
 * Warn the user and invalidate on-chain data when the wallet network changes:
 *
 * ```tsx
 * function NetworkGuard() {
 *   const { wallet } = useWallet();
 *   useNetworkChange(wallet.network, (nextNetwork) => {
 *     toast.error("Wallet switched networks — refreshing balances");
 *     queryClient.invalidateQueries();
 *   });
 *   return null;
 * }
 * ```
 */
export function useNetworkChange(
  currentNetwork: string | null,
  onNetworkChange: (newNetwork: string) => void
) {
  const initialNetwork = useRef(currentNetwork);

  useEffect(() => {
    if (!currentNetwork) return;

    // Skip if already initialized
    if (initialNetwork.current && initialNetwork.current !== currentNetwork) {
      onNetworkChange(currentNetwork);
    }
    initialNetwork.current = currentNetwork;
  }, [currentNetwork, onNetworkChange]);
}

/**
 * Poll Freighter for network changes every `interval` ms.
 * Warns (via console) when the Freighter network no longer matches.
 *
 * @example
 * Keep the app in sync with the wallet's selected network while mounted:
 *
 * ```tsx
 * function NetworkMonitor({ network }: { network: string }) {
 *   useNetworkPoller(network, 15000);
 *   return null;
 * }
 * ```
 */
export function useNetworkPoller(
  expectedNetwork: string | null,
  interval = 30000
) {
  useEffect(() => {
    if (!expectedNetwork) return;

    const timer = setInterval(async () => {
      try {
        const freighter = getFreighter();
        if (!freighter) return;
        const network = await freighter.getNetwork();
        if (network !== expectedNetwork) {
          // Network mismatch — could trigger a notification
          console.warn(
            `[OphirPay] Freighter network changed: ${expectedNetwork} → ${network}`
          );
        }
      } catch {
        // Silently ignore poll failures
      }
    }, interval);

    return () => clearInterval(timer);
  }, [expectedNetwork, interval]);
}
