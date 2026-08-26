"use client";
// SPDX-License-Identifier: MIT

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { EmptyState } from "@/components/EmptyState";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { useToast } from "@/components/ui/Toast";
import { useWallet } from "@/hooks/useMultiWallet";
import { useApiQuery } from "@/hooks/useApiQuery";
import { setFeeConfig, setFeeCollector } from "@/lib/contract-advanced";

interface FeeConfigData {
  payment_fee_bps: number;
  escrow_fee_bps: number;
  stream_fee_bps: number;
  batch_base_fee: number;
  batch_per_item_fee: number;
  enabled: boolean;
}

export default function FeeConfigPage() {
  const toast = useToast();
  const { wallet } = useWallet();
  const queryClient = useQueryClient();
  const [collector, setCollector] = useState<string | null>(null);
  const [showFeeModal, setShowFeeModal] = useState(false);
  const [showCollectorModal, setShowCollectorModal] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [formPaymentFee, setFormPaymentFee] = useState(10);
  const [formEscrowFee, setFormEscrowFee] = useState(5);
  const [formStreamFee, setFormStreamFee] = useState(2);
  const [formBatchBase, setFormBatchBase] = useState(0);
  const [formBatchPerItem, setFormBatchPerItem] = useState(0);
  const [formEnabled, setFormEnabled] = useState(true);
  const [formCollector, setFormCollector] = useState("");

  const {
    data: rawConfig,
    isLoading: loading,
  } = useApiQuery<FeeConfigData>(["fee-config"], "/api/fee-config");
  const config = rawConfig && typeof rawConfig === "object" && "payment_fee_bps" in rawConfig
    ? rawConfig
    : null;

  const handleFeeSubmit = async () => {
    if (!wallet.publicKey) { toast.error("Connect your wallet first"); return; }
    setSubmitting(true);
    try {
      const result = await setFeeConfig(
        wallet.publicKey,
        formPaymentFee, formEscrowFee, formStreamFee,
        formBatchBase, formBatchPerItem, formEnabled,
      );
      if (result.success) {
        toast.success("Fee configuration saved on-chain");
        setShowFeeModal(false);
        queryClient.invalidateQueries({ queryKey: ["fee-config"] });
      } else {
        toast.error(result.error || "Failed to update fee config");
      }
    } catch {
      toast.error("Network error");
    } finally {
      setSubmitting(false);
    }
  };

  const handleCollectorSubmit = async () => {
    if (!wallet.publicKey) { toast.error("Connect your wallet first"); return; }
    setSubmitting(true);
    try {
      const result = await setFeeCollector(wallet.publicKey, formCollector);
      if (result.success) {
        toast.success("Fee collector updated on-chain");
        setShowCollectorModal(false);
        setCollector(formCollector);
      } else {
        toast.error(result.error || "Failed to update collector");
      }
    } catch {
      toast.error("Network error");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="animate-fade-in space-y-6">
        <div className="h-8 w-48 bg-gray-200 dark:bg-gray-700 rounded animate-pulse" />
        <div className="h-40 bg-gray-100 dark:bg-gray-800 rounded animate-pulse" />
      </div>
    );
  }

  const bpsToPercent = (bps: number) => (bps / 100).toFixed(2);

  return (
    <div className="space-y-6 animate-fade-in">
      {!wallet.connected && (
        <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-lg p-4 flex items-center gap-3 animate-fade-in">
          <span className="text-amber-500 text-lg">⚠️</span>
          <div>
            <p className="text-sm font-medium text-amber-800 dark:text-amber-200">Wallet not connected</p>
            <p className="text-xs text-amber-600 dark:text-amber-400">
              Connect your wallet to update fee configuration on-chain.
            </p>
          </div>
        </div>
      )}

      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Fee Configuration</h1>
          <p className="text-gray-500 dark:text-gray-400 mt-1">
            Set protocol fees for payments, escrows, streams, and batches
          </p>
        </div>
        <div className="flex gap-2">
          <Button onClick={() => setShowFeeModal(true)} variant="primary">
            ⚙ Edit Fees
          </Button>
          <Button onClick={() => setShowCollectorModal(true)} variant="secondary">
            💰 Set Collector
          </Button>
        </div>
      </div>

      {/* Current Config */}
      {!config ? (
        <EmptyState
          icon={
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-8 h-8 text-gray-400">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v12m-3-2.818l.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          }
          title="No Fee Config Set"
          description="Configure your protocol fee structure on-chain."
          actionLabel="Set Fees"
          onAction={() => setShowFeeModal(true)}
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Card className="p-4 hover:shadow-md transition-shadow">
            <p className="text-xs text-gray-500 uppercase tracking-wide">Payment Fee</p>
            <p className="text-2xl font-bold text-gray-900 dark:text-white mt-1">{bpsToPercent(config.payment_fee_bps)}%</p>
            <p className="text-xs text-gray-400 mt-1">{config.payment_fee_bps} bps</p>
          </Card>
          <Card className="p-4 hover:shadow-md transition-shadow">
            <p className="text-xs text-gray-500 uppercase tracking-wide">Escrow Fee</p>
            <p className="text-2xl font-bold text-gray-900 dark:text-white mt-1">{bpsToPercent(config.escrow_fee_bps)}%</p>
            <p className="text-xs text-gray-400 mt-1">{config.escrow_fee_bps} bps</p>
          </Card>
          <Card className="p-4 hover:shadow-md transition-shadow">
            <p className="text-xs text-gray-500 uppercase tracking-wide">Stream Fee</p>
            <p className="text-2xl font-bold text-gray-900 dark:text-white mt-1">{bpsToPercent(config.stream_fee_bps)}%</p>
            <p className="text-xs text-gray-400 mt-1">{config.stream_fee_bps} bps</p>
          </Card>
          <Card className="p-4 hover:shadow-md transition-shadow">
            <p className="text-xs text-gray-500 uppercase tracking-wide">Batch Base</p>
            <p className="text-2xl font-bold text-gray-900 dark:text-white mt-1">{Number(config.batch_base_fee) / 10_000_000} XLM</p>
          </Card>
          <Card className="p-4 hover:shadow-md transition-shadow">
            <p className="text-xs text-gray-500 uppercase tracking-wide">Per-Item Fee</p>
            <p className="text-2xl font-bold text-gray-900 dark:text-white mt-1">{Number(config.batch_per_item_fee) / 10_000_000} XLM</p>
          </Card>
          <Card className="p-4 hover:shadow-md transition-shadow">
            <p className="text-xs text-gray-500 uppercase tracking-wide">Status</p>
            <div className="mt-1">
              <Badge variant={config.enabled ? "success" : "warning"}>
                {config.enabled ? "Active" : "Disabled"}
              </Badge>
            </div>
          </Card>
        </div>
      )}

      {/* Collector Address */}
      {collector && (
        <Card className="p-4">
          <p className="text-xs text-gray-500 uppercase tracking-wide">Fee Collector</p>
          <code className="text-sm font-mono text-gray-700 dark:text-gray-300 block mt-1 truncate">{collector}</code>
        </Card>
      )}

      {/* Edit Fees Modal */}
      <Modal
        open={showFeeModal}
        onClose={() => setShowFeeModal(false)}
        title="Configure Protocol Fees"
        description="Owner only. Fees capped at 10% (1000 bps)."
      >
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Payment Fee (bps)</label>
              <input type="number" min={0} max={1000} value={formPaymentFee}
                onChange={(e) => setFormPaymentFee(Number(e.target.value))}
                className="w-full px-3 py-2 border rounded-lg dark:bg-gray-800 dark:border-gray-700" />
              <span className="text-xs text-gray-400">{bpsToPercent(formPaymentFee)}%</span>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Escrow Fee (bps)</label>
              <input type="number" min={0} max={1000} value={formEscrowFee}
                onChange={(e) => setFormEscrowFee(Number(e.target.value))}
                className="w-full px-3 py-2 border rounded-lg dark:bg-gray-800 dark:border-gray-700" />
              <span className="text-xs text-gray-400">{bpsToPercent(formEscrowFee)}%</span>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Stream Fee (bps)</label>
              <input type="number" min={0} max={1000} value={formStreamFee}
                onChange={(e) => setFormStreamFee(Number(e.target.value))}
                className="w-full px-3 py-2 border rounded-lg dark:bg-gray-800 dark:border-gray-700" />
              <span className="text-xs text-gray-400">{bpsToPercent(formStreamFee)}%</span>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Batch Base Fee (stroops)</label>
              <input type="number" min={0} value={formBatchBase}
                onChange={(e) => setFormBatchBase(Number(e.target.value))}
                className="w-full px-3 py-2 border rounded-lg dark:bg-gray-800 dark:border-gray-700" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Per-Item Fee (stroops)</label>
              <input type="number" min={0} value={formBatchPerItem}
                onChange={(e) => setFormBatchPerItem(Number(e.target.value))}
                className="w-full px-3 py-2 border rounded-lg dark:bg-gray-800 dark:border-gray-700" />
            </div>
          </div>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={formEnabled} onChange={(e) => setFormEnabled(e.target.checked)} />
            <span className="text-sm text-gray-700 dark:text-gray-300">Enable fee collection</span>
          </label>
          <Button onClick={handleFeeSubmit} loading={submitting} className="w-full">
            Save Fee Configuration
          </Button>
        </div>
      </Modal>

      {/* Set Collector Modal */}
      <Modal
        open={showCollectorModal}
        onClose={() => setShowCollectorModal(false)}
        title="Set Fee Collector"
        description="Address that receives collected protocol fees. Owner only."
      >
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Collector Address</label>
            <input value={formCollector}
              onChange={(e) => setFormCollector(e.target.value)}
              className="w-full px-3 py-2 border rounded-lg dark:bg-gray-800 dark:border-gray-700 font-mono text-xs"
              placeholder="GABC..." />
          </div>
          <Button onClick={handleCollectorSubmit} loading={submitting} className="w-full">
            Set Fee Collector
          </Button>
        </div>
      </Modal>
    </div>
  );
}
