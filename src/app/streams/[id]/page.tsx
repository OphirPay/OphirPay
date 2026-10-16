"use client";
// SPDX-License-Identifier: MIT

import { useParams } from "next/navigation";
import { useState } from "react";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { VestingProgressChart } from "@/components/streams/VestingProgressChart";
import { useWallet } from "@/hooks/useMultiWallet";
import { useToast } from "@/components/ui/Toast";
import { useApiQuery } from "@/hooks/useApiQuery";
import { fetchRecentContractRecords } from "@/lib/on-chain-records";
import { formatXlmStroops } from "@/lib/stellar-amount";
import { shortenAddress } from "@/lib/utils";
import { claimStream, cancelStream } from "@/lib/contract-advanced";
import type { StreamData } from "@/types/contract-abi";
import { usePageTitle } from "@/hooks/usePageTitle";
import { PAGE_TITLES } from "@/lib/page-titles";

export default function StreamDetailPage() {
  usePageTitle(PAGE_TITLES.STREAMS);
  const params = useParams<{ id: string }>();
  const streamId = Number(params?.id);
  const { wallet } = useWallet();
  const toast = useToast();
  const [submitting, setSubmitting] = useState(false);

  const {
    data: streams = [],
    isLoading,
    refetch,
  } = useApiQuery<StreamData[]>(
    ["streams"],
    undefined,
    undefined,
    () => fetchRecentContractRecords<StreamData>("streams"),
  );

  const stream = streams.find((s) => Number(s.id) === streamId);

  if (!stream) {
    return (
      <div className="space-y-6 animate-fade-in">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
            Stream #{streamId}
          </h1>
        </div>
        {isLoading ? (
          <p className="text-sm text-gray-500">Loading stream details...</p>
        ) : (
          <Card className="p-8 text-center">
            <h2 className="font-semibold text-gray-900 dark:text-white">
              Stream not found
            </h2>
            <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
              This stream may have been pruned from recent records or does not exist.
            </p>
          </Card>
        )}
      </div>
    );
  }

  const total = BigInt(stream.total_amount);
  const claimed = BigInt(stream.claimed_amount);
  const start = BigInt(stream.start_time);
  const end = BigInt(stream.end_time);
  const isCreator = wallet.publicKey === stream.creator;
  const isRecipient = wallet.publicKey === stream.recipient;

  const handleClaim = async () => {
    if (!wallet.publicKey) return;
    setSubmitting(true);
    try {
      const result = await claimStream(wallet.publicKey, streamId);
      if (!result.success) throw new Error(result.error || "Claim failed");
      toast.success(`Stream ${streamId} claimed`);
      await refetch();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Claim failed");
    } finally {
      setSubmitting(false);
    }
  };

  const handleCancel = async () => {
    if (!wallet.publicKey) return;
    setSubmitting(true);
    try {
      const result = await cancelStream(wallet.publicKey, streamId);
      if (!result.success) throw new Error(result.error || "Cancel failed");
      toast.success(`Stream ${streamId} cancelled`);
      await refetch();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Cancel failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
          Stream #{streamId}
        </h1>
        <Badge variant={stream.cancelled ? "danger" : "info"}>
          {stream.cancelled ? "Cancelled" : "Active"}
        </Badge>
        <span className="ml-auto text-lg font-semibold text-gray-900 dark:text-white">
          {formatXlmStroops(total)}
        </span>
      </div>

      <VestingProgressChart
        streamId={streamId}
        totalAmount={total}
        startTime={start}
        endTime={end}
        claimedAmount={claimed}
        cancelled={stream.cancelled}
        metadata={stream.metadata}
      />

      <Card className="p-4 space-y-3">
        <h2 className="font-semibold text-gray-900 dark:text-white">Details</h2>
        <dl className="grid gap-2 text-sm text-gray-600 dark:text-gray-400 sm:grid-cols-2">
          <div>
            <dt className="inline font-medium">Creator: </dt>
            <dd className="inline font-mono">{shortenAddress(stream.creator, 12)}</dd>
          </div>
          <div>
            <dt className="inline font-medium">Recipient: </dt>
            <dd className="inline font-mono">{shortenAddress(stream.recipient, 12)}</dd>
          </div>
          <div>
            <dt className="inline font-medium">Starts: </dt>
            <dd className="inline">{new Date(Number(start) * 1000).toLocaleString()}</dd>
          </div>
          <div>
            <dt className="inline font-medium">Ends: </dt>
            <dd className="inline">{new Date(Number(end) * 1000).toLocaleString()}</dd>
          </div>
        </dl>
        {stream.metadata && (
          <p className="text-sm text-gray-500 dark:text-gray-400">{stream.metadata}</p>
        )}
      </Card>

      {wallet.connected && !stream.cancelled && (
        <div className="flex flex-wrap gap-2">
          {isRecipient && (
            <Button onClick={() => void handleClaim()} loading={submitting}>
              Claim vested tokens
            </Button>
          )}
          {isCreator && (
            <Button variant="secondary" onClick={() => void handleCancel()} loading={submitting}>
              Cancel stream
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
