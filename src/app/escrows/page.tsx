"use client";
// SPDX-License-Identifier: MIT

import Link from "next/link";
import { useState } from "react";
import { usePageTitle } from "@/hooks/usePageTitle";
import { PAGE_TITLES } from "@/lib/page-titles";
import { EmptyState } from "@/components/EmptyState";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { LoadingSkeleton } from "@/components/LoadingSkeleton";
import { useToast } from "@/components/ui/Toast";
import { useWallet } from "@/hooks/useMultiWallet";
import { useApiQuery, type ApiError } from "@/hooks/useApiQuery";
import { createEscrow } from "@/lib/contract-advanced";
import { XLM_STROOPS } from "@/lib/stellar";

interface EscrowSummary {
  id: number;
  beneficiary: string;
  amount: number;
  released: boolean;
  claimed: boolean;
}

async function fetchEscrow(id: number): Promise<EscrowSummary | null> {
  const res = await fetch(`/api/escrows?id=${id}`, { credentials: "same-origin" });
  if (!res.ok) return null;
  const json = await res.json();
  const e = json?.data;
  if (!e || typeof e.id === "undefined") return null;
  return {
    id: Number(e.id),
    beneficiary: String(e.beneficiary ?? ""),
    amount: Number(e.amount ?? 0),
    released: Boolean(e.released),
    claimed: Boolean(e.claimed),
  };
}

async function fetchRecentEscrows(limit = 20): Promise<EscrowSummary[]> {
  const countRes = await fetch("/api/escrows", { credentials: "same-origin" });
  if (!countRes.ok) return [];
  const countJson = await countRes.json();
  const total = Number(countJson?.data?.count ?? 0);
  if (!Number.isFinite(total) || total < 1) return [];
  const startId = Math.max(1, total - limit + 1);
  const out: EscrowSummary[] = [];
  for (let id = total; id >= startId; id--) {
    try {
      const row = await fetchEscrow(id);
      if (row) out.push(row);
    } catch {
      // Skip unreadable rows — the tail still renders.
    }
  }
  return out;
}

export default function EscrowsPage() {
  usePageTitle(PAGE_TITLES.ESCROWS);
  const toast = useToast();
  const { wallet } = useWallet();
  const [showCreate, setShowCreate] = useState(false);
  const [formBeneficiary, setFormBeneficiary] = useState("");
  const [formAmount, setFormAmount] = useState("");
  const [formAsset, setFormAsset] = useState("");
  const [formArbiter, setFormArbiter] = useState("");
  const [formDays, setFormDays] = useState("7");
  const [submitting, setSubmitting] = useState(false);

  const {
    data: escrows,
    isLoading: loading,
    refetch,
  } = useApiQuery<EscrowSummary[]>(["escrows"], "/api/escrows", undefined, fetchRecentEscrows);

  const handleCreate = async () => {
    if (!wallet.publicKey) {
      toast.error("Connect your wallet first");
      return;
    }
    const amountStroops = Math.round(parseFloat(formAmount) * XLM_STROOPS);
    if (!formBeneficiary || !Number.isFinite(amountStroops) || amountStroops <= 0 || !formAsset) {
      toast.error("Beneficiary, positive amount and asset are required");
      return;
    }
    const deadline = Math.floor(Date.now() / 1000) + Math.max(1, parseInt(formDays || "7", 10)) * 86400;
    setSubmitting(true);
    try {
      const result = await createEscrow({
        depositor: wallet.publicKey,
        beneficiary: formBeneficiary.trim(),
        arbiter: formArbiter.trim() || undefined,
        amount: amountStroops,
        asset: formAsset.trim(),
        deadline,
        metadata: "",
      });
      if (result.success) {
        toast.success("Escrow created on-chain");
        setShowCreate(false);
        setFormBeneficiary("");
        setFormAmount("");
        setFormAsset("");
        setFormArbiter("");
        refetch();
      } else {
        toast.error(result.error || "Failed to create escrow");
      }
    } catch (err: unknown) {
      const apiErr = err as ApiError;
      toast.error(apiErr.message || "Network error");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
            Escrows
          </h1>
          <p className="text-gray-500 dark:text-gray-400 mt-1">
            Time-locked payments with beneficiary claim and arbiter release
          </p>
        </div>
        <Button onClick={() => setShowCreate(true)}>+ New Escrow</Button>
      </div>

      {loading ? (
        <LoadingSkeleton lines={3} variant="card" />
      ) : !escrows || escrows.length === 0 ? (
        <EmptyState
          icon={<span className="text-2xl">🔒</span>}
          title="No Escrows Yet"
          description="Lock funds for a beneficiary with an optional arbiter and a claim deadline."
          actionLabel="Create Escrow"
          onAction={() => setShowCreate(true)}
        />
      ) : (
        <div className="space-y-3">
          {escrows.map((e) => (
            <Card key={e.id} className="p-4">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <Badge variant={e.released || e.claimed ? "success" : "info"}>
                      {e.claimed ? "Claimed" : e.released ? "Released" : "Locked"}
                    </Badge>
                    <span className="text-sm font-mono text-gray-600 dark:text-gray-400">
                      #{e.id}
                    </span>
                  </div>
                  <p className="text-lg font-semibold text-gray-900 dark:text-white">
                    {(Number(e.amount) / XLM_STROOPS).toLocaleString(undefined, {
                      maximumFractionDigits: 7,
                    })}{" "}
                    XLM
                  </p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    To: <code className="font-mono">{e.beneficiary?.slice(0, 12)}...</code>
                  </p>
                </div>
                <Link
                  href={`/escrows/${e.id}`}
                  className="text-sm font-medium text-ophir-600 dark:text-ophir-400 hover:underline"
                >
                  View details →
                </Link>
              </div>
            </Card>
          ))}
        </div>
      )}

      <Modal
        open={showCreate}
        onClose={() => setShowCreate(false)}
        title="Create Escrow"
        description="Lock XLM for a beneficiary until the deadline."
      >
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Beneficiary Address
            </label>
            <input
              value={formBeneficiary}
              onChange={(e) => setFormBeneficiary(e.target.value)}
              className="w-full px-3 py-2 border rounded-lg dark:bg-gray-800 dark:border-gray-700 font-mono text-xs"
              placeholder="GABC..."
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Amount (XLM)
              </label>
              <input
                type="number"
                min="0.0000001"
                step="0.0000001"
                value={formAmount}
                onChange={(e) => setFormAmount(e.target.value)}
                className="w-full px-3 py-2 border rounded-lg dark:bg-gray-800 dark:border-gray-700"
                placeholder="100.00"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Unlock in (days)
              </label>
              <input
                type="number"
                min="1"
                value={formDays}
                onChange={(e) => setFormDays(e.target.value)}
                className="w-full px-3 py-2 border rounded-lg dark:bg-gray-800 dark:border-gray-700"
                placeholder="7"
              />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Asset Contract Address
            </label>
            <input
              value={formAsset}
              onChange={(e) => setFormAsset(e.target.value)}
              className="w-full px-3 py-2 border rounded-lg dark:bg-gray-800 dark:border-gray-700 font-mono text-xs"
              placeholder="C..."
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Arbiter Address (optional)
            </label>
            <input
              value={formArbiter}
              onChange={(e) => setFormArbiter(e.target.value)}
              className="w-full px-3 py-2 border rounded-lg dark:bg-gray-800 dark:border-gray-700 font-mono text-xs"
              placeholder="GABC... (optional)"
            />
          </div>
          <Button onClick={handleCreate} loading={submitting} className="w-full">
            Create Escrow
          </Button>
        </div>
      </Modal>
    </div>
  );
}
