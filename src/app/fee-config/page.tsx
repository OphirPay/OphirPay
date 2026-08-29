"use client";
// SPDX-License-Identifier: MIT

import { useState } from "react";
import { usePageTitle } from "@/hooks/usePageTitle";
import { PAGE_TITLES } from "@/lib/page-titles";
import { useQueryClient } from "@tanstack/react-query";
import { EmptyState } from "@/components/EmptyState";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { CopyButton } from "@/components/ui/CopyButton";
import { ExplorerLink } from "@/components/ui/ExplorerLink";
import { useToast } from "@/components/ui/Toast";
import { useWallet } from "@/hooks/useMultiWallet";
import { useApiQuery } from "@/hooks/useApiQuery";
import { setFeeConfig, setFeeCollector, Role, type RoleValue } from "@/lib/contract-advanced";

export interface FeeConfigData {
  payment_fee_bps: number;
  escrow_fee_bps: number;
  stream_fee_bps: number;
  batch_base_fee: number | string;
  batch_per_item_fee: number | string;
  enabled: boolean;
}

export interface FeeCollectorData {
  collector: string | null;
  available?: boolean;
}

export interface FeeConfigVersionData {
  version: number;
  config?: FeeConfigData;
  payment_fee_bps?: number;
  escrow_fee_bps?: number;
  stream_fee_bps?: number;
  batch_base_fee?: number | string;
  batch_per_item_fee?: number | string;
  enabled?: boolean;
  changed_at?: number | string;
  changed_by?: string;
  updated_at?: number | string;
  updated_by?: string;
}

export interface TxResult {
  type: "success" | "error";
  title: string;
  message: string;
  txHash?: string;
  timestamp: number;
}

export const MAX_FEE_BPS = 1000; // 10.00% maximum fee capped by contract

export default function FeeConfigPage() {
  usePageTitle(PAGE_TITLES.FEE_CONFIG);
  const toast = useToast();
  const { wallet } = useWallet();
  const queryClient = useQueryClient();

  // Modal states
  const [showFeeModal, setShowFeeModal] = useState(false);
  const [showCollectorModal, setShowCollectorModal] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Form states
  const [formPaymentFee, setFormPaymentFee] = useState(10);
  const [formEscrowFee, setFormEscrowFee] = useState(5);
  const [formStreamFee, setFormStreamFee] = useState(2);
  const [formBatchBase, setFormBatchBase] = useState(0);
  const [formBatchPerItem, setFormBatchPerItem] = useState(0);
  const [formEnabled, setFormEnabled] = useState(true);
  const [formCollector, setFormCollector] = useState("");

  // Validation error states
  const [feeErrors, setFeeErrors] = useState<{
    payment?: string;
    escrow?: string;
    stream?: string;
    batchBase?: string;
    batchPerItem?: string;
  }>({});
  const [collectorError, setCollectorError] = useState<string | null>(null);

  // Transaction result banner state
  const [txResult, setTxResult] = useState<TxResult | null>(null);

  // 1. Fetch current on-chain fee config
  const {
    data: rawConfig,
    isLoading: loadingConfig,
    refetch: refetchConfig,
  } = useApiQuery<FeeConfigData>(["fee-config"], "/api/fee-config");
  const config =
    rawConfig && typeof rawConfig === "object" && "payment_fee_bps" in rawConfig
      ? rawConfig
      : null;

  // 2. Fetch current on-chain fee collector
  const {
    data: rawCollectorData,
    isLoading: loadingCollector,
    refetch: refetchCollector,
  } = useApiQuery<FeeCollectorData>(
    ["fee-collector"],
    "/api/fee-config/collector"
  );
  const collector = rawCollectorData?.collector ?? null;

  // 3. Fetch on-chain fee version history
  const {
    data: rawHistory,
  } = useApiQuery<FeeConfigVersionData[]>(
    ["fee-config-history"],
    "/api/fee-config/history"
  );
  const history: FeeConfigVersionData[] = Array.isArray(rawHistory)
    ? rawHistory
    : [];

  // 4. Fetch connected user role
  const { data: ownRole } = useApiQuery<{
    address: string;
    role: RoleValue | null;
  }>(
    ["rbac", wallet.publicKey ?? "none"],
    wallet.publicKey
      ? `/api/rbac?addr=${encodeURIComponent(wallet.publicKey)}`
      : undefined,
    { enabled: !!wallet.publicKey }
  );
  const isAdmin = ownRole?.role === Role.Admin;

  // Helpers
  const bpsToPercent = (bps: number) => (bps / 100).toFixed(2);
  const stroopsToXlm = (stroops: number | string) =>
    (Number(stroops || 0) / 10_000_000).toLocaleString(undefined, {
      maximumFractionDigits: 7,
    });

  const openFeeModal = () => {
    if (config) {
      setFormPaymentFee(Number(config.payment_fee_bps) || 0);
      setFormEscrowFee(Number(config.escrow_fee_bps) || 0);
      setFormStreamFee(Number(config.stream_fee_bps) || 0);
      setFormBatchBase(Number(config.batch_base_fee) || 0);
      setFormBatchPerItem(Number(config.batch_per_item_fee) || 0);
      setFormEnabled(config.enabled ?? true);
    } else {
      setFormPaymentFee(10);
      setFormEscrowFee(5);
      setFormStreamFee(2);
      setFormBatchBase(0);
      setFormBatchPerItem(0);
      setFormEnabled(true);
    }
    setFeeErrors({});
    setShowFeeModal(true);
  };

  const openCollectorModal = () => {
    setFormCollector(collector || "");
    setCollectorError(null);
    setShowCollectorModal(true);
  };

  const validateFeeForm = (): boolean => {
    const errors: typeof feeErrors = {};

    if (
      isNaN(formPaymentFee) ||
      formPaymentFee < 0 ||
      formPaymentFee > MAX_FEE_BPS ||
      !Number.isInteger(formPaymentFee)
    ) {
      errors.payment = `Payment fee must be an integer between 0 and ${MAX_FEE_BPS} bps (≤ 10%).`;
    }
    if (
      isNaN(formEscrowFee) ||
      formEscrowFee < 0 ||
      formEscrowFee > MAX_FEE_BPS ||
      !Number.isInteger(formEscrowFee)
    ) {
      errors.escrow = `Escrow fee must be an integer between 0 and ${MAX_FEE_BPS} bps (≤ 10%).`;
    }
    if (
      isNaN(formStreamFee) ||
      formStreamFee < 0 ||
      formStreamFee > MAX_FEE_BPS ||
      !Number.isInteger(formStreamFee)
    ) {
      errors.stream = `Stream fee must be an integer between 0 and ${MAX_FEE_BPS} bps (≤ 10%).`;
    }
    if (
      isNaN(formBatchBase) ||
      formBatchBase < 0 ||
      !Number.isInteger(formBatchBase)
    ) {
      errors.batchBase = "Batch base fee must be a non-negative integer (stroops).";
    }
    if (
      isNaN(formBatchPerItem) ||
      formBatchPerItem < 0 ||
      !Number.isInteger(formBatchPerItem)
    ) {
      errors.batchPerItem =
        "Batch per-item fee must be a non-negative integer (stroops).";
    }

    setFeeErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const validateCollectorForm = (): boolean => {
    const trimmed = formCollector.trim();
    if (!trimmed) {
      setCollectorError("Collector address is required.");
      return false;
    }
    if (
      (!trimmed.startsWith("G") && !trimmed.startsWith("C")) ||
      trimmed.length !== 56
    ) {
      setCollectorError(
        "Invalid Stellar address. Must be a 56-character public key (G...) or contract address (C...)."
      );
      return false;
    }
    setCollectorError(null);
    return true;
  };

  const handleFeeSubmit = async () => {
    if (!wallet.publicKey) {
      toast.error("Connect your wallet first");
      return;
    }

    if (!validateFeeForm()) {
      toast.error(
        "Validation error: fee basis points must be between 0 and 1000 bps (≤ 10%)."
      );
      return;
    }

    setSubmitting(true);
    try {
      const result = await setFeeConfig(
        wallet.publicKey,
        formPaymentFee,
        formEscrowFee,
        formStreamFee,
        formBatchBase,
        formBatchPerItem,
        formEnabled
      );

      if (result.success) {
        toast.success("Fee configuration saved on-chain");
        setShowFeeModal(false);
        setTxResult({
          type: "success",
          title: "Fee Configuration Saved On-Chain",
          message: `Updated fees: Payment ${bpsToPercent(formPaymentFee)}%, Escrow ${bpsToPercent(formEscrowFee)}%, Stream ${bpsToPercent(formStreamFee)}%, Status: ${formEnabled ? "Active" : "Disabled"}.`,
          txHash: result.txHash,
          timestamp: Date.now(),
        });
        queryClient.invalidateQueries({ queryKey: ["fee-config"] });
        queryClient.invalidateQueries({ queryKey: ["fee-config-history"] });
      } else {
        const errMsg = result.error || "Failed to update fee config on-chain";
        toast.error(errMsg);
        setTxResult({
          type: "error",
          title: "Fee Configuration Update Failed",
          message: errMsg,
          timestamp: Date.now(),
        });
      }
    } catch {
      const netErr = "Network error while submitting fee configuration";
      toast.error(netErr);
      setTxResult({
        type: "error",
        title: "Transaction Error",
        message: netErr,
        timestamp: Date.now(),
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleCollectorSubmit = async () => {
    if (!wallet.publicKey) {
      toast.error("Connect your wallet first");
      return;
    }

    if (!validateCollectorForm()) {
      toast.error("Invalid collector address format");
      return;
    }

    const trimmed = formCollector.trim();
    setSubmitting(true);
    try {
      const result = await setFeeCollector(wallet.publicKey, trimmed);
      if (result.success) {
        toast.success("Fee collector updated on-chain");
        setShowCollectorModal(false);
        setTxResult({
          type: "success",
          title: "Fee Collector Updated On-Chain",
          message: `Fee collector destination set to ${trimmed}.`,
          txHash: result.txHash,
          timestamp: Date.now(),
        });
        queryClient.invalidateQueries({ queryKey: ["fee-collector"] });
        queryClient.invalidateQueries({ queryKey: ["fee-config-history"] });
      } else {
        const errMsg = result.error || "Failed to update collector on-chain";
        toast.error(errMsg);
        setTxResult({
          type: "error",
          title: "Collector Update Failed",
          message: errMsg,
          timestamp: Date.now(),
        });
      }
    } catch {
      const netErr = "Network error while updating fee collector";
      toast.error(netErr);
      setTxResult({
        type: "error",
        title: "Transaction Error",
        message: netErr,
        timestamp: Date.now(),
      });
    } finally {
      setSubmitting(false);
    }
  };

  const loading = loadingConfig || loadingCollector;

  if (loading) {
    return (
      <div className="animate-fade-in space-y-6">
        <div className="h-8 w-48 bg-gray-200 dark:bg-gray-700 rounded animate-pulse" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div
              key={i}
              className="h-28 bg-gray-100 dark:bg-gray-800 rounded-xl animate-pulse"
            />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Wallet Connection Status Alert */}
      {!wallet.connected && (
        <div
          data-testid="wallet-disconnected-alert"
          className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-lg p-4 flex items-center gap-3 animate-fade-in"
        >
          <span className="text-amber-500 text-lg">⚠️</span>
          <div>
            <p className="text-sm font-medium text-amber-800 dark:text-amber-200">
              Wallet not connected
            </p>
            <p className="text-xs text-amber-600 dark:text-amber-400">
              Connect an admin wallet to update fee configuration on-chain.
            </p>
          </div>
        </div>
      )}

      {/* Admin Role Status Alert */}
      {wallet.connected && !isAdmin && ownRole && (
        <div
          data-testid="non-admin-alert"
          className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-700 rounded-lg p-4 flex items-center gap-3 animate-fade-in"
        >
          <span className="text-blue-500 text-lg">ℹ️</span>
          <div>
            <p className="text-sm font-medium text-blue-800 dark:text-blue-200">
              Admin permissions required
            </p>
            <p className="text-xs text-blue-600 dark:text-blue-400">
              Contract fee entrypoints (`set_fee_config`, `set_fee_collector`) require Owner/Admin authorization.
            </p>
          </div>
        </div>
      )}

      {/* Transaction Result Banner */}
      {txResult && (
        <div
          data-testid="tx-result-banner"
          className={`border rounded-lg p-4 flex flex-col gap-2 animate-fade-in transition-all ${
            txResult.type === "success"
              ? "bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800"
              : "bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800"
          }`}
        >
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-2">
              <Badge variant={txResult.type === "success" ? "success" : "danger"}>
                {txResult.type === "success" ? "Transaction Confirmed" : "Transaction Failed"}
              </Badge>
              <h3
                className={`text-sm font-semibold ${
                  txResult.type === "success"
                    ? "text-green-800 dark:text-green-200"
                    : "text-red-800 dark:text-red-200"
                }`}
              >
                {txResult.title}
              </h3>
            </div>
            <button
              onClick={() => setTxResult(null)}
              className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-sm font-bold"
              aria-label="Dismiss transaction result"
            >
              ✕
            </button>
          </div>
          <p
            className={`text-xs ${
              txResult.type === "success"
                ? "text-green-700 dark:text-green-300"
                : "text-red-700 dark:text-red-300"
            }`}
          >
            {txResult.message}
          </p>
          {txResult.txHash && (
            <div className="flex items-center gap-2 mt-1 pt-2 border-t border-green-200 dark:border-green-800/40">
              <span className="text-xs text-gray-500 dark:text-gray-400 font-mono">
                Tx Hash:
              </span>
              <ExplorerLink value={txResult.txHash} kind="tx" shorten={true} />
              <CopyButton value={txResult.txHash} label="Copy Hash" />
            </div>
          )}
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
              Fee Configuration
            </h1>
            {wallet.connected && (
              <Badge variant={isAdmin ? "success" : "info"}>
                {isAdmin ? "Admin Authorized" : "Connected"}
              </Badge>
            )}
          </div>
          <p className="text-gray-500 dark:text-gray-400 mt-1">
            Set and inspect protocol fees for payments, escrows, streams, and batch payments on Soroban
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            onClick={() => {
              refetchConfig();
              refetchCollector();
            }}
            variant="ghost"
            title="Refresh on-chain values"
          >
            🔄 Refresh
          </Button>
          <Button
            data-testid="edit-fees-btn"
            onClick={openFeeModal}
            variant="primary"
          >
            ⚙ Edit Fees
          </Button>
          <Button
            data-testid="set-collector-btn"
            onClick={openCollectorModal}
            variant="secondary"
          >
            💰 Set Collector
          </Button>
        </div>
      </div>

      {/* Current On-Chain Fee Config Cards */}
      {!config ? (
        <EmptyState
          icon={
            <svg
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={1.5}
              stroke="currentColor"
              className="w-8 h-8 text-gray-400"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 6v12m-3-2.818l.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
          }
          title="No Fee Config Set"
          description="Configure your protocol fee structure on-chain (max 1000 bps = 10%)."
          actionLabel="Set Fees"
          onAction={openFeeModal}
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Card className="p-4 hover:shadow-md transition-shadow">
            <p className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide font-medium">
              Payment Fee
            </p>
            <p
              data-testid="payment-fee-value"
              className="text-2xl font-bold text-gray-900 dark:text-white mt-1"
            >
              {bpsToPercent(config.payment_fee_bps)}%
            </p>
            <p className="text-xs text-gray-400 mt-1">
              {config.payment_fee_bps} bps (capped ≤ 1000)
            </p>
          </Card>
          <Card className="p-4 hover:shadow-md transition-shadow">
            <p className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide font-medium">
              Escrow Fee
            </p>
            <p
              data-testid="escrow-fee-value"
              className="text-2xl font-bold text-gray-900 dark:text-white mt-1"
            >
              {bpsToPercent(config.escrow_fee_bps)}%
            </p>
            <p className="text-xs text-gray-400 mt-1">
              {config.escrow_fee_bps} bps (capped ≤ 1000)
            </p>
          </Card>
          <Card className="p-4 hover:shadow-md transition-shadow">
            <p className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide font-medium">
              Stream Fee
            </p>
            <p
              data-testid="stream-fee-value"
              className="text-2xl font-bold text-gray-900 dark:text-white mt-1"
            >
              {bpsToPercent(config.stream_fee_bps)}%
            </p>
            <p className="text-xs text-gray-400 mt-1">
              {config.stream_fee_bps} bps (capped ≤ 1000)
            </p>
          </Card>
          <Card className="p-4 hover:shadow-md transition-shadow">
            <p className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide font-medium">
              Batch Base Fee
            </p>
            <p
              data-testid="batch-base-fee-value"
              className="text-2xl font-bold text-gray-900 dark:text-white mt-1"
            >
              {stroopsToXlm(config.batch_base_fee)} XLM
            </p>
            <p className="text-xs text-gray-400 mt-1">
              {Number(config.batch_base_fee || 0).toLocaleString()} stroops
            </p>
          </Card>
          <Card className="p-4 hover:shadow-md transition-shadow">
            <p className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide font-medium">
              Per-Item Batch Fee
            </p>
            <p
              data-testid="batch-per-item-fee-value"
              className="text-2xl font-bold text-gray-900 dark:text-white mt-1"
            >
              {stroopsToXlm(config.batch_per_item_fee)} XLM
            </p>
            <p className="text-xs text-gray-400 mt-1">
              {Number(config.batch_per_item_fee || 0).toLocaleString()} stroops
            </p>
          </Card>
          <Card className="p-4 hover:shadow-md transition-shadow">
            <p className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide font-medium">
              Fee Collection Status
            </p>
            <div className="mt-2">
              <Badge variant={config.enabled ? "success" : "warning"}>
                {config.enabled ? "Active" : "Disabled"}
              </Badge>
            </div>
            <p className="text-xs text-gray-400 mt-2">
              {config.enabled
                ? "Contract automatically collects protocol fees"
                : "Protocol fee collection currently suspended"}
            </p>
          </Card>
        </div>
      )}

      {/* Fee Collector Card */}
      <Card className="p-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div>
            <p className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide font-medium">
              On-Chain Fee Collector Destination
            </p>
            {collector ? (
              <div
                data-testid="fee-collector-address"
                className="flex items-center gap-2 mt-1.5"
              >
                <code className="text-sm font-mono text-gray-800 dark:text-gray-200">
                  {collector}
                </code>
                <CopyButton value={collector} label="Copy" />
                <ExplorerLink value={collector} kind="account" shorten={false} />
              </div>
            ) : (
              <p
                data-testid="no-collector-notice"
                className="text-sm text-gray-400 dark:text-gray-500 italic mt-1"
              >
                No fee collector configured (fees accumulate in contract).
              </p>
            )}
          </div>
          <Button
            onClick={openCollectorModal}
            variant="secondary"
            className="text-xs self-start sm:self-auto"
          >
            {collector ? "Change Collector" : "Set Collector"}
          </Button>
        </div>
      </Card>

      {/* Version History */}
      {history.length > 0 && (
        <Card className="p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white uppercase tracking-wider">
              Fee Configuration Version History
            </h3>
            <span className="text-xs text-gray-400">
              {history.length} {history.length === 1 ? "version" : "versions"} recorded on-chain
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-gray-600 dark:text-gray-300">
              <thead className="border-b border-gray-200 dark:border-gray-700 text-gray-400 uppercase font-semibold">
                <tr>
                  <th className="py-2 px-3">Version</th>
                  <th className="py-2 px-3">Payment Fee</th>
                  <th className="py-2 px-3">Escrow Fee</th>
                  <th className="py-2 px-3">Stream Fee</th>
                  <th className="py-2 px-3">Batch Fees</th>
                  <th className="py-2 px-3">Status</th>
                  <th className="py-2 px-3">Changed By</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {history.map((ver, idx) => {
                  const cfg = ver.config || ver;
                  const paymentBps = Number(cfg.payment_fee_bps) || 0;
                  const escrowBps = Number(cfg.escrow_fee_bps) || 0;
                  const streamBps = Number(cfg.stream_fee_bps) || 0;
                  const isEnabled = cfg.enabled ?? true;
                  const changedBy = ver.changed_by || ver.updated_by || "Unknown";

                  return (
                    <tr
                      key={ver.version || idx}
                      className="hover:bg-gray-50 dark:hover:bg-gray-800/50"
                    >
                      <td className="py-2 px-3 font-semibold text-gray-900 dark:text-white">
                        v{ver.version || idx + 1}
                      </td>
                      <td className="py-2 px-3">
                        {bpsToPercent(paymentBps)}% ({paymentBps} bps)
                      </td>
                      <td className="py-2 px-3">
                        {bpsToPercent(escrowBps)}% ({escrowBps} bps)
                      </td>
                      <td className="py-2 px-3">
                        {bpsToPercent(streamBps)}% ({streamBps} bps)
                      </td>
                      <td className="py-2 px-3">
                        {stroopsToXlm(cfg.batch_base_fee || 0)} / {stroopsToXlm(cfg.batch_per_item_fee || 0)} XLM
                      </td>
                      <td className="py-2 px-3">
                        <Badge variant={isEnabled ? "success" : "warning"}>
                          {isEnabled ? "Active" : "Disabled"}
                        </Badge>
                      </td>
                      <td className="py-2 px-3 font-mono">
                        {changedBy.startsWith("G") || changedBy.startsWith("C") ? (
                          <ExplorerLink value={changedBy} kind="account" shorten={true} />
                        ) : (
                          changedBy
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Edit Fees Modal */}
      <Modal
        open={showFeeModal}
        onClose={() => setShowFeeModal(false)}
        title="Configure Protocol Fees"
        description="Admin/Owner only. Basis points capped at 1000 bps (10.00%)."
      >
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Payment Fee (bps)
              </label>
              <input
                data-testid="input-payment-fee"
                type="number"
                min={0}
                max={MAX_FEE_BPS}
                value={formPaymentFee}
                onChange={(e) => {
                  setFormPaymentFee(Number(e.target.value));
                  if (feeErrors.payment) setFeeErrors((p) => ({ ...p, payment: undefined }));
                }}
                className={`w-full px-3 py-2 border rounded-lg dark:bg-gray-800 dark:border-gray-700 text-gray-900 dark:text-white ${
                  feeErrors.payment ? "border-red-500 dark:border-red-500" : ""
                }`}
              />
              <div className="flex justify-between text-xs text-gray-400 mt-1">
                <span>{bpsToPercent(formPaymentFee)}%</span>
                <span>Max 1000 bps</span>
              </div>
              {feeErrors.payment && (
                <p className="text-xs text-red-500 mt-1">{feeErrors.payment}</p>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Escrow Fee (bps)
              </label>
              <input
                data-testid="input-escrow-fee"
                type="number"
                min={0}
                max={MAX_FEE_BPS}
                value={formEscrowFee}
                onChange={(e) => {
                  setFormEscrowFee(Number(e.target.value));
                  if (feeErrors.escrow) setFeeErrors((p) => ({ ...p, escrow: undefined }));
                }}
                className={`w-full px-3 py-2 border rounded-lg dark:bg-gray-800 dark:border-gray-700 text-gray-900 dark:text-white ${
                  feeErrors.escrow ? "border-red-500 dark:border-red-500" : ""
                }`}
              />
              <div className="flex justify-between text-xs text-gray-400 mt-1">
                <span>{bpsToPercent(formEscrowFee)}%</span>
                <span>Max 1000 bps</span>
              </div>
              {feeErrors.escrow && (
                <p className="text-xs text-red-500 mt-1">{feeErrors.escrow}</p>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Stream Fee (bps)
              </label>
              <input
                data-testid="input-stream-fee"
                type="number"
                min={0}
                max={MAX_FEE_BPS}
                value={formStreamFee}
                onChange={(e) => {
                  setFormStreamFee(Number(e.target.value));
                  if (feeErrors.stream) setFeeErrors((p) => ({ ...p, stream: undefined }));
                }}
                className={`w-full px-3 py-2 border rounded-lg dark:bg-gray-800 dark:border-gray-700 text-gray-900 dark:text-white ${
                  feeErrors.stream ? "border-red-500 dark:border-red-500" : ""
                }`}
              />
              <div className="flex justify-between text-xs text-gray-400 mt-1">
                <span>{bpsToPercent(formStreamFee)}%</span>
                <span>Max 1000 bps</span>
              </div>
              {feeErrors.stream && (
                <p className="text-xs text-red-500 mt-1">{feeErrors.stream}</p>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Batch Base Fee (stroops)
              </label>
              <input
                data-testid="input-batch-base-fee"
                type="number"
                min={0}
                value={formBatchBase}
                onChange={(e) => {
                  setFormBatchBase(Number(e.target.value));
                  if (feeErrors.batchBase) setFeeErrors((p) => ({ ...p, batchBase: undefined }));
                }}
                className={`w-full px-3 py-2 border rounded-lg dark:bg-gray-800 dark:border-gray-700 text-gray-900 dark:text-white ${
                  feeErrors.batchBase ? "border-red-500 dark:border-red-500" : ""
                }`}
              />
              <span className="text-xs text-gray-400 mt-1 block">
                {stroopsToXlm(formBatchBase)} XLM
              </span>
              {feeErrors.batchBase && (
                <p className="text-xs text-red-500 mt-1">{feeErrors.batchBase}</p>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Per-Item Batch Fee (stroops)
              </label>
              <input
                data-testid="input-batch-item-fee"
                type="number"
                min={0}
                value={formBatchPerItem}
                onChange={(e) => {
                  setFormBatchPerItem(Number(e.target.value));
                  if (feeErrors.batchPerItem) setFeeErrors((p) => ({ ...p, batchPerItem: undefined }));
                }}
                className={`w-full px-3 py-2 border rounded-lg dark:bg-gray-800 dark:border-gray-700 text-gray-900 dark:text-white ${
                  feeErrors.batchPerItem ? "border-red-500 dark:border-red-500" : ""
                }`}
              />
              <span className="text-xs text-gray-400 mt-1 block">
                {stroopsToXlm(formBatchPerItem)} XLM
              </span>
              {feeErrors.batchPerItem && (
                <p className="text-xs text-red-500 mt-1">{feeErrors.batchPerItem}</p>
              )}
            </div>
          </div>

          <label className="flex items-center gap-2 cursor-pointer pt-1">
            <input
              data-testid="checkbox-fee-enabled"
              type="checkbox"
              checked={formEnabled}
              onChange={(e) => setFormEnabled(e.target.checked)}
              className="w-4 h-4 rounded text-ophir-600 focus:ring-ophir-500"
            />
            <span className="text-sm text-gray-700 dark:text-gray-300">
              Enable protocol fee collection
            </span>
          </label>

          <Button
            data-testid="submit-fee-config-btn"
            onClick={handleFeeSubmit}
            loading={submitting}
            className="w-full"
          >
            Save Fee Configuration On-Chain
          </Button>
        </div>
      </Modal>

      {/* Set Collector Modal */}
      <Modal
        open={showCollectorModal}
        onClose={() => setShowCollectorModal(false)}
        title="Set Protocol Fee Collector"
        description="Owner only. Address that receives all collected protocol fees."
      >
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Collector Stellar Public Key / Contract ID
            </label>
            <input
              data-testid="input-collector-address"
              value={formCollector}
              onChange={(e) => {
                setFormCollector(e.target.value);
                if (collectorError) setCollectorError(null);
              }}
              className={`w-full px-3 py-2 border rounded-lg dark:bg-gray-800 dark:border-gray-700 font-mono text-xs text-gray-900 dark:text-white ${
                collectorError ? "border-red-500 dark:border-red-500" : ""
              }`}
              placeholder="GABC... or CABC... (56 characters)"
            />
            {collectorError && (
              <p className="text-xs text-red-500 mt-1">{collectorError}</p>
            )}
          </div>
          <Button
            data-testid="submit-collector-btn"
            onClick={handleCollectorSubmit}
            loading={submitting}
            className="w-full"
          >
            Set Fee Collector On-Chain
          </Button>
        </div>
      </Modal>
    </div>
  );
}
