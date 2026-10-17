"use client";
// SPDX-License-Identifier: MIT

import { useState, useCallback } from "react";
import { TransactionBuilder } from "@stellar/stellar-sdk";
import { cn } from "@/lib/utils";
import {
  XLM_ASSET,
  USDC_TESTNET,
  USDC_MAINNET,
  type AssetInfo,
} from "@/lib/assets";
import {
  getHorizonServer,
  NETWORK_PASSPHRASE,
  STELLAR_NETWORK,
} from "@/lib/stellar";
import {
  buildTrustlineTransaction,
  checkTrustline,
  type TrustlineState,
} from "@/lib/trustline";
import { getActiveWalletConnector } from "@/lib/wallets";

interface TrustlineModalProps {
  open: boolean;
  onClose: () => void;
  asset: AssetInfo;
  publicKey: string;
  onTrustlineEstablished?: () => void;
}

/**
 * Modal for creating a trustline for a non-native Stellar asset.
 * Guides the user through the changeTrust operation via their connected wallet.
 */
export function TrustlineModal({
  open,
  onClose,
  asset,
  publicKey,
  onTrustlineEstablished,
}: TrustlineModalProps) {
  const [status, setStatus] = useState<
    "idle" | "checking" | "missing" | "signing" | "submitting" | "confirming" | "error" | "success"
  >("idle");
  const [error, setError] = useState<string | null>(null);
  const [trustlineState, setTrustlineState] = useState<TrustlineState | null>(
    null,
  );

  const checkExistingTrustline = useCallback(async () => {
    if (!asset.issuer) return;
    setStatus("checking");
    setError(null);
    try {
      const info = await checkTrustline(publicKey, asset.code, asset.issuer);
      setTrustlineState(info.state);
      if (info.hasTrustline && info.state === "authorized") {
        setStatus("success");
      } else {
        setStatus("missing");
      }
    } catch {
      setTrustlineState("unavailable");
      setStatus("missing");
    }
  }, [asset.code, asset.issuer, publicKey]);

  const handleCreateTrustline = async () => {
    if (!asset.issuer) return;
    setStatus("signing");
    setError(null);
    try {
      const connector = getActiveWalletConnector();
      if (!connector) {
        throw new Error("Reconnect your wallet to create this trustline.");
      }

      // Build the changeTrust transaction
      const { xdr } = await buildTrustlineTransaction(
        publicKey,
        asset.code,
        asset.issuer,
      );

      // Sign with the connected wallet
      setStatus("signing");
      const signedXdr = await connector.signTransaction(xdr, {
        network: STELLAR_NETWORK,
        networkPassphrase: NETWORK_PASSPHRASE,
      });

      // Submit to the network
      setStatus("submitting");
      const transaction = TransactionBuilder.fromXDR(
        signedXdr,
        NETWORK_PASSPHRASE,
      );
      const response = await getHorizonServer().submitTransaction(transaction);

      if (!response.successful) {
        throw new Error("Transaction failed. Please try again.");
      }

      // Confirm the trustline is active
      setStatus("confirming");
      const verifiedInfo = await checkTrustline(
        publicKey,
        asset.code,
        asset.issuer,
      );
      setTrustlineState(verifiedInfo.state);
      setStatus("success");
      onTrustlineEstablished?.();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to create trustline.",
      );
      setStatus("error");
    }
  };

  const handleClose = () => {
    setStatus("idle");
    setError(null);
    setTrustlineState(null);
    onClose();
  };

  if (!open) return null;

  const isProcessing =
    status === "checking" ||
    status === "signing" ||
    status === "submitting" ||
    status === "confirming";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div
        className="fixed inset-0 bg-black/50"
        onClick={handleClose}
        aria-hidden="true"
      />
      <div className="relative z-10 w-full max-w-md mx-4 bg-white dark:bg-gray-800 rounded-xl shadow-2xl p-6 animate-fade-in">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
            Create Trustline
          </h2>
          <button
            type="button"
            onClick={handleClose}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
          >
            <svg
              className="w-5 h-5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        <div className="space-y-4">
          <div className="flex items-center gap-3 p-3 rounded-lg bg-gray-50 dark:bg-gray-700/50">
            <span className="w-10 h-10 rounded-full bg-ophir-100 dark:bg-ophir-900/30 flex items-center justify-center text-sm font-bold text-ophir-700 dark:text-ophir-300">
              {asset.code.slice(0, 2)}
            </span>
            <div>
              <p className="font-medium text-gray-900 dark:text-white">
                {asset.code}
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {asset.displayName}
              </p>
            </div>
          </div>

          {trustlineState && (
            <div
              className={cn(
                "p-3 rounded-lg text-sm",
                trustlineState === "authorized"
                  ? "bg-green-50 dark:bg-green-950/30 text-green-800 dark:text-green-300"
                  : trustlineState === "missing"
                    ? "bg-amber-50 dark:bg-amber-950/30 text-amber-800 dark:text-amber-300"
                    : "bg-red-50 dark:bg-red-950/30 text-red-800 dark:text-red-300",
              )}
            >
              {trustlineState === "authorized" && (
                <p>Trustline is active and ready for transfers.</p>
              )}
              {trustlineState === "missing" && (
                <p>
                  You need to establish a trustline for {asset.code} before this
                  account can hold it.
                </p>
              )}
              {trustlineState === "frozen" && (
                <p>
                  This trustline is frozen by the issuer. Contact the issuer to
                  re-enable it.
                </p>
              )}
              {trustlineState === "unauthorized" && (
                <p>
                  This trustline exists but has not been authorized for transfers.
                </p>
              )}
            </div>
          )}

          {error && (
            <div
              role="alert"
              className="p-3 rounded-lg bg-red-50 dark:bg-red-950/30 text-red-800 dark:text-red-300 text-sm"
            >
              {error}
            </div>
          )}

          <div className="text-xs text-gray-500 dark:text-gray-400">
            <p>
              Creating a trustline requires additional XLM for the network reserve
              (0.5 XLM) plus a small transaction fee.
            </p>
          </div>

          <div className="flex gap-3">
            <button
              type="button"
              onClick={handleClose}
              className="flex-1 px-4 py-2 rounded-lg border border-gray-200 dark:border-gray-700 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
            >
              Cancel
            </button>
            {status === "success" ? (
              <button
                type="button"
                onClick={handleClose}
                className="flex-1 px-4 py-2 rounded-lg bg-green-600 text-white text-sm font-medium hover:bg-green-700"
              >
                Done
              </button>
            ) : (
              <button
                type="button"
                onClick={
                  status === "idle" || status === "missing"
                    ? handleCreateTrustline
                    : checkExistingTrustline
                }
                disabled={isProcessing || !asset.issuer}
                className="flex-1 px-4 py-2 rounded-lg bg-ophir-600 text-white text-sm font-medium hover:bg-ophir-700 disabled:opacity-50"
              >
                {isProcessing
                  ? status === "checking"
                    ? "Checking..."
                    : status === "signing"
                      ? "Sign in wallet..."
                      : status === "submitting"
                        ? "Submitting..."
                        : "Confirming..."
                  : status === "error"
                    ? "Try again"
                    : status === "success"
                      ? "Verify again"
                      : "Create trustline"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Check if the selected asset requires a trustline and return the trustline state.
 * Returns null for native assets (XLM).
 */
export function useTrustlineCheck(
  publicKey: string | null,
  asset: AssetInfo,
) {
  const [trustlineStatus, setTrustlineStatus] = useState<{
    hasTrustline: boolean;
    checking: boolean;
    state: TrustlineState | null;
  }>({ hasTrustline: false, checking: false, state: null });

  const checkTrustlineStatus = useCallback(async () => {
    if (!publicKey || asset.type === "native" || !asset.issuer) {
      setTrustlineStatus({
        hasTrustline: false,
        checking: false,
        state: null,
      });
      return;
    }

    setTrustlineStatus((prev) => ({ ...prev, checking: true }));
    try {
      const info = await checkTrustline(publicKey, asset.code, asset.issuer);
      setTrustlineStatus({
        hasTrustline: info.hasTrustline,
        checking: false,
        state: info.state,
      });
    } catch {
      setTrustlineStatus({
        hasTrustline: false,
        checking: false,
        state: "unavailable",
      });
    }
  }, [publicKey, asset.code, asset.issuer, asset.type]);

  return { ...trustlineStatus, refresh: checkTrustlineStatus };
}

/**
 * Badge component that shows trustline status for a selected asset.
 */
export function TrustlineBadge({
  state,
  checking,
}: {
  state: TrustlineState | null;
  checking: boolean;
}) {
  if (checking) {
    return (
      <span className="text-xs text-gray-400 animate-pulse">
        Checking trustline...
      </span>
    );
  }

  if (!state) return null;

  const config = {
    authorized: {
      label: "Trustline active",
      className: "text-green-500",
    },
    missing: {
      label: "Trustline Required",
      className: "text-amber-500",
    },
    frozen: {
      label: "Frozen",
      className: "text-red-500",
    },
    unauthorized: {
      label: "Unauthorized",
      className: "text-red-500",
    },
    unavailable: {
      label: "Status unavailable",
      className: "text-gray-400",
    },
  }[state];

  return (
    <span className={cn("text-xs font-medium", config.className)}>
      {config.label}
    </span>
  );
}
