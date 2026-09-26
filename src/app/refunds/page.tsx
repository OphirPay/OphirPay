"use client";
// SPDX-License-Identifier: MIT


import { useState } from "react";
import { usePageTitle } from "@/hooks/usePageTitle";
import { PAGE_TITLES } from "@/lib/page-titles";
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
import {
  requestRefund,
  approveRefund,
  processRefund,
  rejectRefund,
} from "@/lib/contract-advanced";
import {
  REFUND_REASON_CATALOG,
  getRefundReasonLabel,
  REFUND_WINDOW_LIMITATION_NOTICE,
  toRefundReasonChartData,
  type RefundReasonChartItem,
  type RefundTrendPoint,
} from "@/lib/chart-data";
import type { DateRangePreset } from "@/lib/date-range";

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

interface DetailedAnalyticsResponse {
  buckets: RefundReasonChartItem[];
  trends: RefundTrendPoint[];
  total: number;
  range: string;
  maxWindow: number;
  windowNotice: string;
}

export default function RefundsPage() {
  usePageTitle(PAGE_TITLES.REFUNDS);
  const { wallet } = useWallet();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [showRequest, setShowRequest] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [activeTab, setActiveTab] = useState<"list" | "analytics">("list");
  const [analyticsRange, setAnalyticsRange] = useState<DateRangePreset>("30d");

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
    isLoading: analyticsLoading,
    isError: analyticsError,
    refetch: refetchAnalytics,
  } = useApiQuery<DetailedAnalyticsResponse | { code: number; count: number }[]>(
    ["refunds", "analytics", analyticsRange],
    `/api/refunds?analytics=true&detailed=true&range=${analyticsRange}`
  );

  const analyticsItems: RefundReasonChartItem[] = Array.isArray(rawAnalytics)
    ? toRefundReasonChartData(rawAnalytics)
    : rawAnalytics?.buckets ?? toRefundReasonChartData([]);
  const trendPoints: RefundTrendPoint[] =
    !Array.isArray(rawAnalytics) && rawAnalytics?.trends ? rawAnalytics.trends : [];
  const windowNotice: string =
    !Array.isArray(rawAnalytics) && rawAnalytics?.windowNotice
      ? rawAnalytics.windowNotice
      : REFUND_WINDOW_LIMITATION_NOTICE;
  const totalRefundsCount = Array.isArray(rawAnalytics)
    ? rawAnalytics.reduce((sum, item) => sum + item.count, 0)
    : rawAnalytics?.total ?? 0;


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

  const handleReject = async (refund: Refund) => {
    if (!wallet.publicKey) { toast.error("Connect your wallet first"); return; }
    const onChainId = requireOnChainRefund(refund);
    if (onChainId === null) return;
    try {
      const result = await rejectRefund(wallet.publicKey, onChainId);
      if (result.success) {
        await syncRefundStatus(refund.id, "REJECTED");
        toast.success("Refund rejected on-chain");
        queryClient.invalidateQueries({ queryKey: ["refunds"] });
      } else {
        toast.error(result.error || "Rejection failed");
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
        <div className="space-y-6">
          <Card className="p-6">
            {/* Header with Date-Range Selector */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-gray-100 dark:border-gray-800">
              <div>
                <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
                  Refund Reason Analytics
                </h2>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                  Breakdown and trend analysis by structured reason code
                </p>
              </div>

              {/* Date-Range Selector */}
              <div
                className="flex items-center gap-1.5 bg-gray-100 dark:bg-gray-800 p-1 rounded-lg text-xs font-medium"
                role="group"
                aria-label="Date range selector"
              >
                {(
                  [
                    { value: "7d", label: "7 Days" },
                    { value: "30d", label: "30 Days" },
                    { value: "90d", label: "90 Days" },
                    { value: "all", label: "All Recent" },
                  ] as const
                ).map((preset) => (
                  <button
                    key={preset.value}
                    type="button"
                    onClick={() => setAnalyticsRange(preset.value)}
                    className={`px-2.5 py-1 rounded-md transition-colors cursor-pointer ${
                      analyticsRange === preset.value
                        ? "bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm font-semibold"
                        : "text-gray-500 hover:text-gray-900 dark:hover:text-white"
                    }`}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Bounded window limitation notice */}
            <div
              role="note"
              data-testid="refund-window-notice"
              className="mt-4 p-3.5 rounded-xl border border-blue-200 dark:border-blue-900/50 bg-blue-50 dark:bg-blue-950/30 text-blue-900 dark:text-blue-200 text-xs flex items-start gap-2.5"
            >
              <span className="text-blue-600 dark:text-blue-400 text-sm shrink-0">ℹ️</span>
              <div className="space-y-0.5">
                <p className="font-semibold text-blue-800 dark:text-blue-300">
                  Window Limitation Notice
                </p>
                <p className="text-blue-700 dark:text-blue-300/90 leading-relaxed">
                  {windowNotice}
                </p>
              </div>
            </div>

            {analyticsLoading ? (
              <div className="py-8">
                <LoadingSkeleton lines={4} variant="card" />
              </div>
            ) : analyticsError ? (
              <div className="py-8 text-center">
                <p className="text-sm text-rose-600 dark:text-rose-400 mb-2">
                  Failed to load refund analytics.
                </p>
                <Button size="sm" variant="secondary" onClick={() => refetchAnalytics()}>
                  Retry
                </Button>
              </div>
            ) : totalRefundsCount === 0 ? (
              <div className="py-12 text-center text-gray-400 text-sm">
                <span className="text-2xl block mb-2">📊</span>
                <p className="font-medium text-gray-600 dark:text-gray-300">No refunds recorded</p>
                <p className="text-xs text-gray-400 mt-1">
                  There are no refund records matching the selected date range.
                </p>
              </div>
            ) : (
              <div className="mt-6 space-y-6">
                {/* Reason code breakdown list */}
                <div className="space-y-3">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
                    Distribution by Reason Code
                  </h3>
                  <div className="grid grid-cols-1 gap-3">
                    {analyticsItems.map((item) => (
                      <div
                        key={item.code}
                        className="p-3.5 rounded-xl border border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-900/40 space-y-2"
                      >
                        <div className="flex items-center justify-between text-xs">
                          <div className="flex items-center gap-2">
                            <span
                              className="w-3 h-3 rounded-full shrink-0"
                              style={{ backgroundColor: item.color }}
                            />
                            <span className="font-semibold text-gray-900 dark:text-white">
                              {item.label}
                            </span>
                            <span className="text-[11px] text-gray-400">
                              (Code #{item.code})
                            </span>
                          </div>
                          <span className="font-semibold text-gray-900 dark:text-white">
                            {item.count} ({item.percentage}%)
                          </span>
                        </div>
                        <p className="text-[11px] text-gray-500 dark:text-gray-400">
                          {item.description}
                        </p>
                        <div className="h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                          <div
                            className="h-full rounded-full transition-all"
                            style={{
                              width: `${item.percentage}%`,
                              backgroundColor: item.color,
                            }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Trend Analysis */}
                {trendPoints.length > 0 && (
                  <div className="pt-4 border-t border-gray-100 dark:border-gray-800 space-y-3">
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
                      Trend Across Selected Date Range
                    </h3>
                    <div className="space-y-2">
                      {trendPoints.map((tp) => (
                        <div key={tp.date} className="flex items-center gap-3 text-xs">
                          <span className="font-mono text-gray-500 w-24 shrink-0">
                            {tp.date}
                          </span>
                          <div className="flex-1 h-4 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden flex">
                            {[0, 1, 2, 3, 4, 5].map((code) => {
                              const count = tp.byReason[code] || 0;
                              if (count === 0) return null;
                              const pct = Math.round((count / tp.total) * 100);
                              return (
                                <div
                                  key={code}
                                  style={{
                                    width: `${pct}%`,
                                    backgroundColor: REFUND_REASON_CATALOG[code].color,
                                  }}
                                  title={`${REFUND_REASON_CATALOG[code].label}: ${count}`}
                                />
                              );
                            })}
                          </div>
                          <span className="font-semibold text-gray-700 dark:text-gray-300 w-16 text-right">
                            {tp.total} {tp.total === 1 ? "refund" : "refunds"}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </Card>
        </div>
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
                    {isOnChainId(r.onChainId) && (
                      <span>On-chain refund #{r.onChainId}</span>
                    )}
                  </div>
                </div>
                <div className="flex gap-2 flex-shrink-0">
                  {isOnChainId(r.onChainId) ? (
                    <>
                      {statusKey === "REQUESTED" && (
                        <>
                          <Button size="sm" variant="primary" onClick={() => handleApprove(r)}>
                            Approve
                          </Button>
                          <Button size="sm" variant="danger" onClick={() => handleReject(r)}>
                            Reject
                          </Button>
                        </>
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
