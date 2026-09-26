"use client";
// SPDX-License-Identifier: MIT

import { useEffect, useState, useCallback } from "react";
import { useWallet } from "@/hooks/useMultiWallet";
import { buildReceivePayload } from "@/lib/stellar-uri";
import { getAccountExplorerUrl } from "@/lib/stellar";
import { shortenAddress } from "@/lib/utils";
import { getWalletConnector, type WalletId } from "@/lib/wallets";
import { Breadcrumb } from "@/components/Breadcrumb";
import { WalletSelector } from "@/components/WalletSelector";
import { AssetSelector } from "@/components/AssetSelector";
import { XLM_ASSET, type AssetInfo } from "@/lib/assets";
import {
  checkTrustline,
  establishTrustlineWithWallet,
  TRUSTLINE_ONE_SENTENCE_EXPLANATION,
  BASE_RESERVE_PER_TRUSTLINE_XLM,
  getTrustlineStatusMessage,
  type TrustlineInfo,
} from "@/lib/trustline";
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

  // Asset selection and trustline state
  const [selectedAsset, setSelectedAsset] = useState<AssetInfo>(XLM_ASSET);
  const [trustlineInfo, setTrustlineInfo] = useState<TrustlineInfo | null>(null);
  const [isCheckingTrustline, setIsCheckingTrustline] = useState(false);
  const [isSettingUpTrustline, setIsSettingUpTrustline] = useState(false);
  const [trustlineError, setTrustlineError] = useState<string | null>(null);
  const [trustlineSuccess, setTrustlineSuccess] = useState<string | null>(null);

  // Re-check live account from connector on mount and window focus
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
        // Wallet unavailable or read failed
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
      // Handled by provider
    } finally {
      setConnectingWallet(null);
    }
  };

  const address = wallet.publicKey;

  // Inspect trustline for the selected asset
  const refreshTrustline = useCallback(async () => {
    if (!address || selectedAsset.type === "native" || !selectedAsset.issuer) {
      setTrustlineInfo(null);
      setTrustlineError(null);
      return;
    }

    setIsCheckingTrustline(true);
    setTrustlineError(null);
    try {
      const info = await checkTrustline(address, selectedAsset.code, selectedAsset.issuer);
      setTrustlineInfo(info);
    } catch (err) {
      setTrustlineError(
        err instanceof Error ? err.message : "Failed to inspect trustline"
      );
    } finally {
      setIsCheckingTrustline(false);
    }
  }, [address, selectedAsset]);

  useEffect(() => {
    refreshTrustline();
  }, [refreshTrustline]);

  // Establish trustline via active connected wallet
  const handleEstablishTrustline = async () => {
    if (!address || !wallet.activeWalletId || !selectedAsset.issuer) return;
    setIsSettingUpTrustline(true);
    setTrustlineError(null);
    setTrustlineSuccess(null);
    try {
      const result = await establishTrustlineWithWallet({
        walletId: wallet.activeWalletId,
        publicKey: address,
        assetCode: selectedAsset.code,
        assetIssuer: selectedAsset.issuer,
      });

      if (result.success) {
        setTrustlineSuccess(
          `Trustline successfully established on Stellar for ${selectedAsset.code}! You can now receive payments.`
        );
        await refreshTrustline();
      }
    } catch (err) {
      setTrustlineError(
        err instanceof Error
          ? err.message
          : `Failed to establish trustline. Ensure you hold at least ${BASE_RESERVE_PER_TRUSTLINE_XLM} XLM reserve balance.`
      );
    } finally {
      setIsSettingUpTrustline(false);
    }
  };

  // Build the SEP-7 receive URI (includes asset code/issuer when non-native)
  const receiveUri = address
    ? buildReceivePayload(
        address,
        selectedAsset.type !== "native" && selectedAsset.issuer
          ? { code: selectedAsset.code, issuer: selectedAsset.issuer }
          : undefined
      )
    : "";

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
            <svg
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={1.5}
              stroke="currentColor"
              className="h-7 w-7 text-ophir-600 dark:text-ophir-400"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M2.25 8.25h19.5M2.25 9h19.5m-16.5 5.25h6m-6 2.25h3m-3.75 3h15a2.25 2.25 0 002.25-2.25V6.75A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25v10.5A2.25 2.25 0 004.5 19.5z"
              />
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
          {/* Account mismatch warning */}
          {accountMismatch && (
            <div
              role="alert"
              className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 px-4 py-3"
            >
              <div className="flex items-start gap-3 min-w-0">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={1.5}
                  stroke="currentColor"
                  className="h-5 w-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"
                  />
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

          {/* Asset Selection & Trustline Step */}
          <Card className="p-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-gray-100 dark:border-gray-800">
              <div>
                <h2 className="text-sm font-semibold text-gray-900 dark:text-white">
                  Asset to Receive
                </h2>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                  Select the currency you expect to receive to verify network trustlines
                </p>
              </div>
              <div className="w-full sm:w-64">
                <AssetSelector
                  publicKey={address}
                  selectedAsset={selectedAsset}
                  onSelect={(asset) => {
                    setSelectedAsset(asset);
                    setTrustlineSuccess(null);
                    setTrustlineError(null);
                  }}
                  showTrustlineNotice={false}
                />
              </div>
            </div>

            {/* Trustline status & guided setup */}
            <div className="mt-4">
              {selectedAsset.type === "native" ? (
                <div className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-400">
                  <span className="w-2 h-2 rounded-full bg-green-500"></span>
                  <span>
                    Native Stellar Lumens (XLM) — accepted by all funded accounts without a trustline.
                  </span>
                </div>
              ) : isCheckingTrustline ? (
                <p className="text-xs text-gray-400 animate-pulse">
                  Checking {selectedAsset.code} trustline status on Stellar...
                </p>
              ) : (
                <div className="space-y-3">
                  {/* State 1: No Trustline */}
                  {(!trustlineInfo?.hasTrustline || trustlineInfo?.status === "no_trustline") && (
                    <div
                      role="region"
                      aria-label="Trustline setup notice"
                      data-testid="receive-trustline-setup"
                      className="p-4 rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 text-amber-900 dark:text-amber-200"
                    >
                      <div className="flex items-start gap-3">
                        <div className="w-8 h-8 rounded-lg bg-amber-100 dark:bg-amber-900/50 flex items-center justify-center shrink-0 mt-0.5">
                          <svg
                            className="w-5 h-5 text-amber-600 dark:text-amber-400"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                            />
                          </svg>
                        </div>
                        <div className="space-y-1.5 flex-1 min-w-0">
                          <p className="text-sm font-semibold text-amber-800 dark:text-amber-300">
                            Trustline Required to Receive {selectedAsset.code}
                          </p>
                          <p className="text-xs text-amber-700 dark:text-amber-400 leading-relaxed">
                            {TRUSTLINE_ONE_SENTENCE_EXPLANATION}
                          </p>
                          <p className="text-xs text-amber-800 dark:text-amber-300 font-medium">
                            Base reserve requirement: {BASE_RESERVE_PER_TRUSTLINE_XLM} XLM will be reserved on your account.
                          </p>
                          <p className="text-xs text-amber-600 dark:text-amber-500">
                            Senders will encounter a failure if they attempt to pay you before this trustline is created.
                          </p>

                          <div className="pt-2">
                            <button
                              type="button"
                              onClick={handleEstablishTrustline}
                              disabled={isSettingUpTrustline}
                              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-700 text-white font-medium text-xs shadow-sm transition-colors cursor-pointer disabled:opacity-50"
                            >
                              {isSettingUpTrustline ? (
                                <>
                                  <svg
                                    className="animate-spin h-3.5 w-3.5 text-white"
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
                                      d="M4 12a8 8 0 018-8v8H4z"
                                    />
                                  </svg>
                                  Signing & submitting transaction...
                                </>
                              ) : (
                                `Establish Trustline for ${selectedAsset.code}`
                              )}
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* State 2: Authorized */}
                  {trustlineInfo?.status === "authorized" && (
                    <div
                      role="region"
                      aria-label="Trustline authorized"
                      data-testid="receive-trustline-authorized"
                      className="p-3.5 rounded-xl border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/30 text-emerald-900 dark:text-emerald-200 flex items-center justify-between gap-3 text-xs"
                    >
                      <div className="flex items-center gap-2.5">
                        <span className="w-5 h-5 rounded-full bg-emerald-100 dark:bg-emerald-900/50 flex items-center justify-center text-emerald-600 dark:text-emerald-400 font-bold shrink-0">
                          ✓
                        </span>
                        <div>
                          <p className="font-semibold text-emerald-800 dark:text-emerald-300">
                            Trustline Active & Authorized
                          </p>
                          <p className="text-emerald-700 dark:text-emerald-400 mt-0.5">
                            {getTrustlineStatusMessage("authorized", selectedAsset.code)}
                          </p>
                        </div>
                      </div>
                      <span className="text-[11px] font-mono text-emerald-600 dark:text-emerald-400 shrink-0">
                        Balance: {trustlineInfo.balance ?? "0"} {selectedAsset.code}
                      </span>
                    </div>
                  )}

                  {/* State 3: Frozen */}
                  {trustlineInfo?.status === "frozen" && (
                    <div
                      role="alert"
                      data-testid="receive-trustline-frozen"
                      className="p-3.5 rounded-xl border border-rose-200 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/30 text-rose-900 dark:text-rose-200 text-xs"
                    >
                      <p className="font-semibold text-rose-800 dark:text-rose-300 flex items-center gap-1.5">
                        <span>⚠️</span> Trustline Frozen
                      </p>
                      <p className="mt-1 text-rose-700 dark:text-rose-400 leading-relaxed">
                        {getTrustlineStatusMessage("frozen", selectedAsset.code)}
                      </p>
                    </div>
                  )}

                  {/* State 4: Unauthorized */}
                  {trustlineInfo?.status === "unauthorized" && (
                    <div
                      role="alert"
                      data-testid="receive-trustline-unauthorized"
                      className="p-3.5 rounded-xl border border-orange-200 dark:border-orange-800 bg-orange-50 dark:bg-orange-950/30 text-orange-900 dark:text-orange-200 text-xs"
                    >
                      <p className="font-semibold text-orange-800 dark:text-orange-300 flex items-center gap-1.5">
                        <span>⚠️</span> Trustline Unauthorized
                      </p>
                      <p className="mt-1 text-orange-700 dark:text-orange-400 leading-relaxed">
                        {getTrustlineStatusMessage("unauthorized", selectedAsset.code)}
                      </p>
                    </div>
                  )}

                  {/* Success banner */}
                  {trustlineSuccess && (
                    <div
                      role="status"
                      className="p-3 rounded-lg bg-emerald-100 dark:bg-emerald-950/50 border border-emerald-300 dark:border-emerald-700 text-xs text-emerald-800 dark:text-emerald-200"
                    >
                      {trustlineSuccess}
                    </div>
                  )}

                  {/* Error banner */}
                  {trustlineError && (
                    <div
                      role="alert"
                      className="p-3 rounded-lg bg-rose-100 dark:bg-rose-950/50 border border-rose-300 dark:border-rose-700 text-xs text-rose-800 dark:text-rose-200"
                    >
                      {trustlineError}
                    </div>
                  )}
                </div>
              )}
            </div>
          </Card>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* QR code */}
            <Card className="p-8 flex flex-col items-center text-center">
              <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-700 p-4 shadow-sm relative">
                <QrCode
                  value={receiveUri}
                  size={220}
                  title="Receive QR code — SEP-7 pay URI"
                />
              </div>
              <p className="mt-4 text-sm text-gray-600 dark:text-gray-400 max-w-xs">
                Scan with any SEP-7-compatible Stellar wallet to send a payment
                to this address.
              </p>
              {selectedAsset.type !== "native" && (
                <span className="mt-2 inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300">
                  Asset: {selectedAsset.code}
                </span>
              )}
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
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      fill="none"
                      viewBox="0 0 24 24"
                      strokeWidth={2}
                      stroke="currentColor"
                      className="h-3 w-3"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25"
                      />
                    </svg>
                  </a>
                </div>
              </div>

              <div className="mt-4 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 p-4">
                <p className="text-[11px] font-medium uppercase tracking-wide text-gray-400 dark:text-gray-500 mb-1">
                  SEP-7 payment URI
                </p>
                <p className="font-mono text-xs text-gray-900 dark:text-white break-all">
                  {receiveUri}
                </p>
                <div className="flex items-center gap-2 mt-3">
                  <CopyButton value={receiveUri} label="Payment URI" />
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
