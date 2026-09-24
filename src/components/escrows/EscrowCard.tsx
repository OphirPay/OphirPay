"use client";
// SPDX-License-Identifier: MIT

import { useState, useEffect } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { CopyButton } from "@/components/ui/CopyButton";
import { useToast } from "@/components/ui/Toast";
import { EscrowStateMachine } from "./EscrowStateMachine";
import {
  type EscrowRecord,
  getEscrowStatus,
  getEscrowRole,
  formatStroopAmount,
} from "@/lib/escrows";
import {
  releaseEscrow,
  claimEscrow,
  releaseByArbiter,
} from "@/lib/contract-advanced";
import { shortenAddress } from "@/lib/utils";

interface EscrowCardProps {
  escrow: EscrowRecord;
  currentUserAddress?: string | null;
  onUpdated?: () => void;
}

export function EscrowCard({ escrow, currentUserAddress, onUpdated }: EscrowCardProps) {
  const toast = useToast();
  const [now, setNow] = useState<number>(() => Math.floor(Date.now() / 1000));
  const [loadingAction, setLoadingAction] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    const timer = setInterval(() => {
      setNow(Math.floor(Date.now() / 1000));
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const status = getEscrowStatus(escrow, now);
  const role = getEscrowRole(escrow, currentUserAddress);

  const deadlineDate = new Date(escrow.deadline * 1000);
  const secondsToDeadline = escrow.deadline - now;
  const isExpired = secondsToDeadline <= 0;

  const formatCountdown = (secs: number) => {
    if (secs <= 0) return "Deadline passed";
    const days = Math.floor(secs / 86400);
    const hours = Math.floor((secs % 86400) / 3600);
    const minutes = Math.floor((secs % 3600) / 60);
    const s = secs % 60;
    if (days > 0) return `${days}d ${hours}h ${minutes}m`;
    if (hours > 0) return `${hours}h ${minutes}m ${s}s`;
    return `${minutes}m ${s}s`;
  };

  const handleRelease = async () => {
    if (!currentUserAddress || role !== "depositor") {
      toast.show("Only the depositor/owner can release this escrow early.", "error");
      return;
    }

    try {
      setLoadingAction("release");
      setActionError(null);
      const res = await releaseEscrow(currentUserAddress, escrow.id);
      if (!res.success) {
        throw new Error(res.error || "Release invocation failed on-chain.");
      }
      toast.show(`Escrow #${escrow.id} successfully released to beneficiary!`, "success");
      onUpdated?.();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setActionError(msg);
      toast.show(msg, "error");
    } finally {
      setLoadingAction(null);
    }
  };

  const handleClaim = async () => {
    if (!currentUserAddress || role !== "beneficiary") {
      toast.show("Only the beneficiary can claim this escrow.", "error");
      return;
    }

    try {
      setLoadingAction("claim");
      setActionError(null);
      const res = await claimEscrow(currentUserAddress, escrow.id);
      if (!res.success) {
        throw new Error(res.error || "Claim invocation failed on-chain.");
      }
      toast.show(`Escrow #${escrow.id} successfully claimed by beneficiary!`, "success");
      onUpdated?.();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setActionError(msg);
      toast.show(msg, "error");
    } finally {
      setLoadingAction(null);
    }
  };

  const handleArbiterRelease = async (toBeneficiary: boolean) => {
    if (!currentUserAddress || role !== "arbiter") {
      toast.show("Only the designated arbiter can resolve this escrow.", "error");
      return;
    }

    try {
      setLoadingAction(toBeneficiary ? "arbiter-beneficiary" : "arbiter-depositor");
      setActionError(null);
      const res = await releaseByArbiter(currentUserAddress, escrow.id, toBeneficiary);
      if (!res.success) {
        throw new Error(res.error || "Arbiter release failed on-chain.");
      }
      toast.show(
        `Arbiter successfully ${toBeneficiary ? "released funds to beneficiary" : "refunded funds to depositor"}!`,
        "success"
      );
      onUpdated?.();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setActionError(msg);
      toast.show(msg, "error");
    } finally {
      setLoadingAction(null);
    }
  };

  const statusVariant =
    status === "DUE_FOR_CLAIM"
      ? "warning"
      : status === "LOCKED"
      ? "default"
      : status === "RELEASED"
      ? "success"
      : "success";

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-5 space-y-4 transition-all hover:border-gray-300 dark:hover:border-gray-600">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="font-mono font-bold text-gray-900 dark:text-gray-100 text-lg">
            Escrow #{escrow.id}
          </span>
          <Badge variant={statusVariant}>{status.replace("_", " ")}</Badge>

          {role === "depositor" && (
            <span className="px-2 py-0.5 text-xs font-semibold rounded bg-indigo-100 dark:bg-indigo-900/50 text-indigo-700 dark:text-indigo-300">
              You are Depositor
            </span>
          )}
          {role === "beneficiary" && (
            <span className="px-2 py-0.5 text-xs font-semibold rounded bg-emerald-100 dark:bg-emerald-900/50 text-emerald-700 dark:text-emerald-300">
              You are Beneficiary
            </span>
          )}
          {role === "arbiter" && (
            <span className="px-2 py-0.5 text-xs font-semibold rounded bg-purple-100 dark:bg-purple-900/50 text-purple-700 dark:text-purple-300">
              You are Arbiter
            </span>
          )}
        </div>

        <Link
          href={`/escrows/${escrow.id}`}
          className="text-xs font-semibold text-ophir-600 dark:text-ophir-400 hover:underline flex items-center gap-1"
        >
          View Full Details →
        </Link>
      </div>

      {/* Description Memo */}
      {escrow.metadata && (
        <p className="text-sm text-gray-600 dark:text-gray-300 bg-gray-50 dark:bg-gray-900/40 p-2.5 rounded-lg border border-gray-100 dark:border-gray-800 italic">
          "{escrow.metadata}"
        </p>
      )}

      {/* Amount & Deadline Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="p-3 bg-gray-50 dark:bg-gray-900/40 rounded-lg border border-gray-100 dark:border-gray-800">
          <span className="text-xs text-gray-500 dark:text-gray-400 font-medium block">
            Escrowed Amount
          </span>
          <span className="text-xl font-bold font-mono text-gray-900 dark:text-gray-100 mt-0.5 block">
            {formatStroopAmount(escrow.amount)} XLM
          </span>
        </div>

        <div className="p-3 bg-gray-50 dark:bg-gray-900/40 rounded-lg border border-gray-100 dark:border-gray-800">
          <span className="text-xs text-gray-500 dark:text-gray-400 font-medium block">
            Release Deadline
          </span>
          <div className="flex items-baseline justify-between mt-0.5">
            <span className="text-sm font-semibold text-gray-800 dark:text-gray-200">
              {deadlineDate.toLocaleDateString()}
            </span>
            <span
              className={`text-xs font-mono font-medium ${
                isExpired
                  ? "text-emerald-600 dark:text-emerald-400"
                  : "text-amber-600 dark:text-amber-400"
              }`}
            >
              {isExpired ? "Ready to Claim" : formatCountdown(secondsToDeadline)}
            </span>
          </div>
        </div>
      </div>

      {/* State Machine */}
      <EscrowStateMachine escrow={escrow} />

      {/* Participants */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs bg-gray-50 dark:bg-gray-900/30 p-3 rounded-lg border border-gray-100 dark:border-gray-800">
        <div>
          <span className="text-gray-500 dark:text-gray-400 block mb-0.5">Depositor:</span>
          <div className="flex items-center gap-1 font-mono text-gray-800 dark:text-gray-200">
            <span>{shortenAddress(escrow.depositor)}</span>
            <CopyButton value={escrow.depositor} />
          </div>
        </div>

        <div>
          <span className="text-gray-500 dark:text-gray-400 block mb-0.5">Beneficiary:</span>
          <div className="flex items-center gap-1 font-mono text-gray-800 dark:text-gray-200">
            <span>{shortenAddress(escrow.beneficiary)}</span>
            <CopyButton value={escrow.beneficiary} />
          </div>
        </div>

        <div>
          <span className="text-gray-500 dark:text-gray-400 block mb-0.5">Arbiter:</span>
          <div className="flex items-center gap-1 font-mono text-gray-800 dark:text-gray-200">
            <span>{escrow.arbiter ? shortenAddress(escrow.arbiter) : "None"}</span>
            {escrow.arbiter && <CopyButton value={escrow.arbiter} />}
          </div>
        </div>
      </div>

      {/* Action Error Banner */}
      {actionError && (
        <div className="p-3 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-lg text-xs text-red-700 dark:text-red-300">
          <strong>Contract Error:</strong> {actionError}
        </div>
      )}

      {/* Role-Gated Action Buttons */}
      <div className="flex flex-wrap items-center justify-end gap-3 pt-2">
        {/* Depositor early release */}
        {role === "depositor" && !escrow.released && !escrow.claimed && (
          <Button
            variant="primary"
            size="sm"
            onClick={handleRelease}
            loading={loadingAction === "release"}
            title="Release funds early to beneficiary"
          >
            Release Early to Beneficiary
          </Button>
        )}

        {/* Beneficiary claim after deadline */}
        {role === "beneficiary" && !escrow.released && !escrow.claimed && (
          <Button
            variant="primary"
            size="sm"
            onClick={handleClaim}
            loading={loadingAction === "claim"}
            disabled={!isExpired}
            title={
              !isExpired
                ? `Available once deadline passes (${formatCountdown(secondsToDeadline)})`
                : "Claim unlocked escrow tokens"
            }
          >
            Claim Escrow ({formatStroopAmount(escrow.amount)} XLM)
          </Button>
        )}

        {/* Arbiter dispute settlement */}
        {role === "arbiter" && !escrow.released && !escrow.claimed && (
          <>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => handleArbiterRelease(false)}
              loading={loadingAction === "arbiter-depositor"}
              title="Refund locked tokens back to depositor"
            >
              Refund to Depositor
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={() => handleArbiterRelease(true)}
              loading={loadingAction === "arbiter-beneficiary"}
              title="Release locked tokens to beneficiary"
            >
              Release to Beneficiary
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
