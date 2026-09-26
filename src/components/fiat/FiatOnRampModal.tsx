"use client";
// SPDX-License-Identifier: MIT

import { useState, useEffect, useRef } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { useWallet } from "@/hooks/useMultiWallet";
import { getStellarExplorerUrl } from "@/lib/stellar";
import { shortenAddress } from "@/lib/utils";
import type { Sep24AnchorConfig, Sep24Transaction } from "@/lib/sep24/types";

interface FiatOnRampModalProps {
  open: boolean;
  onClose: () => void;
  initialKind?: "deposit" | "withdrawal";
  onSuccess?: (tx: Sep24Transaction) => void;
}

export function FiatOnRampModal({
  open,
  onClose,
  initialKind = "deposit",
  onSuccess,
}: FiatOnRampModalProps) {
  const { wallet } = useWallet();
  const [kind, setKind] = useState<"deposit" | "withdrawal">(initialKind);
  const [assetCode, setAssetCode] = useState<string>("USDC");
  const [amount, setAmount] = useState<string>("100");
  const [anchorDomain, setAnchorDomain] = useState<string>("testnet.kado.sh");
  const [anchorConfig, setAnchorConfig] = useState<Sep24AnchorConfig | null>(null);
  const [discovering, setDiscovering] = useState<boolean>(false);
  const [initiating, setInitiating] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Active session
  const [activeSession, setActiveSession] = useState<{
    transactionId: string;
    interactiveUrl: string;
  } | null>(null);

  const [transaction, setTransaction] = useState<Sep24Transaction | null>(null);
  const [polling, setPolling] = useState<boolean>(false);
  const pollTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Fetch anchor info when opened or domain changes
  useEffect(() => {
    if (!open) {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
      return;
    }

    let isMounted = true;
    const fetchAnchor = async () => {
      setDiscovering(true);
      setError(null);
      try {
        const res = await fetch(`/api/fiat/anchor?domain=${encodeURIComponent(anchorDomain)}`);
        const json = await res.json();
        if (isMounted) {
          if (res.ok && json.data) {
            setAnchorConfig(json.data);
          } else {
            setError(json.error?.message || "Failed to discover anchor");
          }
        }
      } catch (err: unknown) {
        if (isMounted) {
          setError(err instanceof Error ? err.message : "Anchor connection failed");
        }
      } finally {
        if (isMounted) setDiscovering(false);
      }
    };

    fetchAnchor();
    return () => {
      isMounted = false;
    };
  }, [open, anchorDomain]);

  // Status polling loop for active transaction
  useEffect(() => {
    if (!activeSession) return;

    setPolling(true);
    const poll = async () => {
      try {
        const res = await fetch(
          `/api/fiat/transaction/${encodeURIComponent(activeSession.transactionId)}?domain=${encodeURIComponent(
            anchorDomain
          )}&assetCode=${assetCode}`
        );
        const json = await res.json();
        if (res.ok && json.data?.transaction) {
          const tx: Sep24Transaction = json.data.transaction;
          setTransaction(tx);

          if (tx.status === "completed") {
            setPolling(false);
            if (pollTimerRef.current) clearInterval(pollTimerRef.current);
            if (onSuccess) onSuccess(tx);
          } else if (tx.status === "error" || tx.status === "expired") {
            setPolling(false);
            if (pollTimerRef.current) clearInterval(pollTimerRef.current);
          }
        }
      } catch {
        // Continue polling
      }
    };

    poll();
    pollTimerRef.current = setInterval(poll, 3000);

    return () => {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    };
  }, [activeSession, anchorDomain, assetCode, onSuccess]);

  const handleInitiate = async () => {
    if (!wallet.publicKey) {
      setError("Please connect your Stellar wallet first");
      return;
    }

    setInitiating(true);
    setError(null);

    try {
      const res = await fetch("/api/fiat/initiate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind,
          assetCode,
          account: wallet.publicKey,
          amount: Number(amount) || undefined,
          domain: anchorDomain,
        }),
      });

      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error?.message || "Failed to initiate flow");
      }

      setActiveSession({
        transactionId: json.data.transactionId,
        interactiveUrl: json.data.interactiveUrl,
      });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Error initiating anchor flow");
    } finally {
      setInitiating(false);
    }
  };

  const handleReset = () => {
    if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    setActiveSession(null);
    setTransaction(null);
    setError(null);
  };

  const isCompleted = transaction?.status === "completed";
  const isFailed = transaction?.status === "error" || transaction?.status === "expired";

  return (
    <Modal
      open={open}
      onClose={() => {
        if (pollTimerRef.current) clearInterval(pollTimerRef.current);
        onClose();
      }}
      title={kind === "deposit" ? "Fiat On-Ramp (Buy Crypto)" : "Fiat Off-Ramp (Cash Out)"}
      size="lg"
    >
      <div className="space-y-5 py-2">
        {/* Tab Selector */}
        {!activeSession && (
          <div className="flex border-b border-gray-200 dark:border-gray-700">
            <button
              className={`pb-2.5 px-4 text-sm font-semibold border-b-2 transition-colors ${
                kind === "deposit"
                  ? "border-ophir-600 text-ophir-600 dark:text-ophir-400"
                  : "border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400"
              }`}
              onClick={() => {
                setKind("deposit");
                setError(null);
              }}
            >
              Deposit (Fiat → Crypto)
            </button>
            <button
              className={`pb-2.5 px-4 text-sm font-semibold border-b-2 transition-colors ${
                kind === "withdrawal"
                  ? "border-ophir-600 text-ophir-600 dark:text-ophir-400"
                  : "border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400"
              }`}
              onClick={() => {
                setKind("withdrawal");
                setError(null);
              }}
            >
              Withdraw (Crypto → Fiat)
            </button>
          </div>
        )}

        {/* Error Alert */}
        {error && (
          <div className="p-3 text-sm bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-300 rounded border border-red-200 dark:border-red-800">
            {error}
          </div>
        )}

        {/* Step 1: Configuration Form */}
        {!activeSession && (
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                Asset
              </label>
              <select
                value={assetCode}
                onChange={(e) => setAssetCode(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
              >
                <option value="USDC">USDC (USD Coin)</option>
                <option value="XLM">XLM (Native Lumens)</option>
                <option value="EURC">EURC (Euro Coin)</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                Estimated Amount ({kind === "deposit" ? "USD" : assetCode})
              </label>
              <input
                type="number"
                min="1"
                step="any"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="100.00"
                className="w-full px-3 py-2 text-sm rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                Anchor Domain (SEP-1 Discovery)
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={anchorDomain}
                  onChange={(e) => setAnchorDomain(e.target.value)}
                  placeholder="testnet.kado.sh"
                  className="flex-1 px-3 py-2 text-sm rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white font-mono"
                />
                <Button
                  size="sm"
                  variant="outline"
                  loading={discovering}
                  onClick={() => setAnchorDomain(anchorDomain)}
                >
                  Discover
                </Button>
              </div>
            </div>

            {/* Anchor Info Badge */}
            {anchorConfig && (
              <div className="p-3 bg-gray-50 dark:bg-gray-800/60 rounded border border-gray-200 dark:border-gray-700 text-xs space-y-1">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-gray-700 dark:text-gray-300">
                    Discovered Anchor: {anchorConfig.orgName || anchorConfig.domain}
                  </span>
                  <Badge variant="success">SEP-24 Ready</Badge>
                </div>
                <p className="text-gray-500 font-mono break-all">
                  Endpoint: {anchorConfig.transferServerSep24}
                </p>
              </div>
            )}

            {/* Destination / Source Address */}
            <div className="p-3 bg-blue-50 dark:bg-blue-950/30 rounded border border-blue-200 dark:border-blue-900 text-xs">
              <span className="font-semibold text-blue-800 dark:text-blue-200">Stellar Account: </span>
              {wallet.publicKey ? (
                <span className="font-mono text-blue-900 dark:text-blue-100">
                  {shortenAddress(wallet.publicKey, 12)}
                </span>
              ) : (
                <span className="text-amber-600 dark:text-amber-400">Wallet not connected</span>
              )}
            </div>

            {/* Compliance & KYC Notice */}
            <div className="p-3 bg-amber-50 dark:bg-amber-950/20 rounded border border-amber-200 dark:border-amber-800 text-xs text-amber-800 dark:text-amber-300">
              <p className="font-semibold mb-0.5">🛡️ Regulatory & KYC Compliance Boundary</p>
              <p>
                OphirPay is non-custodial and never holds fiat currency. Identity verification (KYC/AML)
                and payment processing are performed entirely inside the regulated anchor&apos;s interface.
              </p>
            </div>

            <Button
              className="w-full"
              loading={initiating}
              disabled={!wallet.publicKey || discovering || !anchorConfig}
              onClick={handleInitiate}
            >
              Continue to {anchorConfig?.orgName || "Anchor"} Interactive Window →
            </Button>
          </div>
        )}

        {/* Step 2: Interactive Session & Progress Polling */}
        {activeSession && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-gray-500">Transaction ID</p>
                <p className="text-sm font-mono font-semibold text-gray-900 dark:text-white">
                  {activeSession.transactionId}
                </p>
              </div>
              <div>
                {isCompleted ? (
                  <Badge variant="success">✔ Completed</Badge>
                ) : isFailed ? (
                  <Badge variant="danger">✖ Failed</Badge>
                ) : (
                  <Badge variant="warning">⏳ {transaction?.status || "In Progress"}</Badge>
                )}
              </div>
            </div>

            {/* Interactive Link Action */}
            <div className="p-4 bg-gray-50 dark:bg-gray-800/60 rounded border border-gray-200 dark:border-gray-700 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-gray-900 dark:text-white">
                  Anchor Verification Session
                </p>
                <p className="text-xs text-gray-500">
                  Complete identity check and bank transfer in the anchor window.
                </p>
              </div>
              <a
                href={activeSession.interactiveUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center px-4 py-2 text-xs font-semibold text-white bg-ophir-600 rounded hover:bg-ophir-700 transition"
              >
                Open Anchor Window ↗
              </a>
            </div>

            {/* Embedded Iframe Preview */}
            <div className="border border-gray-200 dark:border-gray-700 rounded overflow-hidden h-72 bg-white">
              <iframe
                src={activeSession.interactiveUrl}
                title="Anchor Interactive Verification"
                className="w-full h-full border-0"
                sandbox="allow-forms allow-scripts allow-same-origin allow-popups"
              />
            </div>

            {/* Progress Information */}
            <div className="text-xs space-y-1 text-gray-600 dark:text-gray-300">
              <p>
                <strong>Status:</strong> {transaction?.status || "Awaiting customer interaction..."}
              </p>
              {transaction?.amountOut && (
                <p>
                  <strong>Amount Out:</strong> {transaction.amountOut} {assetCode}
                </p>
              )}
              {transaction?.stellarTransactionId && (
                <p className="font-mono">
                  <strong>Stellar Tx:</strong>{" "}
                  <a
                    href={getStellarExplorerUrl(transaction.stellarTransactionId)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-ophir-600 hover:underline"
                  >
                    {shortenAddress(transaction.stellarTransactionId, 12)} ↗
                  </a>
                </p>
              )}
            </div>

            {isCompleted && (
              <div className="p-3 bg-green-50 dark:bg-green-950/30 rounded border border-green-200 dark:border-green-800 text-xs text-green-800 dark:text-green-300 flex items-center gap-2">
                <span>✔</span>
                <span>
                  Deposit complete! Funds have been credited to your Stellar wallet and recorded in your payment history.
                </span>
              </div>
            )}

            <div className="flex gap-2 justify-end pt-2">
              <Button variant="outline" size="sm" onClick={handleReset}>
                New Flow
              </Button>
              <Button size="sm" onClick={onClose}>
                Done
              </Button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
