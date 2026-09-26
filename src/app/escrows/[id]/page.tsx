"use client";
// SPDX-License-Identifier: MIT

import { use, useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { usePageTitle } from "@/hooks/usePageTitle";
import { PAGE_TITLES } from "@/lib/page-titles";
import { useWallet } from "@/hooks/useMultiWallet";
import { useApiQuery } from "@/hooks/useApiQuery";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { CopyButton } from "@/components/ui/CopyButton";
import { ExplorerLink } from "@/components/ui/ExplorerLink";
import { useToast } from "@/components/ui/Toast";
import { EscrowStateMachine } from "@/components/escrows/EscrowStateMachine";
import {
  type EscrowRecord,
  normalizeEscrow,
  getEscrowStatus,
  getEscrowRole,
  formatStroopAmount,
} from "@/lib/escrows";
import {
  releaseEscrow,
  claimEscrow,
  releaseByArbiter,
} from "@/lib/contract-advanced";

export default function EscrowDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  usePageTitle(PAGE_TITLES.ESCROW_DETAIL);
  const { id } = use(params);
  const router = useRouter();
  const { wallet } = useWallet();
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

  const {
    data: rawEscrow,
    isLoading,
    isError,
    refetch,
  } = useApiQuery<unknown>(["escrows", "detail", id], `/api/escrows/${id}`);

  let escrow: EscrowRecord | null = null;
  if (rawEscrow && typeof rawEscrow === "object") {
    try {
      escrow = normalizeEscrow(rawEscrow);
    } catch {
      escrow = null;
    }
  }

  const role = escrow ? getEscrowRole(escrow, wallet.publicKey) : "observer";
  const status = escrow ? getEscrowStatus(escrow, now) : "LOCKED";

  const deadlineDate = escrow ? new Date(escrow.deadline * 1000) : new Date();
  const secondsToDeadline = escrow ? escrow.deadline - now : 0;
  const isExpired = secondsToDeadline <= 0;

  const formatCountdown = (secs: number) => {
    if (secs <= 0) return "Deadline passed";
    const days = Math.floor(secs / 86400);
    const hours = Math.floor((secs % 86400) / 3600);
    const minutes = Math.floor((secs % 3600) / 60);
    const s = secs % 60;
    if (days > 0) return `${days}d ${hours}h ${minutes}m ${s}s`;
    if (hours > 0) return `${hours}h ${minutes}m ${s}s`;
    return `${minutes}m ${s}s`;
  };

  const handleRelease = async () => {
    if (!wallet.publicKey || role !== "depositor" || !escrow) {
      toast.show("Only the depositor/owner can release this escrow early.", "error");
      return;
    }

    try {
      setLoadingAction("release");
      setActionError(null);
      const res = await releaseEscrow(wallet.publicKey, escrow.id);
      if (!res.success) {
        throw new Error(res.error || "Release invocation failed on-chain.");
      }
      toast.show(`Escrow #${escrow.id} successfully released to beneficiary!`, "success");
      refetch();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setActionError(msg);
      toast.show(msg, "error");
    } finally {
      setLoadingAction(null);
    }
  };

  const handleClaim = async () => {
    if (!wallet.publicKey || role !== "beneficiary" || !escrow) {
      toast.show("Only the beneficiary can claim this escrow.", "error");
      return;
    }

    try {
      setLoadingAction("claim");
      setActionError(null);
      const res = await claimEscrow(wallet.publicKey, escrow.id);
      if (!res.success) {
        throw new Error(res.error || "Claim invocation failed on-chain.");
      }
      toast.show(`Escrow #${escrow.id} successfully claimed by beneficiary!`, "success");
      refetch();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setActionError(msg);
      toast.show(msg, "error");
    } finally {
      setLoadingAction(null);
    }
  };

  const handleArbiterRelease = async (toBeneficiary: boolean) => {
    if (!wallet.publicKey || role !== "arbiter" || !escrow) {
      toast.show("Only the designated arbiter can resolve this escrow.", "error");
      return;
    }

    try {
      setLoadingAction(toBeneficiary ? "arbiter-beneficiary" : "arbiter-depositor");
      setActionError(null);
      const res = await releaseByArbiter(wallet.publicKey, escrow.id, toBeneficiary);
      if (!res.success) {
        throw new Error(res.error || "Arbiter release failed on-chain.");
      }
      toast.show(
        `Arbiter successfully ${toBeneficiary ? "released funds to beneficiary" : "refunded funds to depositor"}!`,
        "success"
      );
      refetch();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setActionError(msg);
      toast.show(msg, "error");
    } finally {
      setLoadingAction(null);
    }
  };

  if (isLoading) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-8 space-y-6">
        <div className="h-6 w-32 bg-gray-200 dark:bg-gray-700 animate-pulse rounded" />
        <div className="h-64 bg-gray-100 dark:bg-gray-800 animate-pulse rounded-xl" />
      </div>
    );
  }

  if (isError || !escrow) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-12 text-center space-y-4">
        <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">
          Escrow Not Found
        </h2>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Could not locate on-chain escrow #{id}. It may not exist yet or Soroban simulation failed.
        </p>
        <Link href="/escrows">
          <Button variant="secondary" size="sm">
            ← Back to Escrows
          </Button>
        </Link>
      </div>
    );
  }

  const statusVariant =
    status === "DUE_FOR_CLAIM"
      ? "warning"
      : status === "LOCKED"
      ? "default"
      : status === "RELEASED"
      ? "success"
      : "success";

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 space-y-6">
      {/* Back button and Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-1">
          <Link
            href="/escrows"
            className="text-xs font-semibold text-ophir-600 dark:text-ophir-400 hover:underline flex items-center gap-1 mb-2"
          >
            ← Back to All Escrows
          </Link>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold font-mono text-gray-900 dark:text-gray-100">
              Escrow #{escrow.id}
            </h1>
            <Badge variant={statusVariant}>{status.replace("_", " ")}</Badge>

            {role === "depositor" && (
              <span className="px-2.5 py-0.5 text-xs font-semibold rounded bg-indigo-100 dark:bg-indigo-900/50 text-indigo-700 dark:text-indigo-300">
                You are Depositor
              </span>
            )}
            {role === "beneficiary" && (
              <span className="px-2.5 py-0.5 text-xs font-semibold rounded bg-emerald-100 dark:bg-emerald-900/50 text-emerald-700 dark:text-emerald-300">
                You are Beneficiary
              </span>
            )}
            {role === "arbiter" && (
              <span className="px-2.5 py-0.5 text-xs font-semibold rounded bg-purple-100 dark:bg-purple-900/50 text-purple-700 dark:text-purple-300">
                You are Arbiter
              </span>
            )}
          </div>
        </div>

        <Button variant="secondary" size="sm" onClick={() => refetch()}>
          ↻ Refresh On-Chain State
        </Button>
      </div>

      {/* Description / Agreement Memo */}
      {escrow.metadata && (
        <div className="p-4 bg-gray-50 dark:bg-gray-800/60 rounded-xl border border-gray-200 dark:border-gray-700 text-sm text-gray-700 dark:text-gray-300">
          <span className="font-semibold text-gray-500 dark:text-gray-400 block text-xs mb-1 uppercase tracking-wider">
            Escrow Agreement Memo / Conditions
          </span>
          {escrow.metadata}
        </div>
      )}

      {/* Primary Financial Overview Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="p-5 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm space-y-1">
          <span className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
            Escrow Balance Locked
          </span>
          <p className="text-3xl font-bold font-mono text-gray-900 dark:text-gray-100">
            {formatStroopAmount(escrow.amount)} XLM
          </p>
          <span className="text-xs text-gray-400 font-mono">
            {escrow.amount} stroops on Soroban
          </span>
        </div>

        <div className="p-5 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm space-y-1">
          <span className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
            Release Deadline Status
          </span>
          <p
            className={`text-2xl font-bold font-mono ${
              isExpired
                ? "text-emerald-600 dark:text-emerald-400"
                : "text-amber-600 dark:text-amber-400"
            }`}
          >
            {isExpired ? "Deadline Reached" : formatCountdown(secondsToDeadline)}
          </p>
          <span className="text-xs text-gray-500 dark:text-gray-400 block">
            Target date: {deadlineDate.toLocaleString()}
          </span>
        </div>
      </div>

      {/* Visual State Machine */}
      <EscrowStateMachine escrow={escrow} />

      {/* Action Error Banner */}
      {actionError && (
        <div className="p-4 rounded-xl bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 text-sm text-red-700 dark:text-red-300">
          <strong>Transaction Error:</strong> {actionError}
        </div>
      )}

      {/* Role-Gated Actions Panel */}
      <div className="p-5 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm space-y-4">
        <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">
          Escrow Actions & Permissions
        </h3>

        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4 pt-2 border-t border-gray-100 dark:border-gray-700">
          <div>
            {role === "depositor" ? (
              <p className="text-xs text-gray-600 dark:text-gray-400">
                As the depositor, you can release the locked funds early to the beneficiary at any time to finalize the transaction.
              </p>
            ) : role === "beneficiary" ? (
              <p className="text-xs text-gray-600 dark:text-gray-400">
                As the beneficiary, you can claim the full escrow amount once the release deadline timestamp has passed.
              </p>
            ) : role === "arbiter" ? (
              <p className="text-xs text-gray-600 dark:text-gray-400">
                As the designated arbiter, you have sole dispute resolution authority to either release funds to the beneficiary or refund them back to the depositor.
              </p>
            ) : (
              <p className="text-xs text-gray-500 dark:text-gray-400">
                You are viewing this escrow in observer mode. Connect an authorized wallet (Depositor, Beneficiary, or Arbiter) to execute actions.
              </p>
            )}
          </div>

          <div className="flex items-center gap-3 shrink-0">
            {role === "depositor" && !escrow.released && !escrow.claimed && (
              <Button
                variant="primary"
                onClick={handleRelease}
                loading={loadingAction === "release"}
              >
                Release Early to Beneficiary
              </Button>
            )}

            {role === "beneficiary" && !escrow.released && !escrow.claimed && (
              <Button
                variant="primary"
                onClick={handleClaim}
                loading={loadingAction === "claim"}
                disabled={!isExpired}
              >
                Claim Escrow ({formatStroopAmount(escrow.amount)} XLM)
              </Button>
            )}

            {role === "arbiter" && !escrow.released && !escrow.claimed && (
              <>
                <Button
                  variant="secondary"
                  onClick={() => handleArbiterRelease(false)}
                  loading={loadingAction === "arbiter-depositor"}
                >
                  Refund to Depositor
                </Button>
                <Button
                  variant="primary"
                  onClick={() => handleArbiterRelease(true)}
                  loading={loadingAction === "arbiter-beneficiary"}
                >
                  Release to Beneficiary
                </Button>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Comprehensive Details Spec Grid */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-700">
          <h3 className="text-sm font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
            On-Chain Escrow Specification
          </h3>
        </div>

        <div className="divide-y divide-gray-100 dark:divide-gray-700/60 text-sm">
          <div className="px-5 py-3.5 flex flex-col sm:flex-row sm:justify-between sm:items-center gap-1">
            <span className="text-gray-500 dark:text-gray-400">Depositor (Owner)</span>
            <div className="flex items-center gap-2 font-mono text-gray-900 dark:text-gray-100">
              <span>{escrow.depositor}</span>
              <CopyButton value={escrow.depositor} />
              <ExplorerLink kind="account" value={escrow.depositor} />
            </div>
          </div>

          <div className="px-5 py-3.5 flex flex-col sm:flex-row sm:justify-between sm:items-center gap-1">
            <span className="text-gray-500 dark:text-gray-400">Beneficiary</span>
            <div className="flex items-center gap-2 font-mono text-gray-900 dark:text-gray-100">
              <span>{escrow.beneficiary}</span>
              <CopyButton value={escrow.beneficiary} />
              <ExplorerLink kind="account" value={escrow.beneficiary} />
            </div>
          </div>

          <div className="px-5 py-3.5 flex flex-col sm:flex-row sm:justify-between sm:items-center gap-1">
            <span className="text-gray-500 dark:text-gray-400">Dispute Arbiter</span>
            <div className="flex items-center gap-2 font-mono text-gray-900 dark:text-gray-100">
              <span>{escrow.arbiter ?? "None (No arbiter specified)"}</span>
              {escrow.arbiter && <CopyButton value={escrow.arbiter} />}
              {escrow.arbiter && <ExplorerLink kind="account" value={escrow.arbiter} />}
            </div>
          </div>

          <div className="px-5 py-3.5 flex flex-col sm:flex-row sm:justify-between sm:items-center gap-1">
            <span className="text-gray-500 dark:text-gray-400">Escrow Amount</span>
            <span className="font-mono font-semibold text-gray-900 dark:text-gray-100">
              {formatStroopAmount(escrow.amount)} XLM ({escrow.amount} stroops)
            </span>
          </div>

          <div className="px-5 py-3.5 flex flex-col sm:flex-row sm:justify-between sm:items-center gap-1">
            <span className="text-gray-500 dark:text-gray-400">Release Deadline</span>
            <span className="text-gray-800 dark:text-gray-200">
              {deadlineDate.toLocaleString()} ({escrow.deadline})
            </span>
          </div>

          <div className="px-5 py-3.5 flex flex-col sm:flex-row sm:justify-between sm:items-center gap-1">
            <span className="text-gray-500 dark:text-gray-400">Released Flag</span>
            <span className="font-mono text-gray-800 dark:text-gray-200">
              {escrow.released ? "True (Released early)" : "False"}
            </span>
          </div>

          <div className="px-5 py-3.5 flex flex-col sm:flex-row sm:justify-between sm:items-center gap-1">
            <span className="text-gray-500 dark:text-gray-400">Claimed Flag</span>
            <span className="font-mono text-gray-800 dark:text-gray-200">
              {escrow.claimed ? "True (Settled)" : "False"}
            </span>
          </div>

          <div className="px-5 py-3.5 flex flex-col sm:flex-row sm:justify-between sm:items-center gap-1">
            <span className="text-gray-500 dark:text-gray-400">Asset Address</span>
            <span className="font-mono text-xs text-gray-600 dark:text-gray-400">
              {escrow.asset}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
