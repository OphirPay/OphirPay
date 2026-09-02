"use client";
// SPDX-License-Identifier: MIT

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { useToast } from "@/components/ui/Toast";
import { useWallet } from "@/hooks/useMultiWallet";
import { useApiQuery } from "@/hooks/useApiQuery";
import {
  emergencyPauseAll,
  emergencyUnpauseAll,
} from "@/lib/contract-advanced";
import { getStellarExplorerUrl } from "@/lib/stellar";
import { shortenAddress } from "@/lib/utils";
import Link from "next/link";

interface PauseStateData {
  paused: boolean | "unknown";
  available: boolean;
}

export default function PauseControlsPage() {
  const toast = useToast();
  const { wallet } = useWallet();
  const queryClient = useQueryClient();
  const [submitting, setSubmitting] = useState(false);
  const [lastTxHash, setLastTxHash] = useState<string | null>(null);

  const {
    data: rawData,
    isLoading: loading,
  } = useApiQuery<PauseStateData>(
    ["pause-state"],
    "/api/pause-state",
  );
  const pauseState = rawData?.paused ?? "unknown";
  const isPaused = pauseState === true;
  const isUnknown = pauseState === "unknown";
  const contractAvailable = rawData?.available ?? false;

  const handlePause = async () => {
    if (!wallet.publicKey) {
      toast.error("Connect your wallet first");
      return;
    }
    setSubmitting(true);
    setLastTxHash(null);
    try {
      const result = await emergencyPauseAll(wallet.publicKey);
      if (result.success) {
        toast.success("Contract paused on-chain — all writes are now blocked");
        setLastTxHash(result.txHash ?? null);
        queryClient.invalidateQueries({ queryKey: ["pause-state"] });
      } else if (result.txHash) {
        // Transaction was submitted but hasn't confirmed yet — NOT a failure
        setLastTxHash(result.txHash);
        toast.warning("Transaction submitted — confirmation is taking longer than expected. Check back or verify on-chain.");
        queryClient.invalidateQueries({ queryKey: ["pause-state"] });
      } else {
        toast.error(result.error || "Pause failed — are you the contract owner?");
      }
    } catch {
      toast.error("Network error");
    } finally {
      setSubmitting(false);
    }
  };

  const handleUnpause = async () => {
    if (!wallet.publicKey) {
      toast.error("Connect your wallet first");
      return;
    }
    setSubmitting(true);
    setLastTxHash(null);
    try {
      const result = await emergencyUnpauseAll(wallet.publicKey);
      if (result.success) {
        toast.success("Contract unpaused on-chain — writes are now enabled");
        setLastTxHash(result.txHash ?? null);
        queryClient.invalidateQueries({ queryKey: ["pause-state"] });
      } else if (result.txHash) {
        // Transaction was submitted but hasn't confirmed yet — NOT a failure
        setLastTxHash(result.txHash);
        toast.warning("Transaction submitted — confirmation is taking longer than expected. Check back or verify on-chain.");
        queryClient.invalidateQueries({ queryKey: ["pause-state"] });
      } else {
        toast.error(result.error || "Unpause failed — are you the contract owner?");
      }
    } catch {
      toast.error("Network error");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="animate-fade-in space-y-6">
        <div className="h-8 w-48 bg-gray-200 dark:bg-gray-700 rounded animate-pulse" />
        <div className="h-40 bg-gray-100 dark:bg-gray-800 rounded animate-pulse" />
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      {!wallet.connected && (
        <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-lg p-4 flex items-center gap-3 animate-fade-in">
          <span className="text-amber-500 text-lg">⚠️</span>
          <div>
            <p className="text-sm font-medium text-amber-800 dark:text-amber-200">Wallet not connected</p>
            <p className="text-xs text-amber-600 dark:text-amber-400">
              Connect your wallet to pause or unpause the contract on-chain.
            </p>
          </div>
        </div>
      )}

      <div>
        <Link href="/" className="text-sm text-gray-500 hover:text-gray-700 transition-colors">← Dashboard</Link>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white mt-2">Contract Pause Controls</h1>
        <p className="text-gray-500 dark:text-gray-400 mt-1">
          Emergency circuit breaker — pause or unpause all contract writes
        </p>
      </div>

      {/* Pause State Display */}
      <Card className="p-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Current State</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              {isPaused
                ? "All write operations are currently blocked. Read-only queries still work."
                : isUnknown
                  ? "Unable to determine current contract state. The contract may be unreachable."
                  : "Contract is active — all operations are enabled."}
            </p>
          </div>
          <div className="flex items-center gap-3">
            {isUnknown ? (
              <Badge variant="warning">❓ Unknown</Badge>
            ) : (
              <Badge variant={isPaused ? "danger" : "success"}>
                {isPaused ? "⏸ Paused" : "▶ Active"}
              </Badge>
            )}
            {!contractAvailable && !isUnknown && (
              <Badge variant="warning">Offline</Badge>
            )}
          </div>
        </div>
      </Card>

      {/* Warning Banner when Paused */}
      {isPaused && (
        <div className="bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-lg p-4 flex items-start gap-3">
          <svg className="w-5 h-5 text-red-500 mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
          </svg>
          <div>
            <p className="text-sm font-semibold text-red-800 dark:text-red-200">
              Contract is paused — emergency mode active
            </p>
            <p className="text-xs text-red-600 dark:text-red-400 mt-1">
              All payment recording, escrow creation, stream creation, and batch operations are blocked.
              Only the contract owner can unpause.
            </p>
          </div>
        </div>
      )}

      {/* Action Buttons */}
      <Card className="p-6">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Actions</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
          Owner-only operations. Both pause and unpause affect the OphirPay contract
          AND the linked Emitter contract atomically.
        </p>
        <div className="flex flex-col sm:flex-row gap-3">
          {isPaused ? (
            <Button
              onClick={handleUnpause}
              loading={submitting}
              disabled={!wallet.connected || !contractAvailable || isUnknown}
              className="flex-1"
            >
              ▶ Unpause Contract
            </Button>
          ) : (
            <Button
              onClick={handlePause}
              loading={submitting}
              disabled={!wallet.connected || !contractAvailable || isUnknown}
              variant="danger"
              className="flex-1"
            >
              ⏸ Pause Contract
            </Button>
          )}
        </div>
        <p className="text-xs text-gray-400 dark:text-gray-500 mt-3">
          {wallet.connected
            ? `Connected: ${wallet.publicKey ? shortenAddress(wallet.publicKey, 12) : "Unknown"}`
            : "Connect your wallet to perform admin actions"}
        </p>
      </Card>

      {/* Transaction Result */}
      {lastTxHash && (
        <Card className="p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-green-600">Transaction submitted</p>
              <p className="text-xs text-gray-400 mt-1">{shortenAddress(lastTxHash, 12)}</p>
            </div>
            <a
              href={getStellarExplorerUrl(lastTxHash)}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-ophir-600 hover:underline"
            >
              View on Explorer →
            </a>
          </div>
        </Card>
      )}

      {/* Info Section */}
      <Card className="p-6">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-3">How it works</h2>
        <div className="space-y-3 text-sm text-gray-600 dark:text-gray-400">
          <div className="flex items-start gap-3">
            <span className="text-red-500 font-bold">1</span>
            <div>
              <p className="font-medium text-gray-700 dark:text-gray-300">Emergency Pause</p>
              <p>Blocks all write operations (payments, escrows, streams, batches) while preserving read queries.</p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <span className="text-amber-500 font-bold">2</span>
            <div>
              <p className="font-medium text-gray-700 dark:text-gray-300">Atomic Cross-Contract</p>
              <p>Both the OphirPay and Emitter contracts are paused/unpaused together in a single transaction.</p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <span className="text-green-500 font-bold">3</span>
            <div>
              <p className="font-medium text-gray-700 dark:text-gray-300">Owner-Only</p>
              <p>Only the contract owner can pause or unpause. The action is recorded in the on-chain audit log.</p>
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}
