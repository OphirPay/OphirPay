"use client";
// SPDX-License-Identifier: MIT

import { useState, useMemo } from "react";
import { usePageTitle } from "@/hooks/usePageTitle";
import { PAGE_TITLES } from "@/lib/page-titles";
import { useWallet } from "@/hooks/useMultiWallet";
import { useApiQuery } from "@/hooks/useApiQuery";
import { EmptyState } from "@/components/EmptyState";
import { Button } from "@/components/ui/Button";
import { StreamCard } from "@/components/streams/StreamCard";
import { CreateStreamModal } from "@/components/streams/CreateStreamModal";
import {
  type StreamRecord,
  normalizeStream,
  getStreamStatus,
  computeClaimable,
  formatStroopAmount,
} from "@/lib/streams";

interface StreamsApiResponse {
  count: number;
  items?: unknown[];
  streams?: unknown[];
}

export default function StreamsPage() {
  usePageTitle(PAGE_TITLES.STREAMS);
  const { wallet } = useWallet();
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [activeTab, setActiveTab] = useState<
    "all" | "incoming" | "outgoing" | "active" | "completed" | "cancelled"
  >("all");
  const [searchQuery, setSearchQuery] = useState("");

  const {
    data: streamsData,
    isLoading,
    refetch,
  } = useApiQuery<StreamsApiResponse>(
    ["streams", "list"],
    "/api/streams?populate=true"
  );

  const streams: StreamRecord[] = useMemo(() => {
    const rawList = streamsData?.items || streamsData?.streams || [];
    return rawList.map(normalizeStream);
  }, [streamsData]);

  const userAddress = wallet.publicKey?.toLowerCase();

  // Metrics summary
  const stats = useMemo(() => {
    let totalStreams = streams.length;
    let activeStreams = 0;
    let totalLockedStroops = BigInt(0);
    let myClaimableStroops = BigInt(0);
    const nowSeconds = Math.floor(Date.now() / 1000);

    for (const s of streams) {
      const status = getStreamStatus(s, nowSeconds);
      if (status === "ACTIVE") activeStreams++;
      totalLockedStroops += BigInt(s.totalAmount);

      if (userAddress && s.recipient.toLowerCase() === userAddress) {
        myClaimableStroops += computeClaimable(
          s.totalAmount,
          s.claimedAmount,
          s.startTime,
          s.endTime,
          nowSeconds,
          s.cancelled
        );
      }
    }

    return {
      totalStreams,
      activeStreams,
      totalLockedXlm: formatStroopAmount(totalLockedStroops),
      myClaimableXlm: formatStroopAmount(myClaimableStroops),
    };
  }, [streams, userAddress]);

  // Filtered streams based on tab and search
  const filteredStreams = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    const nowSeconds = Math.floor(Date.now() / 1000);

    return streams.filter((s) => {
      // Tab filter
      if (activeTab === "incoming") {
        if (!userAddress || s.recipient.toLowerCase() !== userAddress) return false;
      } else if (activeTab === "outgoing") {
        if (!userAddress || s.creator.toLowerCase() !== userAddress) return false;
      } else if (activeTab === "active") {
        if (getStreamStatus(s, nowSeconds) !== "ACTIVE") return false;
      } else if (activeTab === "completed") {
        if (getStreamStatus(s, nowSeconds) !== "COMPLETED") return false;
      } else if (activeTab === "cancelled") {
        if (getStreamStatus(s, nowSeconds) !== "CANCELLED") return false;
      }

      // Query filter
      if (query) {
        const matchesId = String(s.id).includes(query);
        const matchesRecipient = s.recipient.toLowerCase().includes(query);
        const matchesCreator = s.creator.toLowerCase().includes(query);
        const matchesMeta = s.metadata.toLowerCase().includes(query);
        if (!matchesId && !matchesRecipient && !matchesCreator && !matchesMeta) {
          return false;
        }
      }

      return true;
    });
  }, [streams, activeTab, searchQuery, userAddress]);

  return (
    <div className="space-y-6 max-w-7xl mx-auto px-4 py-6">
      {/* Header with Title and Create Action */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-gray-900 dark:text-gray-100">
            Payment Streams
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Continuous second-by-second linear token vesting on the Stellar Soroban blockchain.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => refetch()}
            loading={isLoading}
          >
            ↻ Refresh
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={() => setShowCreateModal(true)}
          >
            + Create Stream
          </Button>
        </div>
      </div>

      {/* Metrics Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="p-4 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
          <p className="text-xs font-medium text-gray-500 dark:text-gray-400">Total Streams</p>
          <p className="text-2xl font-bold text-gray-900 dark:text-gray-100 mt-1">
            {stats.totalStreams}
          </p>
        </div>

        <div className="p-4 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
          <p className="text-xs font-medium text-gray-500 dark:text-gray-400">Active Streams</p>
          <p className="text-2xl font-bold text-emerald-600 dark:text-emerald-400 mt-1">
            {stats.activeStreams}
          </p>
        </div>

        <div className="p-4 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
          <p className="text-xs font-medium text-gray-500 dark:text-gray-400">Total Volume</p>
          <p className="text-2xl font-bold font-mono text-gray-900 dark:text-gray-100 mt-1">
            {stats.totalLockedXlm} <span className="text-xs font-sans font-normal text-gray-400">XLM</span>
          </p>
        </div>

        <div className="p-4 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
          <p className="text-xs font-medium text-gray-500 dark:text-gray-400">Available to Claim</p>
          <p className="text-2xl font-bold font-mono text-indigo-600 dark:text-indigo-400 mt-1">
            {stats.myClaimableXlm} <span className="text-xs font-sans font-normal text-gray-400">XLM</span>
          </p>
        </div>
      </div>

      {/* Tabs and Search Controls */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 pt-2">
        <div className="flex flex-wrap items-center gap-1.5 p-1 bg-gray-100 dark:bg-gray-800/80 rounded-lg">
          {(
            [
              { key: "all", label: "All Streams" },
              { key: "incoming", label: "Incoming (Recipient)" },
              { key: "outgoing", label: "Outgoing (Creator)" },
              { key: "active", label: "Active" },
              { key: "completed", label: "Completed" },
              { key: "cancelled", label: "Cancelled" },
            ] as const
          ).map((t) => (
            <button
              key={t.key}
              onClick={() => setActiveTab(t.key)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                activeTab === t.key
                  ? "bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 shadow-sm"
                  : "text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="relative">
          <input
            type="text"
            placeholder="Search by ID, wallet, or memo..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full sm:w-64 px-3 py-1.5 text-xs rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-ophir-500 focus:outline-none"
          />
        </div>
      </div>

      {/* Stream Cards or Empty State */}
      {isLoading ? (
        <div className="space-y-4">
          {[1, 2].map((n) => (
            <div
              key={n}
              className="h-44 bg-gray-100 dark:bg-gray-800 animate-pulse rounded-xl"
            />
          ))}
        </div>
      ) : filteredStreams.length === 0 ? (
        <EmptyState
          icon={
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="h-8 w-8 text-gray-400"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M3.75 3v11.25A2.25 2.25 0 006 16.5h2.25M3.75 3h-1.5m1.5 0h16.5m0 0h1.5m-1.5 0v11.25A2.25 2.25 0 0118 16.5h-2.25m-7.5 0h7.5m-7.5 0l-1 3m1-3l1 3m5-3l-1 3m1-3l1 3M9 10.5l3-3m0 0l3 3m-3-3v7.5"
              />
            </svg>
          }
          title={searchQuery ? "No matching streams found" : "No payment streams yet"}
          description={
            searchQuery
              ? "Try adjusting your search criteria or switching to a different filter tab."
              : "Launch your first second-by-second linear payment stream to automate grant disbursals, vesting payroll, or retainer subscriptions."
          }
          actionLabel="Create Stream"
          onAction={() => setShowCreateModal(true)}
        />
      ) : (
        <div className="grid grid-cols-1 gap-4">
          {filteredStreams.map((stream) => (
            <StreamCard
              key={stream.id}
              stream={stream}
              currentUserAddress={wallet.publicKey}
              onUpdated={() => refetch()}
            />
          ))}
        </div>
      )}

      {/* Creation Modal */}
      <CreateStreamModal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        onSuccess={() => refetch()}
      />
    </div>
  );
}
