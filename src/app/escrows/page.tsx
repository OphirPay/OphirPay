"use client";
// SPDX-License-Identifier: MIT

import { useState, useMemo } from "react";
import { usePageTitle } from "@/hooks/usePageTitle";
import { PAGE_TITLES } from "@/lib/page-titles";
import { useWallet } from "@/hooks/useMultiWallet";
import { useApiQuery } from "@/hooks/useApiQuery";
import { EmptyState } from "@/components/EmptyState";
import { Button } from "@/components/ui/Button";
import { EscrowCard } from "@/components/escrows/EscrowCard";
import { CreateEscrowModal } from "@/components/escrows/CreateEscrowModal";
import {
  type EscrowRecord,
  normalizeEscrow,
  getEscrowStatus,
  formatStroopAmount,
} from "@/lib/escrows";

interface EscrowsApiResponse {
  count: number;
  items?: unknown[];
  escrows?: unknown[];
}

export default function EscrowsPage() {
  usePageTitle(PAGE_TITLES.ESCROWS);
  const { wallet } = useWallet();
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [activeTab, setActiveTab] = useState<
    "all" | "depositor" | "beneficiary" | "arbiter" | "active" | "settled"
  >("all");
  const [searchQuery, setSearchQuery] = useState("");

  const {
    data: escrowsData,
    isLoading,
    refetch,
  } = useApiQuery<EscrowsApiResponse>(
    ["escrows", "list"],
    "/api/escrows?populate=true"
  );

  const escrows: EscrowRecord[] = useMemo(() => {
    const rawList = escrowsData?.items || escrowsData?.escrows || [];
    return rawList.map(normalizeEscrow);
  }, [escrowsData]);

  const userAddress = wallet.publicKey?.toLowerCase();

  // Metrics summary
  const stats = useMemo(() => {
    let totalCount = escrows.length;
    let activeCount = 0;
    let totalLockedStroops = 0n;
    let myClaimableStroops = 0n;
    const nowSeconds = Math.floor(Date.now() / 1000);

    for (const e of escrows) {
      const status = getEscrowStatus(e, nowSeconds);
      if (status === "LOCKED" || status === "DUE_FOR_CLAIM") {
        activeCount++;
        totalLockedStroops += BigInt(e.amount);
      }

      if (
        userAddress &&
        e.beneficiary.toLowerCase() === userAddress &&
        status === "DUE_FOR_CLAIM"
      ) {
        myClaimableStroops += BigInt(e.amount);
      }
    }

    return {
      totalCount,
      activeCount,
      totalLockedXlm: formatStroopAmount(totalLockedStroops),
      myClaimableXlm: formatStroopAmount(myClaimableStroops),
    };
  }, [escrows, userAddress]);

  // Filtering
  const filteredEscrows = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    const nowSeconds = Math.floor(Date.now() / 1000);

    return escrows.filter((e) => {
      const status = getEscrowStatus(e, nowSeconds);

      // Tab filter
      if (activeTab === "depositor") {
        if (!userAddress || e.depositor.toLowerCase() !== userAddress) return false;
      } else if (activeTab === "beneficiary") {
        if (!userAddress || e.beneficiary.toLowerCase() !== userAddress) return false;
      } else if (activeTab === "arbiter") {
        if (!userAddress || !e.arbiter || e.arbiter.toLowerCase() !== userAddress) return false;
      } else if (activeTab === "active") {
        if (status !== "LOCKED" && status !== "DUE_FOR_CLAIM") return false;
      } else if (activeTab === "settled") {
        if (status !== "RELEASED" && status !== "CLAIMED") return false;
      }

      // Query filter
      if (query) {
        const matchesId = String(e.id).includes(query);
        const matchesDepositor = e.depositor.toLowerCase().includes(query);
        const matchesBeneficiary = e.beneficiary.toLowerCase().includes(query);
        const matchesArbiter = e.arbiter ? e.arbiter.toLowerCase().includes(query) : false;
        const matchesMeta = e.metadata.toLowerCase().includes(query);
        if (!matchesId && !matchesDepositor && !matchesBeneficiary && !matchesArbiter && !matchesMeta) {
          return false;
        }
      }

      return true;
    });
  }, [escrows, activeTab, searchQuery, userAddress]);

  return (
    <div className="space-y-6 max-w-7xl mx-auto px-4 py-6">
      {/* Header with Title and Create Action */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-gray-900 dark:text-gray-100">
            Escrow Management
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Trustless on-chain escrow contracts with deadline-gated release and third-party dispute arbitration.
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
            + Create Escrow
          </Button>
        </div>
      </div>

      {/* Metrics Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="p-4 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
          <p className="text-xs font-medium text-gray-500 dark:text-gray-400">Total Escrows</p>
          <p className="text-2xl font-bold text-gray-900 dark:text-gray-100 mt-1">
            {stats.totalCount}
          </p>
        </div>

        <div className="p-4 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
          <p className="text-xs font-medium text-gray-500 dark:text-gray-400">Active Locked</p>
          <p className="text-2xl font-bold text-amber-600 dark:text-amber-400 mt-1">
            {stats.activeCount}
          </p>
        </div>

        <div className="p-4 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
          <p className="text-xs font-medium text-gray-500 dark:text-gray-400">Locked Value</p>
          <p className="text-2xl font-bold font-mono text-gray-900 dark:text-gray-100 mt-1">
            {stats.totalLockedXlm} <span className="text-xs font-sans font-normal text-gray-400">XLM</span>
          </p>
        </div>

        <div className="p-4 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
          <p className="text-xs font-medium text-gray-500 dark:text-gray-400">Ready to Claim</p>
          <p className="text-2xl font-bold font-mono text-emerald-600 dark:text-emerald-400 mt-1">
            {stats.myClaimableXlm} <span className="text-xs font-sans font-normal text-gray-400">XLM</span>
          </p>
        </div>
      </div>

      {/* Tabs and Search Controls */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 pt-2">
        <div className="flex flex-wrap items-center gap-1.5 p-1 bg-gray-100 dark:bg-gray-800/80 rounded-lg">
          {(
            [
              { key: "all", label: "All Escrows" },
              { key: "depositor", label: "As Depositor" },
              { key: "beneficiary", label: "As Beneficiary" },
              { key: "arbiter", label: "As Arbiter" },
              { key: "active", label: "Active" },
              { key: "settled", label: "Settled" },
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

      {/* Escrow Cards or Empty State */}
      {isLoading ? (
        <div className="space-y-4">
          {[1, 2].map((n) => (
            <div
              key={n}
              className="h-44 bg-gray-100 dark:bg-gray-800 animate-pulse rounded-xl"
            />
          ))}
        </div>
      ) : filteredEscrows.length === 0 ? (
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
                d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z"
              />
            </svg>
          }
          title={searchQuery ? "No matching escrows found" : "No escrows found"}
          description={
            searchQuery
              ? "Try changing your search terms or selecting a different status tab."
              : "Lock funds in a trustless Soroban escrow with custom release conditions and optional dispute arbitration."
          }
          actionLabel="Create Escrow"
          onAction={() => setShowCreateModal(true)}
        />
      ) : (
        <div className="grid grid-cols-1 gap-4">
          {filteredEscrows.map((escrow) => (
            <EscrowCard
              key={escrow.id}
              escrow={escrow}
              currentUserAddress={wallet.publicKey}
              onUpdated={() => refetch()}
            />
          ))}
        </div>
      )}

      {/* Creation Modal */}
      <CreateEscrowModal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        onSuccess={() => refetch()}
      />
    </div>
  );
}
