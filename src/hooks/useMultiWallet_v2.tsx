"use client";
// SPDX-License-Identifier: MIT

/**
 * Enhanced MultiWalletProvider with session persistence.
 *
 * Addresses issue #362 acceptance criteria:
 *   - Connected session survives page reloads
 *   - Clear reconnecting/connected state when wallet is temporarily unavailable
 *   - No manual reconnect needed after reload
 *   - Banner shown when wallet provider is missing
 */

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

const SESSION_KEY = "ophirpay-wallet-session";

interface PersistedSession {
  walletId: WalletId;
  publicKey: string;
  network: string | null;
  savedAt: number;
}

function saveSession(s: PersistedSession) {
  try { localStorage.setItem(SESSION_KEY, JSON.stringify(s)); } catch {}
}

function loadSession(): PersistedSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function clearSession() {
  try { localStorage.removeItem(SESSION_KEY); } catch {}
}

const WalletContext = createContext<WalletContextType | null>(null);

interface WalletContextType {
  wallet: MultiWalletState;
  connect: (walletId: WalletId) => Promise<void>;
  disconnect: () => Promise<void>;
  fetchBalance: () => Promise<void>;
  isConnecting: boolean;
  isReconnecting: boolean;
  walletMissing: boolean;
  error: string | null;
  availableWallets: WalletId[];
}

const initialWalletState: MultiWalletState = {
  connected: false,
  publicKey: null,
  network: null,
  balance: null,
  balanceLoading: false,
  activeWalletId: null,
};

export function MultiWalletProvider({ children }: { children: React.ReactNode }) {
  const [wallet, setWallet] = useState<MultiWalletState>(initialWalletState);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isReconnecting, setIsReconnecting] = useState(false);
  const [walletMissing, setWalletMissing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [availableWallets, setAvailableWallets] = useState<WalletId[]>([]);

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

  // Session persistence: restore on mount
  useEffect(() => {
    const saved = loadSession();
    if (!saved) return;

    const doRestore = async () => {
      setIsReconnecting(true);
      try {
        const connector = getWalletConnector(saved.walletId);
        if (!connector.isAvailable()) {
          setWalletMissing(true);
          clearSession();
          setIsReconnecting(false);
          return;
        }

        const stillConnected = await connector.isConnected().catch(() => false);
        if (!stillConnected) {
          // Wallet extension was unlocked but not connected anymore
          clearSession();
          setIsReconnecting(false);
          return;
        }

        const publicKey = await connector.getAddress();
        const network = await connector.getNetwork();
        if (publicKey) {
          setWallet({
            connected: true,
            publicKey,
            network,
            balance: null,
            balanceLoading: true,
            activeWalletId: saved.walletId,
          });
          setActiveWalletId(saved.walletId);
          loadBalanceRef.current(publicKey);
          await establishSession(publicKey, network || "TESTNET");
        }
      } catch {
        clearSession();
      } finally {
        setIsReconnecting(false);
      }
    };

    doRestore();
  }, []);

  const connect = useCallback(
    async (walletId: WalletId) => {
      setIsConnecting(true);
      setIsReconnecting(false);
      setWalletMissing(false);
      setError(null);

      try {
        const connector = getWalletConnector(walletId);
        if (!connector.isAvailable()) {
          throw new Error(`${connector.name} is not available. Please install it first.`);
        }

        const { publicKey, network } = await connector.connect();

        const configuredNetwork = process.env.NEXT_PUBLIC_STELLAR_NETWORK || "TESTNET";
        const walletNet = network.toUpperCase();
        if (walletNet !== configuredNetwork) {
          console.warn(`[OphirPay] Wallet network (${walletNet}) doesn't match app config (${configuredNetwork}).`);
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

        if (publicKey) loadBalance(publicKey);

        const sessionOk = await establishSession(
          publicKey,
          network || "TESTNET",
          connector.signMessage
            ? (message: string) => connector.signMessage!(message)
            : undefined
        );

        if (sessionOk) {
          saveSession({ walletId, publicKey, network, savedAt: Date.now() });
        }

        if (!sessionOk && connector.signMessage) {
          setWallet(initialWalletState);
          setActiveWalletId(null);
          clearSession();
          setError("Wallet connected, but the server rejected the session.");
          return;
        }
        if (!sessionOk) {
          console.warn(`[OphirPay] Session not established — ${connector.name} has no signMessage support.`);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to connect wallet";
        setError(message);
      } finally {
        setIsConnecting(false);
      }
    },
    [loadBalance]
  );

  const disconnect = useCallback(async () => {
    if (wallet.activeWalletId) {
      try {
        const connector = getWalletConnector(wallet.activeWalletId);
        await connector.disconnect();
      } catch {}
    }
    await revokeSession();
    clearSession();
    setWallet(initialWalletState);
    setActiveWalletId(null);
    setError(null);
    setWalletMissing(false);
  }, [wallet.activeWalletId]);

  // Auto-refresh balance every 30s
  useEffect(() => {
    if (!wallet.connected || !wallet.publicKey) return;
    const interval = setInterval(() => loadBalance(wallet.publicKey!), 30000);
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
        isReconnecting,
        walletMissing,
        error,
        availableWallets,
      }}
    >
      {children}
    </WalletContext.Provider>
  );
}

export function useWallet() {
  const context = useContext(WalletContext);
  if (!context) throw new Error("useWallet must be used within a MultiWalletProvider");
  return context;
}
