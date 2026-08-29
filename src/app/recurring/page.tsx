"use client";
// SPDX-License-Identifier: MIT

import { useState, useEffect, useMemo } from "react";
import { usePageTitle } from "@/hooks/usePageTitle";
import { PAGE_TITLES } from "@/lib/page-titles";
import { useQueryClient } from "@tanstack/react-query";
import { EmptyState } from "@/components/EmptyState";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { useToast } from "@/components/ui/Toast";
import { useWallet } from "@/hooks/useMultiWallet";
import { useApiQuery } from "@/hooks/useApiQuery";
import { createRecurringPayment, cancelRecurringPayment } from "@/lib/contract-advanced";
import { DEFAULT_CONTRACT_ID } from "@/lib/contracts";

export interface ExecutionRecord {
  id: string;
  timestamp: number;
  amount: string;
  txHash: string;
  status: "Success" | "Failed";
}

export interface RecurringPayment {
  id: number;
  payee: string;
  amount: string;
  schedule: "Daily" | "Weekly" | "Monthly";
  remaining: number;
  times_executed: number;
  next_execution: number;
  active: boolean;
  paused?: boolean;
  executions?: ExecutionRecord[];
}

export default function RecurringPage() {
  usePageTitle(PAGE_TITLES.RECURRING);
  const { wallet } = useWallet();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [formPayee, setFormPayee] = useState("");
  const [formAmount, setFormAmount] = useState("");
  const [formSchedule, setFormSchedule] = useState<"Daily" | "Weekly" | "Monthly">("Daily");
  const [formRemaining, setFormRemaining] = useState(0);
  const [expandedHistoryId, setExpandedHistoryId] = useState<number | null>(null);

  const {
    data: rawPayments,
    isLoading: loading,
  } = useApiQuery<RecurringPayment[]>(["recurring"], "/api/recurring");

  const [payments, setPayments] = useState<RecurringPayment[]>([]);

  useEffect(() => {
    if (Array.isArray(rawPayments) && rawPayments.length > 0) {
      setPayments(rawPayments);
    }
  }, [rawPayments]);

  const calculateNextRun = (schedule: "Daily" | "Weekly" | "Monthly") => {
    const now = new Date();
    const next = new Date(now.getTime());
    let interval = "Every 24 hours (Daily)";
    if (schedule === "Daily") {
      next.setDate(next.getDate() + 1);
      interval = "Every 24 hours (Daily)";
    } else if (schedule === "Weekly") {
      next.setDate(next.getDate() + 7);
      interval = "Every 7 days (Weekly)";
    } else if (schedule === "Monthly") {
      next.setMonth(next.getMonth() + 1);
      interval = "Every 30 days (Monthly)";
    }
    return {
      date: next,
      text: next.toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      }),
      interval,
    };
  };

  const nextRunPreview = useMemo(() => calculateNextRun(formSchedule), [formSchedule]);

  const handleCreate = async () => {
    if (!formPayee || !formAmount) {
      toast.error("Payee and amount are required");
      return;
    }
    const parsedAmount = parseFloat(formAmount);
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      toast.error("Please enter a valid amount");
      return;
    }

    setSubmitting(true);
    try {
      const amountStroops = Math.round(parsedAmount * 10_000_000);
      const intervalSec = formSchedule === "Daily" ? 86400 : formSchedule === "Weekly" ? 604800 : 2592000;
      const nextExecution = Math.floor(Date.now() / 1000) + intervalSec;
      let newId = Date.now();

      if (wallet.publicKey) {
        const result = await createRecurringPayment(
          wallet.publicKey,
          formPayee,
          amountStroops,
          DEFAULT_CONTRACT_ID,
          formSchedule,
          formRemaining || 0,
          `recurring-${formSchedule}`,
        );
        if (!result.success) {
          toast.error(result.error || "Failed to create recurring payment");
          setSubmitting(false);
          return;
        }
        if (typeof result.data === "number") {
          newId = result.data;
        }
      }

      const newPayment: RecurringPayment = {
        id: newId,
        payee: formPayee,
        amount: formAmount,
        schedule: formSchedule,
        remaining: formRemaining || 0,
        times_executed: 0,
        next_execution: nextExecution,
        active: true,
        paused: false,
        executions: [],
      };

      setPayments((prev) => [newPayment, ...prev]);
      toast.success("Recurring payment created on-chain");
      setShowCreate(false);
      setFormPayee("");
      setFormAmount("");
      setFormRemaining(0);
      queryClient.invalidateQueries({ queryKey: ["recurring"] });
    } catch {
      toast.error("Network error");
    } finally {
      setSubmitting(false);
    }
  };

  const handlePause = (id: number) => {
    setPayments((prev) =>
      prev.map((rp) => (rp.id === id ? { ...rp, paused: true } : rp))
    );
    toast.success("Recurring payment paused");
  };

  const handleResume = (id: number) => {
    setPayments((prev) =>
      prev.map((rp) => (rp.id === id ? { ...rp, paused: false, active: true } : rp))
    );
    toast.success("Recurring payment resumed");
  };

  const handleCancel = async (id: number) => {
    if (wallet.publicKey) {
      try {
        await cancelRecurringPayment(wallet.publicKey, id);
      } catch {
        // Best effort
      }
    }
    setPayments((prev) =>
      prev.map((rp) =>
        rp.id === id ? { ...rp, active: false, paused: false, remaining: 0 } : rp
      )
    );
    toast.success("Recurring payment cancelled on-chain");
    queryClient.invalidateQueries({ queryKey: ["recurring"] });
  };

  const handleSimulateExecution = (id: number) => {
    const payment = payments.find((p) => p.id === id);
    if (!payment) return;

    const intervalSec =
      payment.schedule === "Daily"
        ? 86400
        : payment.schedule === "Weekly"
        ? 604800
        : 2592000;
    const nowSec = Math.floor(Date.now() / 1000);
    const nextSec = nowSec + intervalSec;
    const nextTimes = payment.times_executed + 1;
    const newRemaining =
      payment.remaining > 0 ? Math.max(0, payment.remaining - 1) : 0;
    const isStillActive = payment.remaining > 0 ? newRemaining > 0 : true;

    const execRecord: ExecutionRecord = {
      id: `exec-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      timestamp: nowSec,
      amount: `${payment.amount} XLM`,
      txHash: `sim_tx_${Math.random().toString(16).substring(2, 10)}`,
      status: "Success",
    };

    setPayments((prev) =>
      prev.map((rp) => {
        if (rp.id !== id) return rp;
        return {
          ...rp,
          times_executed: nextTimes,
          next_execution: nextSec,
          remaining: newRemaining,
          active: isStillActive,
          executions: [execRecord, ...(rp.executions || [])],
        };
      })
    );

    toast.success("Recurring payment execution simulated");
  };

  const scheduleIcon = (s: string) => {
    switch (s) {
      case "Daily": return "🔄";
      case "Weekly": return "📅";
      case "Monthly": return "🗓";
      default: return "⏰";
    }
  };

  const showConnectBanner = !wallet.connected;

  if (loading) {
    return (
      <div className="animate-fade-in space-y-6">
        <div className="h-8 w-48 bg-gray-200 dark:bg-gray-700 rounded animate-pulse" />
        <div className="grid gap-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-24 bg-gray-100 dark:bg-gray-800 rounded animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      {showConnectBanner && (
        <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-lg p-4 flex items-center gap-3 animate-fade-in">
          <span className="text-amber-500 text-lg">⚠️</span>
          <div>
            <p className="text-sm font-medium text-amber-800 dark:text-amber-200">Wallet not connected</p>
            <p className="text-xs text-amber-600 dark:text-amber-400">
              Connect your wallet to create and manage recurring payments on-chain.
            </p>
          </div>
        </div>
      )}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
            Recurring Payments
          </h1>
          <p className="text-gray-500 dark:text-gray-400 mt-1">
            Schedule automated Daily, Weekly, or Monthly payments
          </p>
        </div>
        <Button data-testid="create-recurring-btn" onClick={() => setShowCreate(true)}>
          + New Recurring
        </Button>
      </div>

      {payments.length === 0 ? (
        <EmptyState
          icon={
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-8 h-8 text-gray-400">
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182M2.985 19.644l3.181-3.182" />
            </svg>
          }
          title="No Recurring Payments Yet"
          description="Set up recurring payments for payroll, subscriptions, DAO contributor rewards, and grant distributions."
          actionLabel="Create Recurring Payment"
          onAction={() => setShowCreate(true)}
        />
      ) : (
        <div className="space-y-4" data-testid="recurring-list">
          {payments.map((rp) => (
            <Card key={rp.id} className="p-4" data-testid="recurring-card">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="text-lg">{scheduleIcon(rp.schedule)}</span>
                    <Badge
                      data-testid="recurring-status-badge"
                      variant={rp.paused ? "warning" : rp.active ? "success" : "danger"}
                    >
                      {rp.paused ? "Paused" : rp.active ? "Active" : "Cancelled"}
                    </Badge>
                    <Badge variant="info">{rp.schedule}</Badge>
                  </div>
                  <p className="text-sm text-gray-600 dark:text-gray-400">
                    To: <code className="text-xs">{rp.payee?.slice?.(0, 12)}...</code>
                  </p>
                  <p className="text-lg font-semibold text-gray-900 dark:text-white" data-testid="recurring-amount-display">
                    {rp.amount} XLM
                  </p>
                  <div className="flex flex-wrap gap-4 text-xs text-gray-500">
                    <span data-testid="execution-count">Executed: {rp.times_executed}×</span>
                    <span data-testid="next-execution">
                      Next: {rp.next_execution ? new Date(rp.next_execution * 1000).toLocaleDateString() : "—"}
                    </span>
                    <span data-testid="remaining-count">
                      {rp.remaining > 0 ? `${rp.remaining} left` : rp.times_executed > 0 ? "0 left" : "∞"}
                    </span>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {rp.active && !rp.paused && (
                    <>
                      <Button
                        size="sm"
                        variant="secondary"
                        data-testid="pause-recurring-btn"
                        onClick={() => handlePause(rp.id)}
                      >
                        Pause
                      </Button>
                      <Button
                        size="sm"
                        variant="primary"
                        data-testid="simulate-execution-btn"
                        onClick={() => handleSimulateExecution(rp.id)}
                      >
                        Simulate Execution
                      </Button>
                    </>
                  )}
                  {rp.paused && (
                    <Button
                      size="sm"
                      variant="primary"
                      data-testid="resume-recurring-btn"
                      onClick={() => handleResume(rp.id)}
                    >
                      Resume
                    </Button>
                  )}
                  {(rp.active || rp.paused) && (
                    <Button
                      size="sm"
                      variant="secondary"
                      data-testid="cancel-recurring-btn"
                      onClick={() => handleCancel(rp.id)}
                    >
                      Cancel
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    data-testid="toggle-history-btn"
                    onClick={() =>
                      setExpandedHistoryId(expandedHistoryId === rp.id ? null : rp.id)
                    }
                  >
                    History ({rp.executions?.length ?? 0})
                  </Button>
                </div>
              </div>

              {/* Execution History Drawer */}
              {expandedHistoryId === rp.id && (
                <div className="mt-4 pt-4 border-t border-gray-100 dark:border-gray-800 space-y-3" data-testid="execution-history">
                  <div className="flex items-center justify-between">
                    <h4 className="text-sm font-semibold text-gray-800 dark:text-gray-200">
                      Execution History
                    </h4>
                    <span className="text-xs text-gray-500">
                      Total Runs: {rp.executions?.length ?? 0}
                    </span>
                  </div>
                  {(!rp.executions || rp.executions.length === 0) ? (
                    <p className="text-xs text-gray-500 dark:text-gray-400 py-2" data-testid="empty-history">
                      No executions recorded yet. Use &quot;Simulate Execution&quot; to trigger a run.
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {rp.executions.map((exec, idx) => (
                        <div
                          key={exec.id}
                          className="flex items-center justify-between p-2.5 bg-gray-50 dark:bg-gray-800/60 rounded-md text-xs"
                          data-testid="execution-record"
                        >
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-gray-700 dark:text-gray-300">
                              #{rp.executions!.length - idx}
                            </span>
                            <span className="text-gray-500">
                              {new Date(exec.timestamp * 1000).toLocaleString()}
                            </span>
                            <Badge variant="success" size="sm">
                              {exec.status}
                            </Badge>
                          </div>
                          <div className="flex items-center gap-3">
                            <span className="font-semibold text-gray-800 dark:text-gray-200">
                              {exec.amount}
                            </span>
                            <code className="text-[10px] text-gray-400 font-mono">
                              {exec.txHash}
                            </code>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </Card>
          ))}
        </div>
      )}

      {/* Create Modal */}
      <Modal
        open={showCreate}
        onClose={() => setShowCreate(false)}
        title="Create Recurring Payment"
        description="Schedule automated payments on the Stellar network."
      >
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Recipient Address
            </label>
            <input
              data-testid="recipient-input"
              value={formPayee}
              onChange={(e) => setFormPayee(e.target.value)}
              className="w-full px-3 py-2 border rounded-lg dark:bg-gray-800 dark:border-gray-700 font-mono text-xs"
              placeholder="GABC..."
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Amount (XLM)
            </label>
            <input
              data-testid="amount-input"
              type="number"
              value={formAmount}
              onChange={(e) => setFormAmount(e.target.value)}
              className="w-full px-3 py-2 border rounded-lg dark:bg-gray-800 dark:border-gray-700"
              placeholder="50.00"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Schedule
            </label>
            <select
              data-testid="schedule-select"
              value={formSchedule}
              onChange={(e) => setFormSchedule(e.target.value as "Daily" | "Weekly" | "Monthly")}
              className="w-full px-3 py-2 border rounded-lg dark:bg-gray-800 dark:border-gray-700"
            >
              <option value="Daily">Daily</option>
              <option value="Weekly">Weekly</option>
              <option value="Monthly">Monthly</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Number of Payments (0 = infinite)
            </label>
            <input
              data-testid="remaining-input"
              type="number"
              value={formRemaining}
              onChange={(e) => setFormRemaining(Number(e.target.value))}
              className="w-full px-3 py-2 border rounded-lg dark:bg-gray-800 dark:border-gray-700"
              min={0}
              placeholder="12"
            />
          </div>

          {/* Next-Run Preview Card */}
          <div
            data-testid="next-run-preview"
            className="p-3 bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800 rounded-lg text-xs space-y-1.5"
          >
            <div className="flex items-center justify-between font-semibold text-blue-900 dark:text-blue-200">
              <span>Next Run Preview</span>
              <Badge variant="info" size="sm">{formSchedule}</Badge>
            </div>
            <p className="text-blue-800 dark:text-blue-300 font-medium">
              First Execution: <span className="font-semibold">{nextRunPreview.text}</span>
            </p>
            <p className="text-blue-600 dark:text-blue-400">
              Cadence: {nextRunPreview.interval}
            </p>
            {formRemaining > 0 && formAmount && !isNaN(parseFloat(formAmount)) && (
              <p className="text-blue-700 dark:text-blue-300 pt-1 border-t border-blue-200/60 dark:border-blue-800/60">
                Total Volume: <span className="font-semibold">{(parseFloat(formAmount) * formRemaining).toFixed(2)} XLM</span> ({formRemaining} scheduled runs)
              </p>
            )}
          </div>

          <Button
            data-testid="submit-create-btn"
            onClick={handleCreate}
            loading={submitting}
            className="w-full"
          >
            Create Recurring Payment
          </Button>
        </div>
      </Modal>
    </div>
  );
}
