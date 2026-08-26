"use client";
// SPDX-License-Identifier: MIT

import { useState } from "react";
import { EmptyState } from "@/components/EmptyState";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { useApiQuery } from "@/hooks/useApiQuery";

interface FeeVersion {
  version: number;
  payment_fee_bps: number;
  escrow_fee_bps: number;
  stream_fee_bps: number;
  batch_base_fee: string;
  batch_per_item_fee: string;
  enabled: boolean;
  changed_at: string;
  changed_by: string;
}

interface MultisigVersion {
  version: number;
  threshold: number;
  signers: string[];
  enabled: boolean;
  changed_at: string;
  changed_by: string;
}

type Tab = "fees" | "multisig";

interface PolicyVersionData {
  feeConfigHistory: FeeVersion[];
  multisigHistory: MultisigVersion[];
}

export default function PolicyVersionsPage() {
  const [activeTab, setActiveTab] = useState<Tab>("fees");
  const { data, isLoading: loading } = useApiQuery<PolicyVersionData>(
    ["policy-versions"],
    "/api/policy-versions"
  );
  const feeHistory = Array.isArray(data?.feeConfigHistory) ? data.feeConfigHistory : [];
  const multisigHistory = Array.isArray(data?.multisigHistory) ? data.multisigHistory : [];

  const formatTime = (ts: string | number) => {
    const date = new Date(typeof ts === "string" ? Number(ts) * 1000 : Number(ts) * 1000);
    return date.toLocaleString();
  };

  const tabs: { key: Tab; label: string; count: number }[] = [
    { key: "fees", label: "Fee Config Versions", count: feeHistory.length },
    { key: "multisig", label: "Multisig Config Versions", count: multisigHistory.length },
  ];

  if (loading) {
    return (
      <div className="animate-fade-in space-y-6">
        <div className="h-8 w-48 bg-gray-200 dark:bg-gray-700 rounded animate-pulse" />
        <div className="flex gap-3">
          <div className="h-10 w-40 bg-gray-200 dark:bg-gray-700 rounded animate-pulse" />
          <div className="h-10 w-40 bg-gray-200 dark:bg-gray-700 rounded animate-pulse" />
        </div>
        <div className="grid gap-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-24 bg-gray-100 dark:bg-gray-800 rounded animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  const currentData = activeTab === "fees" ? feeHistory : multisigHistory;

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Policy Version History</h1>
        <p className="text-gray-500 dark:text-gray-400 mt-1">
          Immutable on-chain record of all configuration changes — capped at 100 versions
        </p>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 p-1 bg-gray-100 dark:bg-gray-800 rounded-lg w-fit">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${
              activeTab === tab.key
                ? "bg-white dark:bg-gray-700 shadow-sm text-gray-900 dark:text-white"
                : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
            }`}
          >
            {tab.label}
            <span className="ml-2 text-xs opacity-60">({tab.count})</span>
          </button>
        ))}
      </div>

      {/* Version timeline */}
      {currentData.length === 0 ? (
        <EmptyState
          icon={
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-8 h-8 text-gray-400">
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
            </svg>
          }
          title="No Version History"
          description={`No ${activeTab === "fees" ? "fee config" : "multisig config"} changes have been recorded on-chain yet.`}
        />
      ) : (
        <div className="space-y-3">
          {currentData.map((v, i) => {
            const isLatest = i === 0;
            return (
              <Card
                key={activeTab === "fees" ? (v as FeeVersion).version : (v as MultisigVersion).version}
                className={`p-4 transition-all hover:shadow-md ${isLatest ? "border-l-4 border-l-indigo-500" : ""}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-2 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge variant={isLatest ? "success" : "default"}>
                        {isLatest ? "Latest" : `v${activeTab === "fees" ? (v as FeeVersion).version : (v as MultisigVersion).version}`}
                      </Badge>
                      {activeTab === "fees" && (
                        <Badge variant={(v as FeeVersion).enabled ? "success" : "warning"}>
                          {(v as FeeVersion).enabled ? "Enabled" : "Disabled"}
                        </Badge>
                      )}
                      {activeTab === "multisig" && (
                        <Badge variant={(v as MultisigVersion).enabled ? "success" : "warning"}>
                          {(v as MultisigVersion).enabled ? "Enabled" : "Disabled"}
                        </Badge>
                      )}
                    </div>

                    {activeTab === "fees" ? (
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-sm">
                        {(() => {
                          const fv = v as FeeVersion;
                          const bpsToPct = (bps: number) => (bps / 100).toFixed(2);
                          return (
                            <>
                              <div><span className="text-gray-500">Payment:</span> <span className="font-medium">{bpsToPct(fv.payment_fee_bps)}%</span></div>
                              <div><span className="text-gray-500">Escrow:</span> <span className="font-medium">{bpsToPct(fv.escrow_fee_bps)}%</span></div>
                              <div><span className="text-gray-500">Stream:</span> <span className="font-medium">{bpsToPct(fv.stream_fee_bps)}%</span></div>
                              <div><span className="text-gray-500">Batch:</span> <span className="font-medium">{Number(fv.batch_base_fee) / 10_000_000} XLM</span></div>
                            </>
                          );
                        })()}
                      </div>
                    ) : (
                      <div className="text-sm space-y-1">
                        {(() => {
                          const mv = v as MultisigVersion;
                          return (
                            <>
                              <div>
                                <span className="text-gray-500">Threshold:</span>{" "}
                                <span className="font-medium">{mv.threshold}/{mv.signers.length}</span>
                              </div>
                              <div className="flex flex-wrap gap-1">
                                {mv.signers.map((s, j) => (
                                  <code key={j} className="text-xs bg-gray-100 dark:bg-gray-700 px-2 py-0.5 rounded font-mono truncate max-w-[160px]">
                                    {s.slice(0, 6)}...{s.slice(-4)}
                                  </code>
                                ))}
                              </div>
                            </>
                          );
                        })()}
                      </div>
                    )}

                    <div className="flex flex-wrap gap-3 text-xs text-gray-500">
                      <span>Changed: {formatTime((v as FeeVersion).changed_at || (v as MultisigVersion).changed_at)}</span>
                      <span>
                        By:{" "}
                        <code className="text-xs bg-gray-100 dark:bg-gray-700 px-1 rounded">
                          {"changed_by" in v && typeof v.changed_by === "string"
                            ? `${(v as { changed_by: string }).changed_by.slice(0, 8)}...`
                            : "(unknown)"}
                        </code>
                      </span>
                    </div>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
