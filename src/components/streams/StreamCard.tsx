"use client";
// SPDX-License-Identifier: MIT

import { useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { CopyButton } from "@/components/ui/CopyButton";
import { useToast } from "@/components/ui/Toast";
import { VestingCurve } from "./VestingCurve";
import {
  type StreamRecord,
  getStreamStatus,
  computeClaimable,
  formatStroopAmount,
} from "@/lib/streams";
import { claimStream, cancelStream } from "@/lib/contract-advanced";
import { shortenAddress } from "@/lib/utils";

interface StreamCardProps {
  stream: StreamRecord;
  currentUserAddress?: string | null;
  onUpdated?: () => void;
}

export function StreamCard({ stream, currentUserAddress, onUpdated }: StreamCardProps) {
  const toast = useToast();
  const [claiming, setClaiming] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const status = getStreamStatus(stream);
  const isCreator = Boolean(
    currentUserAddress &&
      stream.creator.toLowerCase() === currentUserAddress.toLowerCase()
  );
  const isRecipient = Boolean(
    currentUserAddress &&
      stream.recipient.toLowerCase() === currentUserAddress.toLowerCase()
  );

  const nowSeconds = Math.floor(Date.now() / 1000);
  const claimable = computeClaimable(
    stream.totalAmount,
    stream.claimedAmount,
    stream.startTime,
    stream.endTime,
    nowSeconds,
    stream.cancelled
  );

  const handleClaim = async () => {
    if (!currentUserAddress || !isRecipient) {
      toast.show("Only the stream recipient can claim vested funds.", "error");
      return;
    }

    try {
      setClaiming(true);
      setErrorMessage(null);
      const res = await claimStream(currentUserAddress, stream.id);

      if (!res.success) {
        throw new Error(res.error || "Claim invocation failed on-chain.");
      }

      toast.show(
        `Successfully claimed tokens from Stream #${stream.id}! ${
          res.txHash ? `Tx: ${res.txHash.slice(0, 8)}...` : ""
        }`,
        "success"
      );
      onUpdated?.();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMessage(msg);
      toast.show(msg, "error");
    } finally {
      setClaiming(false);
    }
  };

  const handleCancel = async () => {
    if (!currentUserAddress || !isCreator) {
      toast.show("Only the stream creator can cancel this stream.", "error");
      return;
    }

    try {
      setCancelling(true);
      setErrorMessage(null);
      const res = await cancelStream(currentUserAddress, stream.id);

      if (!res.success) {
        throw new Error(res.error || "Stream cancellation failed on-chain.");
      }

      toast.show(
        `Stream #${stream.id} successfully cancelled. Unvested tokens refunded.`,
        "success"
      );
      onUpdated?.();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMessage(msg);
      toast.show(msg, "error");
    } finally {
      setCancelling(false);
    }
  };

  const statusVariant =
    status === "ACTIVE"
      ? "success"
      : status === "COMPLETED"
      ? "default"
      : status === "CANCELLED"
      ? "danger"
      : "warning";

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-5 space-y-4 transition-all hover:border-gray-300 dark:hover:border-gray-600">
      {/* Header with ID, Status, Role, and Detail Link */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="font-mono font-bold text-gray-900 dark:text-gray-100 text-lg">
            Stream #{stream.id}
          </span>
          <Badge variant={statusVariant}>{status}</Badge>

          {isCreator && (
            <span className="px-2 py-0.5 text-xs font-semibold rounded bg-indigo-100 dark:bg-indigo-900/50 text-indigo-700 dark:text-indigo-300">
              Creator (Outgoing)
            </span>
          )}
          {isRecipient && (
            <span className="px-2 py-0.5 text-xs font-semibold rounded bg-emerald-100 dark:bg-emerald-900/50 text-emerald-700 dark:text-emerald-300">
              Recipient (Incoming)
            </span>
          )}
        </div>

        <Link
          href={`/streams/${stream.id}`}
          className="text-xs font-semibold text-ophir-600 dark:text-ophir-400 hover:underline flex items-center gap-1"
        >
          View Full Details →
        </Link>
      </div>

      {stream.metadata && (
        <p className="text-sm text-gray-600 dark:text-gray-300 bg-gray-50 dark:bg-gray-900/40 p-2.5 rounded-lg border border-gray-100 dark:border-gray-800 italic">
          "{stream.metadata}"
        </p>
      )}

      {/* Participants Addresses */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs bg-gray-50 dark:bg-gray-900/30 p-3 rounded-lg border border-gray-100 dark:border-gray-800">
        <div>
          <span className="text-gray-500 dark:text-gray-400 block mb-0.5">Creator:</span>
          <div className="flex items-center gap-1 font-mono text-gray-800 dark:text-gray-200">
            <span>{shortenAddress(stream.creator)}</span>
            <CopyButton value={stream.creator} />
          </div>
        </div>

        <div>
          <span className="text-gray-500 dark:text-gray-400 block mb-0.5">Recipient:</span>
          <div className="flex items-center gap-1 font-mono text-gray-800 dark:text-gray-200">
            <span>{shortenAddress(stream.recipient)}</span>
            <CopyButton value={stream.recipient} />
          </div>
        </div>
      </div>

      {/* Vesting Curve & Progress */}
      <VestingCurve stream={stream} />

      {/* Error alert if transaction failed */}
      {errorMessage && (
        <div className="p-3 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-lg text-xs text-red-700 dark:text-red-300">
          <strong>Transaction Error:</strong> {errorMessage}
        </div>
      )}

      {/* Role-Gated Action Buttons */}
      <div className="flex flex-wrap items-center justify-end gap-3 pt-2">
        {/* Recipient Claim Action */}
        {isRecipient && (
          <Button
            variant="primary"
            size="sm"
            onClick={handleClaim}
            loading={claiming}
            disabled={claimable <= 0n || stream.cancelled}
            title={
              stream.cancelled
                ? "Stream has been cancelled"
                : claimable <= 0n
                ? "No vested tokens available to claim yet"
                : `Claim ${formatStroopAmount(claimable)} XLM`
            }
          >
            Claim {formatStroopAmount(claimable)} XLM
          </Button>
        )}

        {/* Creator Cancel Action */}
        {isCreator && !stream.cancelled && status !== "COMPLETED" && (
          <Button
            variant="danger"
            size="sm"
            onClick={handleCancel}
            loading={cancelling}
            title="Cancel stream and refund unvested tokens"
          >
            Cancel Stream
          </Button>
        )}
      </div>
    </div>
  );
}
