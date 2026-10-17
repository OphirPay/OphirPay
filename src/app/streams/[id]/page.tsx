"use client";
// SPDX-License-Identifier: MIT

import { useParams } from "next/navigation";
import Link from "next/link";
import {
  VestingProgressChart,
  type VestingStreamConfig,
} from "@/components/streams/VestingProgressChart";

const DEFAULT_DEMO_STREAM: VestingStreamConfig = {
  id: "1",
  totalAmount: 10000,
  claimedAmount: 1500,
  assetCode: "XLM",
  startTime: 1700000000,
  cliffTime: 1700200000,
  endTime: 1701000000,
};

export interface StreamDetailPageProps {
  streamOverride?: VestingStreamConfig;
  initialNowSec?: number;
}

export default function StreamDetailPage({
  streamOverride,
  initialNowSec = 1700500000,
}: StreamDetailPageProps = {}) {
  const params = useParams<{ id?: string }>();
  const resolvedId = streamOverride?.id ?? params?.id ?? DEFAULT_DEMO_STREAM.id;

  const stream: VestingStreamConfig = streamOverride ?? {
    ...DEFAULT_DEMO_STREAM,
    id: String(resolvedId),
  };

  return (
    <div
      className="max-w-3xl mx-auto py-8 px-4 space-y-6"
      data-testid="stream-detail-page"
    >
      <div className="flex items-center justify-between">
        <div>
          <Link
            href="/streams"
            className="text-xs text-ophir-600 dark:text-ophir-400 hover:underline"
          >
            ← Back to Payment Streams
          </Link>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white mt-1">
            Payment Stream #{stream.id}
          </h1>
        </div>
        <span className="px-3 py-1 rounded-full text-xs font-semibold bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400">
          Streaming Active
        </span>
      </div>

      <VestingProgressChart stream={stream} initialNowSec={initialNowSec} />
    </div>
  );
}
