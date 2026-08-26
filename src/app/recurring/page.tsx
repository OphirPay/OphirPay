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
import { createRecurringPayment, cancelRecurringPayment } from "@/lib/contract-advanced";
import { DEFAULT_CONTRACT_ID } from "@/lib/contracts";

interface RecurringPayment {
  id: number;
  payee: string;
  amount: string;
  schedule: "Daily" | "Weekly" | "Monthly";
  remaining: number;
  times_executed: number;
  next_execution: number;
  active: boolean;
}

export default function RecurringPage() {
  const { wallet } = useWallet();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [formPayee, setFormPayee] = useState("");
  const [formAmount, setFormAmount] = useState("");
  const [formSchedule, setFormSchedule] = useState("Daily");
  const [formRemaining, setFormRemaining] = useState(0);

  const {
    data: rawPayments,
    isLoading: loading,
  } = useApiQuery<RecurringPayment[]>(["recurring"], "/api/recurring");
  const payments = Array.isArray(rawPayments) ? rawPayments : [];

  const handleCreate = async () => {
    if (!wallet.publicKey) { toast.error("Connect your wallet first"); return; }
    if (!formPayee || !formAmount) { toast.error("Payee and amount are required"); return; }
    setSubmitting(true);
    try {
      const amountStroops = Math.round(parseFloat(formAmount) * 10_000_000);
      const result = await createRecurringPayment(
        wallet.publicKey, formPayee, amountStroops, DEFAULT_CONTRACT_ID,
        formSchedule, formRemaining || 0, `recurring-${formSchedule}`,
      );
      if (result.success) {
        toast.success("Recurring payment created on-chain");
        setShowCreate(false);
        setFormPayee("");
        setFormAmount("");
        setFormRemaining(0);
        queryClient.invalidateQueries({ queryKey: ["recurring"] });
      } else {
        toast.error(result.error || "Failed to create recurring payment");
      }
    } catch {
      toast.error("Network error");
    } finally {
      setSubmitting(false);
    }
  };

  const handleCancel = async (id: number) => {
    if (!wallet.publicKey) { toast.error("Connect your wallet first"); return; }
    try {
      const result = await cancelRecurringPayment(wallet.publicKey, id);
      if (result.success) {
        toast.success("Recurring payment cancelled on-chain");
        queryClient.invalidateQueries({ queryKey: ["recurring"] });
      } else {
        toast.error(result.error || "Cancel failed");
      }
    } catch {
      toast.error("Network error");
    }
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
        <Button onClick={() => setShowCreate(true)}>+ New Recurring</Button>
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
        <div className="space-y-3">
          {payments.map((rp) => (
            <Card key={rp.id} className="p-4">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="text-lg">{scheduleIcon(rp.schedule)}</span>
                    <Badge variant={rp.active ? "success" : "danger"}>
                      {rp.active ? "Active" : "Cancelled"}
                    </Badge>
                    <Badge variant="info">{rp.schedule}</Badge>
                  </div>
                  <p className="text-sm text-gray-600 dark:text-gray-400">
                    To: <code className="text-xs">{rp.payee?.slice?.(0, 12)}...</code>
                  </p>
                  <p className="text-lg font-semibold text-gray-900 dark:text-white">
                    {rp.amount} XLM
                  </p>
                  <div className="flex gap-4 text-xs text-gray-500">
                    <span>Executed: {rp.times_executed}×</span>
                    <span>Next: {rp.next_execution ? new Date(rp.next_execution * 1000).toLocaleDateString() : "—"}</span>
                    <span>{rp.remaining > 0 ? `${rp.remaining} left` : "∞"}</span>
                  </div>
                </div>
                {rp.active && (
                  <Button size="sm" variant="secondary" onClick={() => handleCancel(rp.id)}>
                    Cancel
                  </Button>
                )}
              </div>
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
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Recipient Address</label>
            <input value={formPayee} onChange={(e) => setFormPayee(e.target.value)} className="w-full px-3 py-2 border rounded-lg dark:bg-gray-800 dark:border-gray-700 font-mono text-xs" placeholder="GABC..." />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Amount (XLM)</label>
            <input type="number" value={formAmount} onChange={(e) => setFormAmount(e.target.value)} className="w-full px-3 py-2 border rounded-lg dark:bg-gray-800 dark:border-gray-700" placeholder="50.00" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Schedule</label>
            <select value={formSchedule} onChange={(e) => setFormSchedule(e.target.value)} className="w-full px-3 py-2 border rounded-lg dark:bg-gray-800 dark:border-gray-700">
              <option value="Daily">Daily</option>
              <option value="Weekly">Weekly</option>
              <option value="Monthly">Monthly</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Number of Payments (0 = infinite)
            </label>
            <input type="number" value={formRemaining} onChange={(e) => setFormRemaining(Number(e.target.value))} className="w-full px-3 py-2 border rounded-lg dark:bg-gray-800 dark:border-gray-700" min={0} placeholder="12" />
          </div>
          <Button onClick={handleCreate} loading={submitting} className="w-full">Create Recurring Payment</Button>
        </div>
      </Modal>
    </div>
  );
}
