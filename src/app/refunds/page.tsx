"use client";
// SPDX-License-Identifier: MIT


import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { EmptyState } from "@/components/EmptyState";
import { LoadingSkeleton } from "@/components/LoadingSkeleton";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { useToast } from "@/components/ui/Toast";
import { useWallet } from "@/hooks/useMultiWallet";
import { useApiQuery, apiFetch } from "@/hooks/useApiQuery";
import { isOnChainId } from "@/lib/type-guards";
import { requestRefund, approveRefund, processRefund } from "@/lib/contract-advanced";

const REASON_CODES = [
  { value: 0, label: "Product Defect" },
  { value: 1, label: "Non-Delivery" },
  { value: 2, label: "Duplicate Charge" },
  { value: 3, label: "Unauthorized" },
  { value: 4, label: "Customer Request" },
  { value: 5, label: "Other" },
] as const;

// RefundStatus enum values as returned by the API (Prisma enum, uppercase)
const STATUS_COLORS: Record<string, ReturnType<typeof Badge>["props"]["variant"]> = {
  REQUESTED: "warning",
  APPROVED: "info",
  REJECTED: "danger",
  PROCESSED: "success",
};

interface Refund {
  id: string;
  paymentId: string;
  userId: string;
  amount: string;
  asset: string;
  reason: string;
  reasonCode: number;
  status: string;
  requestedAt: string;
  resolvedAt: string | null;
  /** Contract u64 refund id returned by request_refund, if linked. */
  onChainId: number | null;
}

interface RefundAnalytics {
  code: number;
  count: number;
}

export default function RefundsPage() {
  const { wallet } = useWallet();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [showRequest, setShowRequest] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [activeTab, setActiveTab] = useState<"list" | "analytics">("list");

  const [formPaymentId, setFormPaymentId] = useState("");
  const [formAmount, setFormAmount] = useState("");
  const [formAsset, setFormAsset] = useState("");
  const [formReason, setFormReason] = useState("");
  const [formReasonCode, setFormReasonCode] = useState(0);

  const {
    data: rawRefunds,
    isLoading: loading,
  } = useApiQuery<Refund[]>(["refunds"], "/api/refunds");
  const refunds = Array.isArray(rawRefunds) ? rawRefunds : [];

  const {
    data: rawAnalytics,
  } = useApiQuery<RefundAnalytics[]>(["refunds", "analytics"], "/api/refunds?analytics=true");
  const analytics = Array.isArray(rawAnalytics) ? rawAnalytics : [];

  const handleRequest = async () => {
    if (!wallet.publicKey) { toast.error("Connect your wallet first"); return; }
    if (!formPaymentId || !formAmount) { toast.error("Payment ID and amount are required"); return; }
    setSubmitting(true);
    try {
      const result = await requestRefund(
        wallet.publicKey,
        parseInt(formPaymentId, 10),
        parseFloat(formAmount) || 0,
        formAsset || "native",
        formReason || "Refund requested",
        formReasonCode,
      );
      if (!result.success) {
        toast.error(result.error || "Failed to request refund");
        return;
      }
      // Persist a ledger row linked to the on-chain refund id (captured from
      // the tx return value) so the request appears in the list and
      // approve/process can target the correct contract record.
      const onChainId =
        typeof result.data === "number" && isOnChainId(result.data)
          ? result.data
          : undefined;
      const persisted = await apiFetch("/api/refunds", {
        method: "POST",
        body: JSON.stringify({
          paymentId: parseInt(formPaymentId, 10),
          amount: parseFloat(formAmount) || 0,
          asset: formAsset || "native",
          reason: formReason || "Refund requested",
          reasonCode: formReasonCode,
          onChainId,
        }),
      }).catch(() => null);
      if (persisted === null) {
        toast.error("Refund submitted on-chain, but the ledger row could not be saved.");
      } else {
        toast.success("Refund requested on-chain");
      }
      setShowRequest(false);
      setFormPaymentId("");
      setFormAmount("");
      setFormAsset("");
      setFormReason("");
      queryClient.invalidateQueries({ queryKey: ["refunds"] });
    } catch {
      toast.error("Network error");
    } finally {
      setSubmitting(false);
    }
  };

  // On-chain refunds are addressed by u64 ids in the Soroban contract; the DB
  // rows listed here carry that id in onChainId. Only invoke approve/process
  // for rows with a linked on-chain id — otherwise the call always fails.
  const requireOnChainRefund = (refund: Refund): number | null => {
    if (!isOnChainId(refund.onChainId)) {
      toast.error("This refund has no linked on-chain id — approve/process requires an on-chain refund.");
      return null;
    }
    return refund.onChainId as number;
  };

  // Mirror an on-chain transition onto the ledger row so the list reflects
  // the Request → Approve → Process lifecycle. Non-fatal on failure.
  const syncRefundStatus = async (refundId: string, status: "APPROVED" | "PROCESSED" | "REJECTED") => {
    await apiFetch(`/api/refunds/${refundId}`, {
      method: "PATCH",
      body: JSON.stringify({ status }),
    }).catch(() => null);
  };

  const handleApprove = async (refund: Refund) => {
    if (!wallet.publicKey) { toast.error("Connect your wallet first"); return; }
    const onChainId = requireOnChainRefund(refund);
    if (onChainId === null) return;
    try {
      const result = await approveRefund(wallet.publicKey, onChainId);
      if (result.success) {
        await syncRefundStatus(refund.id, "APPROVED");
        toast.success("Refund approved on-chain");
        queryClient.invalidateQueries({ queryKey: ["refunds"] });
      } else {
        toast.error(result.error || "Approval failed");
      }
    } catch {
      toast.error("Network error");
    }
  };

  const handleProcess = async (refund: Refund) => {
    if (!wallet.publicKey) { toast.error("Connect your wallet first"); return; }
    const onChainId = requireOnChainRefund(refund);
    if (onChainId === null) return;
    try {
      const result = await processRefund(wallet.publicKey, onChainId);
      if (result.success) {
        await syncRefundStatus(refund.id, "PROCESSED");
        toast.success("Refund processed on-chain — tokens returned");
        queryClient.invalidateQueries({ queryKey: ["refunds"] });
      } else {
        toast.error(result.error || "Processing failed");
      }
    } catch {
      toast.error("Network error");
    }
  };

  const showConnectBanner = !wallet.connected;

  if (loading) {
    return (
      <div className="animate-fade-in space-y-6">
        <div className="h-8 w-48 bg-gray-200 dark:bg-gray-700 rounded animate-pulse" />
        <LoadingSkeleton lines={2} variant="card" />
      </div>
    );
  }

  const reasonLabel = (code: number) => REASON_CODES.find((r) => r.value === code)?.label ?? "Unknown";
  const maxAnalytics = Math.max(...analytics.map((a) => a.count), 1);

  return (
    <div className="space-y-6 animate-fade-in">
      {showConnectBanner && (
        <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-lg p-4 flex items-center gap-3 animate-fade-in">
          <span className="text-amber-500 text-lg">⚠️</span>
          <div>
            <p className="text-sm font-medium text-amber-800 dark:text-amber-200">Wallet not connected</p>
            <p className="text-xs text-amber-600 dark:text-amber-400">
              Connect your wallet to request, approve, and process refunds on-chain.
            </p>
          </div>
        </div>
      )}

      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">↩️ Refunds</h1>
          <p className="text-gray-500 dark:text-gray-400 mt-1">
            Structured refund lifecycle — Request → Approve → Process
          </p>
        </div>
        <div className="flex gap-2">
          <div className="flex rounded-lg border border-gray-300 dark:border-gray-600 overflow-hidden" role="tablist" aria-label="Refund views">
            <button
              onClick={() => setActiveTab("list")}
              role="tab"
              aria-selected={activeTab === "list"}
              className={`px-3 py-1.5 text-sm font-medium transition-colors ${
                activeTab === "list"
                  ? "bg-blue-600 text-white"
                  : "bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700"
              }`}
            >
              List
            </button>
            <button
              onClick={() => setActiveTab("analytics")}
              role="tab"
              aria-selected={activeTab === "analytics"}
              className={`px-3 py-1.5 text-sm font-medium transition-colors ${
                activeTab === "analytics"
                  ? "bg-blue-600 text-white"
                  : "bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700"
              }`}
            >
              Analytics
            </button>
          </div>
          <Button onClick={() => setShowRequest(true)}>+ Request Refund</Button>
        </div>
      </div>

      {activeTab === "analytics" && (
        <Card className="p-4">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
            Reason Code Analytics
          </h2>
          {analytics.length === 0 ? (
            <p className="text-sm text-gray-500">No refund data yet.</p>
          ) : (
            <div className="space-y-2">
              {analytics.map((entry) => (
                <div key={entry.code} className="flex items-center gap-3">
                  <span className="text-xs font-medium text-gray-600 dark:text-gray-400 w-32">
                    {reasonLabel(entry.code)}
                  </span>
                  <div className="flex-1 h-5 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-purple-500 transition-all rounded-full"
                      style={{ width: `${(entry.count / maxAnalytics) * 100}%` }}
                    />
                  </div>
                  <span className="text-xs font-semibold text-gray-900 dark:text-white w-8 text-right">
                    {entry.count}
                  </span>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {activeTab === "list" && refunds.length === 0 ? (
        <EmptyState
          icon={
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-8 h-8 text-gray-400">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 15L3 9m0 0l6-6M3 9h12a6 6 0 010 12h-3" />
            </svg>
          }
          title="No Refunds"
          description="Request a refund for an existing payment. Refunds follow a structured lifecycle with reason codes."
          actionLabel="Request Refund"
          onAction={() => setShowRequest(true)}
        />
      ) : activeTab === "list" ? (
        <div className="space-y-3">
          {refunds.map((r) => {
            const statusKey = r.status?.toUpperCase() ?? "REQUESTED";
            return (
            <Card key={r.id} className="p-4">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono text-xs text-gray-500">#{r.id.slice(0, 8)}</span>
                    <h3 className="font-semibold text-gray-900 dark:text-white">
                      Payment #{r.paymentId}
                    </h3>
                    <Badge variant={STATUS_COLORS[statusKey] ?? "info"}>
                      {statusKey}
                    </Badge>
                    <Badge variant="default">{reasonLabel(r.reasonCode)}</Badge>
                  </div>
                  <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">{r.reason}</p>
                  <div className="flex items-center gap-4 mt-2 text-xs text-gray-400">
                    <span>Amount: {r.amount} {r.asset || "native"}</span>
                    <span>Requested: {new Date(r.requestedAt).toLocaleDateString()}</span>
                  </div>
                </div>
                <div className="flex gap-2 flex-shrink-0">
                  {isOnChainId(r.onChainId) ? (
                    <>
                      {statusKey === "REQUESTED" && (
                        <Button size="sm" variant="primary" onClick={() => handleApprove(r)}>
                          Approve
                        </Button>
                      )}
                      {statusKey === "APPROVED" && (
                        <Button size="sm" variant="primary" onClick={() => handleProcess(r)}>
                          Process
                        </Button>
                      )}
                    </>
                  ) : (
                    (statusKey === "REQUESTED" || statusKey === "APPROVED") && (
                      <span className="text-xs text-gray-400 italic max-w-[160px] text-right">
                        No linked on-chain refund — no on-chain action available
                      </span>
                    )
                  )}
                  {statusKey === "PROCESSED" && (
                    <span className="text-xs text-green-600 dark:text-green-400 flex items-center gap-1">
                      ✅ Complete
                    </span>
                  )}
                </div>
              </div>
            </Card>
            );
          })}
        </div>
      ) : null}

      {/* Request Refund Modal */}
      <Modal
        open={showRequest}
        onClose={() => setShowRequest(false)}
        title="Request Refund"
        description="Select a payment, provide a reason, and submit an on-chain refund request."
      >
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Payment ID
            </label>
            <input
              value={formPaymentId}
              onChange={(e) => setFormPaymentId(e.target.value)}
              type="number"
              className="w-full px-3 py-2 border rounded-lg dark:bg-gray-800 dark:border-gray-700"
              placeholder="e.g. 42"
              inputMode="numeric"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Amount (stroops)
            </label>
            <input
              value={formAmount}
              onChange={(e) => setFormAmount(e.target.value)}
              type="number"
              className="w-full px-3 py-2 border rounded-lg dark:bg-gray-800 dark:border-gray-700"
              placeholder="e.g. 10000000"
              inputMode="numeric"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Asset Address
            </label>
            <input
              value={formAsset}
              onChange={(e) => setFormAsset(e.target.value)}
              className="w-full px-3 py-2 border rounded-lg dark:bg-gray-800 dark:border-gray-700 font-mono text-sm"
              placeholder="Leave empty for native XLM"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Reason Code
            </label>
            <select
              value={formReasonCode}
              onChange={(e) => setFormReasonCode(parseInt(e.target.value))}
              className="w-full px-3 py-2 border rounded-lg dark:bg-gray-800 dark:border-gray-700"
            >
              {REASON_CODES.map((rc) => (
                <option key={rc.value} value={rc.value}>{rc.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Explanation
            </label>
            <textarea
              value={formReason}
              onChange={(e) => setFormReason(e.target.value)}
              rows={3}
              className="w-full px-3 py-2 border rounded-lg dark:bg-gray-800 dark:border-gray-700"
              placeholder="Describe why you are requesting this refund..."
            />
          </div>
          <Button onClick={handleRequest} loading={submitting} className="w-full">
            Submit Refund Request
          </Button>
        </div>
      </Modal>
    </div>
  );
}
