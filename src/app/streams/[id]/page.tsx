"use client";
// SPDX-License-Identifier: MIT

import { use, useState } from "react";
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
import { VestingCurve } from "@/components/streams/VestingCurve";
import {
  type StreamRecord,
  normalizeStream,
  getStreamStatus,
  computeClaimable,
  computeVested,
  computeUnvested,
  computeRemaining,
  formatStroopAmount,
} from "@/lib/streams";
import { claimStream, cancelStream } from "@/lib/contract-advanced";

export default function StreamDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  usePageTitle(PAGE_TITLES.STREAM_DETAIL);
  const { id } = use(params);
  const router = useRouter();
  const { wallet } = useWallet();
  const toast = useToast();

  const [claiming, setClaiming] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const {
    data: rawStream,
    isLoading,
    isError,
    refetch,
  } = useApiQuery<unknown>(["streams", "detail", id], `/api/streams/${id}`);

  let stream: StreamRecord | null = null;
  if (rawStream && typeof rawStream === "object") {
    try {
      stream = normalizeStream(rawStream);
    } catch {
      stream = null;
    }
  }

  const currentUser = wallet.publicKey?.toLowerCase();
  const isCreator = Boolean(
    currentUser && stream && stream.creator.toLowerCase() === currentUser
  );
  const isRecipient = Boolean(
    currentUser && stream && stream.recipient.toLowerCase() === currentUser
  );

  const nowSeconds = Math.floor(Date.now() / 1000);
  const status = stream ? getStreamStatus(stream, nowSeconds) : "PENDING";
  const claimable = stream
    ? computeClaimable(
        stream.totalAmount,
        stream.claimedAmount,
        stream.startTime,
        stream.endTime,
        nowSeconds,
        stream.cancelled
      )
    : 0n;
  const vested = stream
    ? computeVested(stream.totalAmount, stream.startTime, stream.endTime, nowSeconds)
    : 0n;
  const unvested = stream
    ? computeUnvested(stream.totalAmount, stream.startTime, stream.endTime, nowSeconds)
    : 0n;
  const remaining = stream
    ? computeRemaining(stream.totalAmount, stream.claimedAmount)
    : 0n;

  const handleClaim = async () => {
    if (!wallet.publicKey || !isRecipient || !stream) {
      toast.show("Only the stream recipient can claim vested funds.", "error");
      return;
    }

    try {
      setClaiming(true);
      setActionError(null);
      const res = await claimStream(wallet.publicKey, stream.id);

      if (!res.success) {
        throw new Error(res.error || "Claim transaction failed on-chain.");
      }

      toast.show(
        `Successfully claimed tokens from Stream #${stream.id}! ${
          res.txHash ? `Tx: ${res.txHash.slice(0, 8)}...` : ""
        }`,
        "success"
      );
      refetch();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setActionError(msg);
      toast.show(msg, "error");
    } finally {
      setClaiming(false);
    }
  };

  const handleCancel = async () => {
    if (!wallet.publicKey || !isCreator || !stream) {
      toast.show("Only the stream creator can cancel this stream.", "error");
      return;
    }

    try {
      setCancelling(true);
      setActionError(null);
      const res = await cancelStream(wallet.publicKey, stream.id);

      if (!res.success) {
        throw new Error(res.error || "Stream cancellation failed on-chain.");
      }

      toast.show(
        `Stream #${stream.id} successfully cancelled. Unvested tokens refunded.`,
        "success"
      );
      refetch();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setActionError(msg);
      toast.show(msg, "error");
    } finally {
      setCancelling(false);
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

  if (isError || !stream) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-12 text-center space-y-4">
        <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">
          Stream Not Found
        </h2>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Could not locate on-chain stream #{id}. It may not exist yet or Soroban simulation failed.
        </p>
        <Link href="/streams">
          <Button variant="secondary" size="sm">
            ← Back to Streams
          </Button>
        </Link>
      </div>
    );
  }

  const statusVariant =
    status === "ACTIVE"
      ? "success"
      : status === "COMPLETED"
      ? "default"
      : status === "CANCELLED"
      ? "danger"
      : "warning";

  const startDate = new Date(stream.startTime * 1000);
  const endDate = new Date(stream.endTime * 1000);

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 space-y-6">
      {/* Back button and Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-1">
          <Link
            href="/streams"
            className="text-xs font-semibold text-ophir-600 dark:text-ophir-400 hover:underline flex items-center gap-1 mb-2"
          >
            ← Back to All Streams
          </Link>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold font-mono text-gray-900 dark:text-gray-100">
              Stream #{stream.id}
            </h1>
            <Badge variant={statusVariant}>{status}</Badge>

            {isCreator && (
              <span className="px-2.5 py-0.5 text-xs font-semibold rounded bg-indigo-100 dark:bg-indigo-900/50 text-indigo-700 dark:text-indigo-300">
                You are Creator
              </span>
            )}
            {isRecipient && (
              <span className="px-2.5 py-0.5 text-xs font-semibold rounded bg-emerald-100 dark:bg-emerald-900/50 text-emerald-700 dark:text-emerald-300">
                You are Recipient
              </span>
            )}
          </div>
        </div>

        <Button variant="secondary" size="sm" onClick={() => refetch()}>
          ↻ Refresh On-Chain State
        </Button>
      </div>

      {stream.metadata && (
        <div className="p-4 bg-gray-50 dark:bg-gray-800/60 rounded-xl border border-gray-200 dark:border-gray-700 text-sm text-gray-700 dark:text-gray-300">
          <span className="font-semibold text-gray-500 dark:text-gray-400 block text-xs mb-1 uppercase tracking-wider">
            Stream Description / Purpose
          </span>
          {stream.metadata}
        </div>
      )}

      {/* Primary Vesting Curve Visualization */}
      <VestingCurve stream={stream} />

      {/* Action Error Banner */}
      {actionError && (
        <div className="p-4 rounded-xl bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 text-sm text-red-700 dark:text-red-300">
          <strong>Transaction Error:</strong> {actionError}
        </div>
      )}

      {/* Role-Gated Actions Panel */}
      <div className="p-5 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm space-y-4">
        <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">
          Available Stream Actions
        </h3>

        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4 pt-2 border-t border-gray-100 dark:border-gray-700">
          <div>
            {isRecipient ? (
              <p className="text-xs text-gray-600 dark:text-gray-400">
                As the recipient, you can claim your earned tokens at any time. Unclaimed tokens remain securely locked in the contract until claimed.
              </p>
            ) : isCreator ? (
              <p className="text-xs text-gray-600 dark:text-gray-400">
                As the creator, cancelling this stream will stop future vesting and refund all unvested tokens (
                <span className="font-mono font-semibold">{formatStroopAmount(unvested)} XLM</span>
                ) directly back to your wallet.
              </p>
            ) : (
              <p className="text-xs text-gray-500 dark:text-gray-400">
                You are viewing this stream in read-only mode. Connect the recipient or creator wallet to execute actions.
              </p>
            )}
          </div>

          <div className="flex items-center gap-3 shrink-0">
            {isRecipient && (
              <Button
                variant="primary"
                onClick={handleClaim}
                loading={claiming}
                disabled={claimable <= 0n || stream.cancelled}
              >
                Claim {formatStroopAmount(claimable)} XLM
              </Button>
            )}

            {isCreator && !stream.cancelled && status !== "COMPLETED" && (
              <Button
                variant="danger"
                onClick={handleCancel}
                loading={cancelling}
              >
                Cancel & Refund Unvested
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Comprehensive Details Spec Grid */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-700">
          <h3 className="text-sm font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
            Stream Contract Details
          </h3>
        </div>

        <div className="divide-y divide-gray-100 dark:divide-gray-700/60 text-sm">
          <div className="px-5 py-3.5 flex flex-col sm:flex-row sm:justify-between sm:items-center gap-1">
            <span className="text-gray-500 dark:text-gray-400">Creator Wallet</span>
            <div className="flex items-center gap-2 font-mono text-gray-900 dark:text-gray-100">
              <span>{stream.creator}</span>
              <CopyButton value={stream.creator} />
              <ExplorerLink type="account" value={stream.creator} />
            </div>
          </div>

          <div className="px-5 py-3.5 flex flex-col sm:flex-row sm:justify-between sm:items-center gap-1">
            <span className="text-gray-500 dark:text-gray-400">Recipient Wallet</span>
            <div className="flex items-center gap-2 font-mono text-gray-900 dark:text-gray-100">
              <span>{stream.recipient}</span>
              <CopyButton value={stream.recipient} />
              <ExplorerLink type="account" value={stream.recipient} />
            </div>
          </div>

          <div className="px-5 py-3.5 flex flex-col sm:flex-row sm:justify-between sm:items-center gap-1">
            <span className="text-gray-500 dark:text-gray-400">Total Stream Amount</span>
            <span className="font-mono font-semibold text-gray-900 dark:text-gray-100">
              {formatStroopAmount(stream.totalAmount)} XLM ({stream.totalAmount} stroops)
            </span>
          </div>

          <div className="px-5 py-3.5 flex flex-col sm:flex-row sm:justify-between sm:items-center gap-1">
            <span className="text-gray-500 dark:text-gray-400">Total Vested</span>
            <span className="font-mono font-semibold text-indigo-600 dark:text-indigo-400">
              {formatStroopAmount(vested)} XLM
            </span>
          </div>

          <div className="px-5 py-3.5 flex flex-col sm:flex-row sm:justify-between sm:items-center gap-1">
            <span className="text-gray-500 dark:text-gray-400">Claimed by Recipient</span>
            <span className="font-mono font-semibold text-gray-700 dark:text-gray-300">
              {formatStroopAmount(stream.claimedAmount)} XLM
            </span>
          </div>

          <div className="px-5 py-3.5 flex flex-col sm:flex-row sm:justify-between sm:items-center gap-1">
            <span className="text-gray-500 dark:text-gray-400">Remaining to Claim</span>
            <span className="font-mono font-semibold text-emerald-600 dark:text-emerald-400">
              {formatStroopAmount(remaining)} XLM
            </span>
          </div>

          <div className="px-5 py-3.5 flex flex-col sm:flex-row sm:justify-between sm:items-center gap-1">
            <span className="text-gray-500 dark:text-gray-400">Start Timestamp</span>
            <span className="text-gray-800 dark:text-gray-200">
              {startDate.toLocaleString()} ({stream.startTime})
            </span>
          </div>

          <div className="px-5 py-3.5 flex flex-col sm:flex-row sm:justify-between sm:items-center gap-1">
            <span className="text-gray-500 dark:text-gray-400">End Timestamp</span>
            <span className="text-gray-800 dark:text-gray-200">
              {endDate.toLocaleString()} ({stream.endTime})
            </span>
          </div>

          <div className="px-5 py-3.5 flex flex-col sm:flex-row sm:justify-between sm:items-center gap-1">
            <span className="text-gray-500 dark:text-gray-400">Asset Address</span>
            <span className="font-mono text-xs text-gray-600 dark:text-gray-400">
              {stream.asset}
            </span>
          </div>

          <div className="px-5 py-3.5 flex flex-col sm:flex-row sm:justify-between sm:items-center gap-1">
            <span className="text-gray-500 dark:text-gray-400">Cancelled Flag</span>
            <span className="font-mono text-gray-800 dark:text-gray-200">
              {stream.cancelled ? "Yes (Tokens Refunded)" : "No"}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
