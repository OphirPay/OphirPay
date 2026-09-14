"use client";
// SPDX-License-Identifier: MIT


import { useEffect, useState } from "react";
import { useWallet } from "@/hooks/useMultiWallet";
import { buildReceivePayload } from "@/lib/stellar-uri";
import { getAccountExplorerUrl } from "@/lib/stellar";
import { shortenAddress } from "@/lib/utils";
import { getWalletConnector, type WalletId } from "@/lib/wallets";
import { Breadcrumb } from "@/components/Breadcrumb";
import { WalletSelector } from "@/components/WalletSelector";
import { QrCode } from "@/components/ui/QrCode";
import { CopyButton } from "@/components/ui/CopyButton";
import { Card } from "@/components/ui/Card";

export default function ReceivePage() {
  const { wallet, connect, isConnecting, error, availableWallets } = useWallet();
  const [showSelector, setShowSelector] = useState(false);
  const [connectingWallet, setConnectingWallet] = useState<WalletId | null>(null);
  const [accountMismatch, setAccountMismatch] = useState<{
    liveAddress: string;
  } | null>(null);

  // The wallet provider only refreshes `publicKey` on connect — if the user
  // switches accounts inside the wallet extension while this page is open,
  // the shown address/QR/URI would silently keep targeting the previous
  // account. Re-check the live account from the active wallet connector on
  // mount and on window focus, and warn (with a reconnect action) when it
  // no longer matches the connected session.
  useEffect(() => {
    if (!wallet.connected || !wallet.publicKey || !wallet.activeWalletId) {
      setAccountMismatch(null);
      return;
    }

    let cancelled = false;
    const checkLiveAddress = async () => {
      try {
        const connector = getWalletConnector(wallet.activeWalletId!);
        const live = await connector.getAddress();
        if (cancelled) return;
        if (live && live !== wallet.publicKey) {
          setAccountMismatch({ liveAddress: live });
        } else {
          setAccountMismatch(null);
        }
      } catch {
        // Wallet unavailable or the read failed — keep the current state.
      }
    };

    checkLiveAddress();
    window.addEventListener("focus", checkLiveAddress);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", checkLiveAddress);
    };
  }, [wallet.connected, wallet.publicKey, wallet.activeWalletId]);

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

  const address = wallet.publicKey;

  return (
    <div className="space-y-6 animate-fade-in">
      <Breadcrumb items={[{ label: "Receive" }]} />

      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Receive</h1>
        <p className="text-gray-500 dark:text-gray-400 mt-1">
          Share your Stellar address so anyone can pay you with their wallet
        </p>
      </div>

      {!address ? (
        <Card className="p-12 text-center max-w-xl">
          <div className="mx-auto h-14 w-14 rounded-full bg-ophir-50 dark:bg-ophir-950/30 flex items-center justify-center mb-4">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="h-7 w-7 text-ophir-600 dark:text-ophir-400">
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 8.25h19.5M2.25 9h19.5m-16.5 5.25h6m-6 2.25h3m-3.75 3h15a2.25 2.25 0 002.25-2.25V6.75A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25v10.5A2.25 2.25 0 004.5 19.5z" />
            </svg>
          </div>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
            Connect your wallet to receive
          </h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 max-w-sm mx-auto">
            Connect a Stellar wallet to generate your receive address and QR
            code, ready to share with senders.
          </p>
          <button
            onClick={() => setShowSelector(true)}
            disabled={isConnecting}
            className="mt-6 inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-ophir-600 text-white text-sm font-medium hover:bg-ophir-700 transition-colors disabled:opacity-50"
          >
            {isConnecting ? "Connecting..." : "Connect wallet"}
          </button>
          {error && !showSelector && (
            <p className="mt-3 text-xs text-red-500 dark:text-red-400">{error}</p>
          )}
        </Card>
      ) : (
        <div className="max-w-4xl space-y-6">
          {/* Account mismatch warning — the wallet is on a different account
              than the connected session. Surface it prominently instead of
              silently directing senders to the previous destination. */}
          {accountMismatch && (
            <div
              role="alert"
              className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 px-4 py-3"
            >
              <div className="flex items-start gap-3 min-w-0">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="h-5 w-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                </svg>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-amber-800 dark:text-amber-300">
                    Wallet account changed
                  </p>
                  <p className="text-xs text-amber-700 dark:text-amber-400 mt-0.5">
                    Your wallet is now on {shortenAddress(accountMismatch.liveAddress, 8)}, but the
                    address below still targets your previous account. Reconnect to update the
                    receive address and QR code before sharing them.
                  </p>
                </div>
              </div>
              {wallet.activeWalletId && (
                <button
                  onClick={() => connect(wallet.activeWalletId!)}
                  className="shrink-0 px-4 py-2 rounded-lg bg-amber-600 text-white text-sm font-medium hover:bg-amber-700 transition-colors"
                >
                  Reconnect
                </button>
              )}
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* QR code */}
          <Card className="p-8 flex flex-col items-center text-center">
            <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-700 p-4 shadow-sm">
              <QrCode
                value={buildReceivePayload(address)}
                size={220}
                title="Receive QR code — SEP-7 pay URI"
              />
            </div>
            <p className="mt-4 text-sm text-gray-600 dark:text-gray-400 max-w-xs">
              Scan with any SEP-7-compatible Stellar wallet to send a payment
              to this address.
            </p>
          </Card>

          {/* Address */}
          <Card className="p-8">
            <h2 className="text-sm font-semibold text-gray-900 dark:text-white">
              Your Stellar address
            </h2>
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
              Share this address directly, or copy the SEP-7 payment URI.
            </p>

            <div className="mt-5 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 p-4">
              <p className="text-[11px] font-medium uppercase tracking-wide text-gray-400 dark:text-gray-500 mb-1">
                Address
              </p>
              <p className="font-mono text-sm text-gray-900 dark:text-white break-all">
                {address}
              </p>
              <div className="flex items-center gap-2 mt-3">
                <CopyButton value={address} label="Address" />
                <a
                  href={getAccountExplorerUrl(address)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-ophir-600 dark:text-ophir-400 hover:underline"
                >
                  View on explorer
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="h-3 w-3">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
                  </svg>
                </a>
              </div>
            </div>

            <div className="mt-4 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 p-4">
              <p className="text-[11px] font-medium uppercase tracking-wide text-gray-400 dark:text-gray-500 mb-1">
                SEP-7 payment URI
              </p>
              <p className="font-mono text-xs text-gray-900 dark:text-white break-all">
                {buildReceivePayload(address)}
              </p>
              <div className="flex items-center gap-2 mt-3">
                <CopyButton value={buildReceivePayload(address)} label="Payment URI" />
              </div>
            </div>

            <p className="mt-6 text-xs text-gray-400 dark:text-gray-500">
              Shortened:{" "}
              <span className="font-mono">{shortenAddress(address, 8)}</span>
            </p>
          </Card>
          </div>
        </div>
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
