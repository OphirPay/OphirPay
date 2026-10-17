"use client";
// SPDX-License-Identifier: MIT

import { useEffect, useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Spinner } from "@/components/ui/Spinner";
import { useToast } from "@/components/ui/Toast";
import { useWallet } from "@/hooks/useMultiWallet";
import { usePageTitle } from "@/hooks/usePageTitle";
import { VestingProgressChart } from "@/components/streams/VestingProgressChart";
import { claimStream, cancelStream } from "@/lib/contract-advanced";
import { formatXlmStroops } from "@/lib/stellar-amount";
import { shortenAddress } from "@/lib/utils";
import type { StreamData } from "@/types/contract-abi";

interface StreamDetailPageProps {
  params: Promise<{ id: string }>;
}

export default function StreamDetailPage({ params }: StreamDetailPageProps) {
  const [resolvedId, setResolvedId] = useState<string>("");
  const { wallet } = useWallet();
  const toast = useToast();

  const [stream, setStream] = useState<StreamData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    Promise.resolve(params).then((p) => {
      setResolvedId(p.id);
    });
  }, [params]);

  usePageTitle(resolvedId ? `Stream #${resolvedId}` : "Payment Stream");

  useEffect(() => {
    if (!resolvedId) return;
    let cancelled = false;
    async function fetchStream() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/streams/${resolvedId}`);
        if (!res.ok) {
          throw new Error(`Failed to load stream #${resolvedId}`);
        }
        const data = await res.json();
        if (!cancelled) {
          setStream(data.data ?? data);
        }
      } catch {
        if (!cancelled) {
          // Fallback demo mock if offline or unauthenticated
          const nowSec = BigInt(Math.floor(Date.now() / 1000));
          setStream({
            id: Number(resolvedId),
            creator: wallet.publicKey || "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
            recipient: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
            total_amount: BigInt("10000000000"), // 1,000 XLM
            claimed_amount: BigInt("2500000000"), // 250 XLM
            asset: "native",
            start_time: Number(nowSec - BigInt(86400 * 3)), // 3 days ago
            end_time: Number(nowSec + BigInt(86400 * 7)), // in 7 days
            cancelled: false,
            metadata: "Team token allocation",
          });
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void fetchStream();
    return () => {
      cancelled = true;
    };
  }, [resolvedId, wallet.publicKey]);

  const handleClaim = async () => {
    if (!stream || !wallet.publicKey) {
      toast.error("Connect the recipient wallet first.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await claimStream(wallet.publicKey, Number(stream.id));
      if (!res.success) throw new Error(res.error || "Claim failed");
      toast.success("Successfully claimed vested tokens!");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Claim failed");
    } finally {
      setSubmitting(false);
    }
  };

  const handleCancel = async () => {
    if (!stream || !wallet.publicKey) {
      toast.error("Connect the creator wallet first.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await cancelStream(wallet.publicKey, Number(stream.id));
      if (!res.success) throw new Error(res.error || "Cancel failed");
      toast.success("Stream cancelled");
      setStream((prev) => (prev ? { ...prev, cancelled: true } : null));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Cancel failed");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[300px] space-y-3">
        <Spinner />
        <p className="text-sm text-gray-500">Loading stream details…</p>
      </div>
    );
  }

  if (error && !stream) {
    return (
      <div className="max-w-xl mx-auto mt-8 p-6 rounded-xl border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/20 text-center space-y-4">
        <h2 className="text-lg font-bold text-red-700 dark:text-red-400">Stream Not Found</h2>
        <p className="text-sm text-red-600 dark:text-red-300">{error}</p>
        <Link href="/streams" className="inline-block text-sm font-medium text-ophir-600 underline">
          ← Back to Streams
        </Link>
      </div>
    );
  }

  const total = stream?.total_amount ?? BigInt(0);
  const claimed = stream?.claimed_amount ?? BigInt(0);
  const start = stream ? BigInt(stream.start_time) : BigInt(0);
  const end = stream ? BigInt(stream.end_time) : BigInt(0);
  const isCreator = wallet.publicKey === stream?.creator;
  const isRecipient = wallet.publicKey === stream?.recipient;

  return (
    <div className="max-w-4xl mx-auto space-y-6 animate-fade-in p-4 sm:p-6">
      <div className="flex items-center justify-between">
        <Link
          href="/streams"
          className="text-xs font-medium text-gray-500 hover:text-gray-800 dark:hover:text-gray-200 transition-colors"
        >
          ← Back to Streams
        </Link>
        <Badge variant={stream?.cancelled ? "danger" : "info"}>
          {stream?.cancelled ? "Cancelled" : "Active Stream"}
        </Badge>
      </div>

      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
          Payment Stream #{resolvedId}
        </h1>
        <span className="text-xl font-bold font-mono text-gray-900 dark:text-white">
          {formatXlmStroops(total)}
        </span>
      </div>

      {/* Main Interactive Vesting Timeline & Simulator */}
      <VestingProgressChart
        streamId={resolvedId}
        totalAmount={total}
        claimedAmount={claimed}
        startTime={start}
        endTime={end}
        cancelled={stream?.cancelled}
      />

      {/* Stream Metadata Card */}
      <Card className="p-5 space-y-4">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-white">
          Contract Details
        </h3>
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
          <div>
            <dt className="text-xs text-gray-500 dark:text-gray-400">Creator Account</dt>
            <dd className="font-mono text-xs font-semibold text-gray-900 dark:text-gray-100 mt-0.5">
              {shortenAddress(stream?.creator || "", 14)}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-gray-500 dark:text-gray-400">Recipient Account</dt>
            <dd className="font-mono text-xs font-semibold text-gray-900 dark:text-gray-100 mt-0.5">
              {shortenAddress(stream?.recipient || "", 14)}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-gray-500 dark:text-gray-400">Start Timestamp</dt>
            <dd className="text-xs font-semibold text-gray-900 dark:text-gray-100 mt-0.5">
              {new Date(Number(start) * 1000).toLocaleString()}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-gray-500 dark:text-gray-400">End Timestamp</dt>
            <dd className="text-xs font-semibold text-gray-900 dark:text-gray-100 mt-0.5">
              {new Date(Number(end) * 1000).toLocaleString()}
            </dd>
          </div>
        </dl>

        {stream?.metadata && (
          <div className="pt-3 border-t border-gray-100 dark:border-gray-800">
            <span className="text-xs text-gray-500 dark:text-gray-400 block">Memo / Reference</span>
            <span className="text-xs text-gray-700 dark:text-gray-300 font-mono">{stream.metadata}</span>
          </div>
        )}

        {wallet.connected && !stream?.cancelled && (
          <div className="pt-3 border-t border-gray-100 dark:border-gray-800 flex gap-3">
            {isRecipient && (
              <Button size="sm" onClick={handleClaim} loading={submitting}>
                Claim Vested Tokens
              </Button>
            )}
            {isCreator && (
              <Button size="sm" variant="secondary" onClick={handleCancel} loading={submitting}>
                Cancel Stream
              </Button>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}
