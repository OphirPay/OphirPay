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
import type { MultiWalletState, WalletId } from "@/lib/wallets";
import { getWalletConnector, getAvailableWallets, setActiveWalletId } from "@/lib/wallets";
import { fetchXlmBalance } from "@/lib/stellar";
import { establishSession, revokeSession } from "@/lib/client-auth";

// ── Context ───────────────────────────────────────────────────

const WalletContext = createContext<WalletContextType | null>(null);

interface WalletContextType {
  wallet: MultiWalletState;
  connect: (walletId: WalletId) => Promise<void>;
  disconnect: () => Promise<void>;
  fetchBalance: () => Promise<void>;
  isConnecting: boolean;
  error: string | null;
  availableWallets: WalletId[];
}

// ── Initial State ─────────────────────────────────────────────

const initialWalletState: MultiWalletState = {
  connected: false,
  publicKey: null,
  network: null,
  balance: null,
  balanceLoading: false,
  activeWalletId: null,
};

// ── Provider ──────────────────────────────────────────────────

export function MultiWalletProvider({ children }: { children: React.ReactNode }) {
  const [wallet, setWallet] = useState<MultiWalletState>(initialWalletState);
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [availableWallets, setAvailableWallets] = useState<WalletId[]>([]);

  // Detect available wallets on mount
  useEffect(() => {
    const wallets = getAvailableWallets();
    setAvailableWallets(wallets.map((w) => w.id));
  }, []);

  const loadBalance = useCallback(async (publicKey: string) => {
    setWallet((prev) => ({ ...prev, balanceLoading: true }));
    try {
      const balance = await fetchXlmBalance(publicKey);
      setWallet((prev) => ({ ...prev, balance, balanceLoading: false }));
    } catch {
      setWallet((prev) => ({ ...prev, balanceLoading: false }));
    }
  }, []);

  const loadBalanceRef = useRef(loadBalance);
  loadBalanceRef.current = loadBalance;

  // Try to auto-reconnect on mount (check all available wallets)
  useEffect(() => {
    const autoReconnect = async () => {
      for (const walletId of ["freighter", "albedo", "xbull"] as WalletId[]) {
        try {
          const connector = getWalletConnector(walletId);
          if (!connector.isAvailable()) continue;
          const connected = await connector.isConnected();
          if (connected) {
            const publicKey = await connector.getAddress();
            const network = await connector.getNetwork();
            if (publicKey) {
              setWallet({
                connected: true,
                publicKey,
                network,
            balance: null,
            balanceLoading: true,
            activeWalletId: walletId,
          });
          setActiveWalletId(walletId);
          loadBalanceRef.current(publicKey);
              // Restore the server-side session for API authorization
              await establishSession(publicKey, network || "TESTNET");
              return; // Connected to first available wallet
            }
          }
        } catch {
          // Try next wallet
        }
      }
    };

    autoReconnect();
  }, []);

  const connect = useCallback(
    async (walletId: WalletId) => {
      setIsConnecting(true);
      setError(null);

      try {
        const connector = getWalletConnector(walletId);
        if (!connector.isAvailable()) {
          throw new Error(
            `${connector.name} is not available. Please install it first.`,
          );
        }

        const { publicKey, network } = await connector.connect();

        // Warn if wallet network doesn't match configured network
        const configuredNetwork = process.env.NEXT_PUBLIC_STELLAR_NETWORK || "TESTNET";
        const walletNet = network.toUpperCase();
        if (walletNet !== configuredNetwork) {
          console.warn(
            `[OphirPay] Wallet network (${walletNet}) doesn't match app config (${configuredNetwork}). ` +
            `Switch your wallet to ${configuredNetwork} to use OphirPay.`
          );
        }

        setWallet({
          connected: true,
          publicKey,
          network,
          balance: null,
          balanceLoading: true,
          activeWalletId: walletId,
        });
        setActiveWalletId(walletId);

        if (publicKey) {
          loadBalance(publicKey);
        }
        // Open a server-side session so API routes can authorize this user.
        // Wallets that support message signing prove ownership by signing a
        // challenge; the session route rejects fresh sessions without proof.
        const sessionOk = await establishSession(
          publicKey,
          network || "TESTNET",
          connector.signMessage
            ? (message: string) => connector.signMessage!(message)
            : undefined
        );
        if (!sessionOk && connector.signMessage) {
          // Proof was attempted but rejected (e.g. the user declined the
          // signature prompt) — roll back so the UI doesn't show a
          // "connected" state with no server session behind it.
          setWallet(initialWalletState);
          setActiveWalletId(null);
          setError(
            "Wallet connected, but the server rejected the session. You may have declined the signature request — reconnect and approve it to use API features."
          );
          return;
        }
        if (!sessionOk) {
          // Wallet has no message-signing support: no server session is
          // issued (proof is required), so wallet-based contract signing
          // still works but API routes stay unauthenticated.
          console.warn(
            `[OphirPay] Session not established — ${connector.name} has no signMessage support. Use Freighter, xBull, or Albedo for full API access.`
          );
        }
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Failed to connect wallet";
        setError(message);
      } finally {
        setIsConnecting(false);
      }
    },
    [loadBalance],
  );

  const disconnect = useCallback(async () => {
    if (wallet.activeWalletId) {
      try {
        const connector = getWalletConnector(wallet.activeWalletId);
        await connector.disconnect();
      } catch {
        // Best effort
      }
    }
    // Revoke the server-side session cookie
    await revokeSession();
    setWallet(initialWalletState);
    setActiveWalletId(null);
    setError(null);
  }, [wallet.activeWalletId]);

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
      value={{
        wallet,
        connect,
        disconnect,
        fetchBalance,
        isConnecting,
        error,
        availableWallets,
      }}
    >
      {children}
    </WalletContext.Provider>
  );
}

// ── Hook ──────────────────────────────────────────────────────

export function useWallet() {
  const context = useContext(WalletContext);
  if (!context) {
    throw new Error("useWallet must be used within a MultiWalletProvider");
  }
  return context;
}
