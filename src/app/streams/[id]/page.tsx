"use client";
// SPDX-License-Identifier: MIT

import { useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { VestingProgressChart } from "@/components/streams/VestingProgressChart";
import { Card } from "@/components/ui/Card";
import { StatusBadge } from "@/components/ui/Badge";
import { CopyButton } from "@/components/ui/CopyButton";
import { useToast } from "@/components/ui/Toast";
import { useWallet } from "@/hooks/useMultiWallet";
import { useApiQuery } from "@/hooks/useApiQuery";
import { claimStream, cancelStream } from "@/lib/contract-advanced";
import { fetchRecentContractRecords } from "@/lib/on-chain-records";
import { formatXlmStroops } from "@/lib/stellar-amount";
import { shortenAddress } from "@/lib/utils";
import type { StreamData } from "@/types/contract-abi";

export default function StreamDetailPage() {
  const params = useParams();
  const idStr = Array.isArray(params?.id) ? params.id[0] : (params?.id as string);
  const streamId = idStr ? Number(idStr) : 0;

  const { wallet } = useWallet();
  const toast = useToast();
  const [claiming, setClaiming] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  // Fetch streams list and locate current stream by ID
  const {
    data: streams = [],
    refetch,
  } = useApiQuery<StreamData[]>(
    ["streams"],
    undefined,
    undefined,
    () => fetchRecentContractRecords<StreamData>("streams")
  );

  const stream = useMemo(() => {
    return streams.find((s) => s.id === streamId);
  }, [streams, streamId]);

  const userAddress = wallet.publicKey;
  const isCreator = userAddress && stream && userAddress === stream.creator;
  const isRecipient = userAddress && stream && userAddress === stream.recipient;

  const handleClaim = async () => {
    if (!userAddress || !stream) {
      toast.error("Please connect your wallet to claim tokens.");
      return;
    }
    setClaiming(true);
    try {
      const res = await claimStream(userAddress, stream.id);
      if (!res.success) throw new Error(res.error || "Claim failed");
      toast.success("Successfully claimed vested tokens!");
      await refetch();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to claim stream.");
    } finally {
      setClaiming(false);
    }
  };

  const handleCancel = async () => {
    if (!userAddress || !stream) return;
    setCancelling(true);
    try {
      const res = await cancelStream(userAddress, stream.id);
      if (!res.success) throw new Error(res.error || "Cancel failed");
      toast.success("Stream cancelled successfully. Refund transferred.");
      await refetch();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to cancel stream.");
    } finally {
      setCancelling(false);
    }
  };

  // Fallback demo/initial data if record not yet indexed
  const activeStream: StreamData = stream ?? {
    id: streamId || 1,
    creator: userAddress || "GAWPX2B5V3C4DEMOCREATORADDRESS7777777777777777777777777777777",
    recipient: "GBXPX2B5V3C4DEMORECIPIENTADDRESS8888888888888888888888888888888",
    total_amount: BigInt(100_000_000), // 10 XLM
    claimed_amount: BigInt(20_000_000), // 2 XLM
    asset: "native",
    start_time: Math.floor(Date.now() / 1000) - 86400 * 3, // Started 3 days ago
    end_time: Math.floor(Date.now() / 1000) + 86400 * 7, // Ends in 7 days
    cancelled: false,
    metadata: "Vesting Stream",
  };

  const status = activeStream.cancelled
    ? "CANCELLED"
    : Date.now() / 1000 >= activeStream.end_time
    ? "COMPLETED"
    : "ACTIVE";

  return (
    <div className="container max-w-5xl mx-auto px-4 py-8 space-y-6">
      {/* Top Navigation */}
      <div className="flex items-center justify-between">
        <Link
          href="/streams"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
        >
          &larr; Back to Streams
        </Link>
        <StatusBadge status={status} />
      </div>

      {/* Stream Title Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground">
            Stream #{activeStream.id}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {activeStream.metadata || "Linear token vesting schedule"}
          </p>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-2">
          {isCreator && !activeStream.cancelled && (
            <button
              onClick={handleCancel}
              disabled={cancelling}
              className="px-3.5 py-2 text-sm font-medium rounded-lg border border-destructive text-destructive hover:bg-destructive/10 disabled:opacity-50 transition-colors"
            >
              {cancelling ? "Cancelling..." : "Cancel Stream"}
            </button>
          )}
        </div>
      </div>

      {/* Interactive Vesting Progress Chart Component */}
      <VestingProgressChart
        totalAmount={activeStream.total_amount}
        claimedAmount={activeStream.claimed_amount}
        startTime={activeStream.start_time}
        endTime={activeStream.end_time}
        onClaim={isRecipient && !activeStream.cancelled ? handleClaim : undefined}
        isClaiming={claiming}
      />

      {/* Stream Metrics Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <Card className="p-4 space-y-1">
          <span className="text-xs text-muted-foreground uppercase font-medium">Total Stream Amount</span>
          <p className="text-xl font-bold text-foreground">
            {formatXlmStroops(activeStream.total_amount)}
          </p>
        </Card>

        <Card className="p-4 space-y-1">
          <span className="text-xs text-muted-foreground uppercase font-medium">Claimed by Recipient</span>
          <p className="text-xl font-bold text-foreground">
            {formatXlmStroops(activeStream.claimed_amount)}
          </p>
        </Card>

        <Card className="p-4 space-y-1">
          <span className="text-xs text-muted-foreground uppercase font-medium">Remaining Unvested</span>
          <p className="text-xl font-bold text-foreground">
            {formatXlmStroops(
              activeStream.total_amount > activeStream.claimed_amount
                ? activeStream.total_amount - activeStream.claimed_amount
                : BigInt(0)
            )}
          </p>
        </Card>
      </div>

      {/* Parties and Configuration Details */}
      <Card className="p-6 space-y-4">
        <h3 className="text-base font-semibold text-foreground border-b border-border pb-2">
          Contract Details
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
          <div>
            <span className="text-muted-foreground block text-xs">Creator (Funder)</span>
            <div className="flex items-center gap-2 mt-1">
              <span className="font-mono text-foreground">{shortenAddress(activeStream.creator)}</span>
              <CopyButton value={activeStream.creator} />
            </div>
          </div>

          <div>
            <span className="text-muted-foreground block text-xs">Recipient (Beneficiary)</span>
            <div className="flex items-center gap-2 mt-1">
              <span className="font-mono text-foreground">{shortenAddress(activeStream.recipient)}</span>
              <CopyButton value={activeStream.recipient} />
            </div>
          </div>

          <div>
            <span className="text-muted-foreground block text-xs">Start Date</span>
            <span className="font-medium text-foreground mt-1 block">
              {new Date(activeStream.start_time * 1000).toLocaleString()}
            </span>
          </div>

          <div>
            <span className="text-muted-foreground block text-xs">End Date</span>
            <span className="font-medium text-foreground mt-1 block">
              {new Date(activeStream.end_time * 1000).toLocaleString()}
            </span>
          </div>
        </div>
      </Card>
    </div>
  );
}
