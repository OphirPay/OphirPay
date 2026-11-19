"use client";
// SPDX-License-Identifier: MIT

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { useToast } from "@/components/ui/Toast";
import { VestingProgressChart } from "@/components/streams/VestingProgressChart";
import { useApiQuery } from "@/hooks/useApiQuery";
import { usePageTitle } from "@/hooks/usePageTitle";
import { useWallet } from "@/hooks/useMultiWallet";
import { claimStream } from "@/lib/contract-advanced";
import { PAGE_TITLES } from "@/lib/page-titles";
import { shortenAddress } from "@/lib/utils";
import { computeClaimable, type VestingState } from "@/lib/vesting";

/**
 * Shape returned by `GET /api/streams/[id]`.
 *
 * Soroban `i128`/`u64` values pass through `jsonSafe`, so a field can arrive as
 * a number (safe range) or a decimal string (larger values). Everything is
 * normalised to `bigint` below rather than trusted as a number.
 */
interface RawStream {
  id?: number | string;
  creator?: string;
  recipient?: string;
  total_amount?: number | string;
  claimed_amount?: number | string;
  start_time?: number | string;
  end_time?: number | string;
  cancelled?: boolean;
  metadata?: string;
  available?: boolean;
  error?: string;
}

interface StreamView {
  id: number;
  creator: string;
  recipient: string;
  total: bigint;
  claimed: bigint;
  start: bigint;
  end: bigint;
  cancelled: boolean;
  metadata: string;
}

function toBigInt(value: unknown): bigint | null {
  if (value === null || value === undefined || value === "") return null;
  try {
    return BigInt(String(value));
  } catch {
    return null;
  }
}

function normalizeStream(raw: RawStream | null | undefined): StreamView | null {
  if (!raw || raw.available === false) return null;

  const id = Number(raw.id);
  const total = toBigInt(raw.total_amount);
  const claimed = toBigInt(raw.claimed_amount) ?? BigInt(0);
  const start = toBigInt(raw.start_time);
  const end = toBigInt(raw.end_time);

  if (
    !Number.isSafeInteger(id) ||
    !raw.creator ||
    !raw.recipient ||
    total === null ||
    start === null ||
    end === null ||
    end <= start
  ) {
    return null;
  }

  return {
    id,
    creator: raw.creator,
    recipient: raw.recipient,
    total,
    claimed,
    start,
    end,
    cancelled: raw.cancelled === true,
    metadata: raw.metadata ?? "",
  };
}

export default function StreamDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id ?? "";
  const { wallet } = useWallet();
  const toast = useToast();
  const [claiming, setClaiming] = useState(false);
  const [nowSeconds, setNowSeconds] = useState(() => Math.floor(Date.now() / 1000));

  const {
    data: raw,
    isLoading,
    isError,
    error,
    refetch,
  } = useApiQuery<RawStream>(["streams", id], `/api/streams/${encodeURIComponent(id)}`, {
    enabled: Boolean(id),
    retry: false,
  });

  const stream = useMemo(() => normalizeStream(raw), [raw]);
  usePageTitle(stream ? `Stream #${stream.id}` : PAGE_TITLES.STREAMS);

  // Used only to decide whether the claim button is actionable; the chart keeps
  // its own faster clock for the live counter.
  useEffect(() => {
    const timer = window.setInterval(
      () => setNowSeconds(Math.floor(Date.now() / 1000)),
      15_000
    );
    return () => window.clearInterval(timer);
  }, []);

  const vesting: VestingState | null = stream
    ? {
        total: stream.total,
        claimed: stream.claimed,
        start: stream.start,
        end: stream.end,
        now: BigInt(nowSeconds),
        cancelled: stream.cancelled,
      }
    : null;
  const claimable = vesting ? computeClaimable(vesting) : BigInt(0);
  const isRecipient = Boolean(
    stream && wallet.publicKey && wallet.publicKey === stream.recipient
  );

  const handleClaim = async () => {
    if (!stream || !wallet.publicKey) return;
    setClaiming(true);
    try {
      const result = await claimStream(wallet.publicKey, stream.id);
      if (!result.success) {
        throw new Error(result.error || "Claim failed");
      }
      toast.success(
        "Stream claimed",
        "The vested balance has been transferred to your wallet."
      );
      await refetch();
    } catch (err) {
      toast.error(
        "Claim failed",
        err instanceof Error ? err.message : "The stream claim transaction failed."
      );
    } finally {
      setClaiming(false);
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-4" aria-label="Loading stream">
        <div className="h-8 w-48 animate-pulse rounded bg-gray-200 dark:bg-gray-800" />
        <div className="h-48 animate-pulse rounded-xl bg-gray-100 dark:bg-gray-800" />
        <div className="h-24 animate-pulse rounded-xl bg-gray-100 dark:bg-gray-800" />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="space-y-4">
        <Link
          href="/streams"
          className="text-sm text-ophir-600 hover:underline dark:text-ophir-400"
        >
          ← Back to streams
        </Link>
        <div
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/30 dark:text-red-300"
        >
          {error?.message || `Unable to load stream #${id}.`}
        </div>
      </div>
    );
  }

  if (!stream) {
    return (
      <div className="space-y-4">
        <Link
          href="/streams"
          className="text-sm text-ophir-600 hover:underline dark:text-ophir-400"
        >
          ← Back to streams
        </Link>
        <Card className="p-8 text-center">
          <h1 className="font-semibold text-gray-900 dark:text-white">
            Stream #{id} not found
          </h1>
          <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
            It may never have existed on this network, or the contract returned
            an unreadable payload.
          </p>
        </Card>
      </div>
    );
  }

  const fullyVested = nowSeconds >= Number(stream.end);

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="flex flex-wrap items-center gap-3">
        <Link
          href="/streams"
          className="text-sm text-ophir-600 hover:underline dark:text-ophir-400"
        >
          ← Back to streams
        </Link>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
          Stream #{stream.id}
        </h1>
        <Badge
          variant={
            stream.cancelled ? "danger" : fullyVested ? "success" : "info"
          }
        >
          {stream.cancelled
            ? "Cancelled"
            : fullyVested
              ? "Fully vested"
              : "Active"}
        </Badge>
      </div>

      <VestingProgressChart
        totalAmount={stream.total}
        claimedAmount={stream.claimed}
        startTime={Number(stream.start)}
        endTime={Number(stream.end)}
        cancelled={stream.cancelled}
      />

      <Card className="space-y-3 p-4">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-white">
          Stream details
        </h2>
        <dl className="grid gap-2 text-sm text-gray-600 sm:grid-cols-2 dark:text-gray-400">
          <div>
            <dt className="inline font-medium">Creator: </dt>
            <dd className="inline font-mono" title={stream.creator}>
              {shortenAddress(stream.creator, 12)}
            </dd>
          </div>
          <div>
            <dt className="inline font-medium">Recipient: </dt>
            <dd className="inline font-mono" title={stream.recipient}>
              {shortenAddress(stream.recipient, 12)}
            </dd>
          </div>
          <div>
            <dt className="inline font-medium">Starts: </dt>
            <dd className="inline">
              {new Date(Number(stream.start) * 1000).toLocaleString()}
            </dd>
          </div>
          <div>
            <dt className="inline font-medium">Ends: </dt>
            <dd className="inline">
              {new Date(Number(stream.end) * 1000).toLocaleString()}
            </dd>
          </div>
        </dl>
        {stream.metadata && (
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {stream.metadata}
          </p>
        )}
      </Card>

      {!stream.cancelled && (
        <div className="flex flex-wrap items-center gap-3">
          {isRecipient ? (
            <Button
              onClick={() => void handleClaim()}
              loading={claiming}
              disabled={claimable <= BigInt(0)}
            >
              {claimable > BigInt(0)
                ? "Claim vested tokens"
                : "Nothing claimable yet"}
            </Button>
          ) : (
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Only the stream recipient can claim vested tokens.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
