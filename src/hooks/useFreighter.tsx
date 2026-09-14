"use client";
// SPDX-License-Identifier: MIT


import {
  useState,
  useCallback,
  useEffect,
  useRef,
  createContext,
  useContext,
} from "react";
import type { WalletState, FreighterAPI } from "@/types";
import { fetchXlmBalance } from "@/lib/stellar";

// ── Context ───────────────────────────────────────────────────

const WalletContext = createContext<WalletContextType | null>(null);

interface WalletContextType {
  wallet: WalletState;
  connect: () => Promise<void>;
  disconnect: () => void;
  fetchBalance: () => Promise<void>;
  isConnecting: boolean;
  error: string | null;
}

// ── Helpers ───────────────────────────────────────────────────

export function getFreighter(): FreighterAPI | undefined {
  if (typeof window === "undefined") return undefined;
  return (window as unknown as { freighter?: FreighterAPI }).freighter;
}

// ── Provider ──────────────────────────────────────────────────

const initialWalletState: WalletState = {
  connected: false,
  publicKey: null,
  network: null,
  balance: null,
  balanceLoading: false,
};

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const [wallet, setWallet] = useState<WalletState>(initialWalletState);
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadBalance = useCallback(async (publicKey: string) => {
    setWallet((prev) => ({ ...prev, balanceLoading: true }));
    try {
      const balance = await fetchXlmBalance(publicKey);
      // Ignore stale responses: a balance fetch that resolves after a
      // disconnect (or an account switch) must not repopulate the cache.
      setWallet((prev) =>
        prev.connected && prev.publicKey === publicKey
          ? { ...prev, balance, balanceLoading: false }
          : prev,
      );
    } catch {
      setWallet((prev) =>
        prev.connected && prev.publicKey === publicKey
          ? { ...prev, balanceLoading: false }
          : prev,
      );
    }
  }, []);

  // Stable ref to loadBalance for the mount effect
  const loadBalanceRef = useRef(loadBalance);
  loadBalanceRef.current = loadBalance;

  // Check if already connected on mount
  useEffect(() => {
    const checkExistingConnection = async () => {
      try {
        const freighter = getFreighter();
        if (!freighter) return;

        const connected = await freighter.isConnected();
        if (connected) {
          const publicKey = await freighter.getAddress();
          const network = await freighter.getNetwork();
          setWallet((prev) => ({
            ...prev,
            connected: true,
            publicKey,
            network,
          }));
          if (publicKey) {
            loadBalanceRef.current(publicKey);
          }
        }
      } catch {
        // Freighter not available or user rejected
      }
    };

    checkExistingConnection();
  }, []);

  const connect = useCallback(async () => {
    setIsConnecting(true);
    setError(null);

    try {
      const freighter = getFreighter();
      if (!freighter) {
        throw new Error(
          "Freighter wallet not installed. Please install the Freighter browser extension."
        );
      }

      await freighter.requestAccess();
      const publicKey = await freighter.getAddress();
      const network = await freighter.getNetwork();

      setWallet({
        connected: true,
        publicKey,
        network,
        balance: null,
        balanceLoading: true,
      });

      if (publicKey) {
        loadBalance(publicKey);
      }
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to connect wallet";
      setError(message);
    } finally {
      setIsConnecting(false);
    }
  }, [loadBalance]);   const disconnect = useCallback(() => {
    setWallet(initialWalletState);
    setError(null);
    if (typeof window !== "undefined") {
      localStorage.removeItem("ophirpay-wallet-connected");
    }
  }, []);

  // Auto-refresh balance every 30 seconds when connected
  useEffect(() => {
    if (!wallet.connected || !wallet.publicKey) return;
    const interval = setInterval(() => {
      loadBalance(wallet.publicKey!);
    }, 30000);
    return () => clearInterval(interval);
  }, [wallet.connected, wallet.publicKey, loadBalance]);

  const fetchBalance = useCallback(async () => {
    if (!wallet.publicKey) return;
    await loadBalance(wallet.publicKey);
  }, [wallet.publicKey, loadBalance]);

  return (
    <WalletContext.Provider
      value={{ wallet, connect, disconnect, fetchBalance, isConnecting, error }}
    >
      {children}
    </WalletContext.Provider>
  );
}

// ── Hook ──────────────────────────────────────────────────────

/**
 * Access the legacy Freighter-only wallet state and controls.
 * Must be rendered inside a `WalletProvider` — throwing otherwise.
 * Prefer `useWallet` from `@/hooks/useMultiWallet` for new code, which also
 * supports Albedo and xBull.
 *
 * @example
 * Show a connect button or the connected public key:
 *
 * ```tsx
 * function WalletStatus() {
 *   const { wallet, connect, isConnecting } = useWallet();
 *
 *   return (
 *     <button
 *       onClick={() => connect()}
 *       disabled={isConnecting}
 *     >
 *       {wallet.publicKey ?? "Connect Freighter"}
 *     </button>
 *   );
 * }
 * ```
 */
export function useWallet() {
  const context = useContext(WalletContext);
  if (!context) {
    throw new Error("useWallet must be used within a WalletProvider");
  }
  return context;
}
