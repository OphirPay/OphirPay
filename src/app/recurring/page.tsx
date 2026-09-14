"use client";
// SPDX-License-Identifier: MIT


import { useState } from "react";
import { usePageTitle } from "@/hooks/usePageTitle";
import { PAGE_TITLES } from "@/lib/page-titles";
import { EmptyState } from "@/components/EmptyState";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { useToast } from "@/components/ui/Toast";
import { useWallet } from "@/hooks/useMultiWallet";
import { useApiQuery, useApiMutation, type ApiError } from "@/hooks/useApiQuery";
import { formatAmount, shortenAddress } from "@/lib/utils";
import { isValidStellarAddress } from "@/lib/stellar";
import { FREQUENCY_OPTIONS, FREQUENCY_LABELS, nextRunAt, type Frequency } from "@/lib/recurrence";

interface Recurrence {
  id: string;
  name: string;
  frequency: string;
  amount: string;
  assetCode: string;
  destAddress: string;
  description: string | null;
  isActive: boolean;
  nextRunAt: string;
  lastRunAt: string | null;
  createdAt: string;
}

interface CreateRecurrenceBody {
  name: string;
  frequency: string;
  amount: number;
  destAddress: string;
  description?: string;
  sourceAccountId: string;
}

export default function RecurringPage() {
  usePageTitle(PAGE_TITLES.RECURRING);
  const { wallet } = useWallet();
  const toast = useToast();

  const [showCreate, setShowCreate] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [formName, setFormName] = useState("");
  const [formPayee, setFormPayee] = useState("");
  const [formAmount, setFormAmount] = useState("");
  const [formFrequency, setFormFrequency] = useState("DAILY");
  const [formDescription, setFormDescription] = useState("");

  const {
    data: rawRecurrences,
    isLoading: loading,
  } = useApiQuery<Recurrence[]>(["recurring"], "/api/recurring");
  const recurrences = Array.isArray(rawRecurrences) ? rawRecurrences : [];

  const createMutation = useApiMutation<
    CreateRecurrenceBody,
    Recurrence
  >("/api/recurring", { invalidateKeys: [["recurring"]] });

  const cancelMutation = useApiMutation<
    { id: string },
    { cancelled: boolean }
  >((body) => `/api/recurring/${body.id}`, {
    method: "PATCH",
    invalidateKeys: [["recurring"]],
  });

  const handleCreate = async () => {
    setFormError(null);
    if (!formPayee) {
      setFormError("Recipient address is required.");
      return;
    }
    if (!isValidStellarAddress(formPayee)) {
      setFormError("Invalid Stellar address. Must start with G and be 56 characters long.");
      return;
    }
    const amountNum = parseFloat(formAmount);
    if (!formAmount || isNaN(amountNum) || amountNum <= 0) {
      setFormError("Please enter a valid amount greater than 0.");
      return;
    }
    if (!formName) {
      setFormError("Please give this recurring payment a name.");
      return;
    }
    if (!wallet.publicKey) {
      setFormError("Connect your wallet first.");
      return;
    }

    setSubmitting(true);
    try {
      await createMutation.mutateAsync({
        name: formName,
        frequency: formFrequency,
        amount: amountNum,
        destAddress: formPayee.trim(),
        description: formDescription.trim() || undefined,
        sourceAccountId: wallet.publicKey,
      });
      setShowCreate(false);
      setFormName("");
      setFormPayee("");
      setFormAmount("");
      setFormFrequency("DAILY");
      setFormDescription("");
      toast.success("Recurring payment created", `Next run ${new Date(nextRunPreview(formFrequency)).toLocaleDateString()}`);
    } catch (err) {
      const apiErr = err as ApiError;
      setFormError(apiErr.message || "Failed to create recurring payment");
    } finally {
      setSubmitting(false);
    }
  };

  const handleCancel = async (id: string) => {
    try {
      await cancelMutation.mutateAsync({ id });
      toast.success("Recurring payment cancelled");
    } catch (err) {
      const apiErr = err as ApiError;
      toast.error(apiErr.message || "Failed to cancel recurring payment");
    }
  };

  const resetForm = () => {
    setShowCreate(false);
    setFormError(null);
    setFormName("");
    setFormPayee("");
    setFormAmount("");
    setFormFrequency("DAILY");
    setFormDescription("");
  };

  if (loading) {
    return (
      <div className="space-y-6 animate-fade-in">
        <div>
          <div className="h-8 w-48 bg-gray-200 dark:bg-gray-700 rounded animate-pulse" />
          <div className="h-4 w-72 bg-gray-200 dark:bg-gray-700 rounded animate-pulse mt-2" />
        </div>
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
      {!wallet.connected && (
        <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-lg p-4 flex items-center gap-3 animate-fade-in">
          <span className="text-amber-500 text-lg">⚠️</span>
          <div>
            <p className="text-sm font-medium text-amber-800 dark:text-amber-200">Wallet not connected</p>
            <p className="text-xs text-amber-600 dark:text-amber-400">
              Connect your wallet to create and manage recurring payments.
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

      {recurrences.length === 0 ? (
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
          {recurrences.map((rp) => (
            <Card key={rp.id} className="p-4">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="text-lg" aria-hidden="true">{scheduleIcon(rp.frequency)}</span>
                    <Badge variant={rp.isActive ? "success" : "danger"}>
                      {rp.isActive ? "Active" : "Cancelled"}
                    </Badge>
                    <Badge variant="info">{FREQUENCY_LABELS[rp.frequency as keyof typeof FREQUENCY_LABELS] ?? rp.frequency}</Badge>
                  </div>
                  <p className="text-sm font-medium text-gray-800 dark:text-gray-200">{rp.name}</p>
                  <p className="text-sm text-gray-600 dark:text-gray-400">
                    To: <code className="text-xs">{shortenAddress(rp.destAddress, 12)}</code>
                  </p>
                  <p className="text-lg font-semibold text-gray-900 dark:text-white">
                    {formatAmount(parseFloat(rp.amount), rp.assetCode)}
                  </p>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500 dark:text-gray-400">
                    <span data-testid={`next-run-${rp.id}`}>
                      Next: {formatDate(rp.nextRunAt)}
                    </span>
                    <span data-testid={`prev-run-${rp.id}`}>
                      Last: {rp.lastRunAt ? formatDate(rp.lastRunAt) : "—"}
                    </span>
                    <span>Created: {formatDate(rp.createdAt)}</span>
                  </div>
                  {rp.description && (
                    <p className="text-xs text-gray-500 dark:text-gray-400">{rp.description}</p>
                  )}
                </div>
                {rp.isActive && (
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
        onClose={resetForm}
        title="Create Recurring Payment"
        description="Schedule automated payments on the Stellar network."
      >
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Name</label>
            <input value={formName} onChange={(e) => setFormName(e.target.value)} className="w-full px-3 py-2 border rounded-lg dark:bg-gray-800 dark:border-gray-700" placeholder="e.g. Monthly Rent" data-testid="recurring-name-input" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Recipient Address</label>
            <input value={formPayee} onChange={(e) => setFormPayee(e.target.value)} className="w-full px-3 py-2 border rounded-lg dark:bg-gray-800 dark:border-gray-700 font-mono text-xs" placeholder="GABC..." data-testid="recurring-payee-input" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Amount (XLM)</label>
            <input type="number" min="0.0000001" step="0.0000001" value={formAmount} onChange={(e) => setFormAmount(e.target.value)} className="w-full px-3 py-2 border rounded-lg dark:bg-gray-800 dark:border-gray-700" placeholder="50.00" data-testid="recurring-amount-input" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Frequency</label>
            <select value={formFrequency} onChange={(e) => setFormFrequency(e.target.value)} className="w-full px-3 py-2 border rounded-lg dark:bg-gray-800 dark:border-gray-700" data-testid="recurring-frequency-input">
              {FREQUENCY_OPTIONS.map((f) => (
                <option key={f} value={f}>{FREQUENCY_LABELS[f]}</option>
              ))}
            </select>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1.5" data-testid="recurring-next-preview">
              Next run: {nextRunPreview(formFrequency)}
            </p>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Description <span className="text-gray-400 font-normal">(optional)</span></label>
            <input value={formDescription} onChange={(e) => setFormDescription(e.target.value)} className="w-full px-3 py-2 border rounded-lg dark:bg-gray-800 dark:border-gray-700" placeholder="e.g. Automatic rent payment" data-testid="recurring-description-input" />
          </div>

          {formError && (
            <div className="p-3 rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800">
              <p className="text-sm text-red-600 dark:text-red-400" data-testid="recurring-form-error">{formError}</p>
            </div>
          )}

          <Button onClick={handleCreate} loading={submitting} className="w-full" data-testid="recurring-create-btn">Create Recurring Payment</Button>
        </div>
      </Modal>
    </div>
  );
}

function scheduleIcon(frequency: string): string {
  switch (frequency) {
    case "DAILY": return "🔄";
    case "WEEKLY":
    case "BIWEEKLY": return "📅";
    case "MONTHLY":
    case "QUARTERLY":
    case "YEARLY": return "🗓";
    default: return "⏰";
  }
}

function nextRunPreview(frequency: string): string {
  try {
    return new Date(nextRunAt(new Date(), frequency as Frequency)).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return "—";
  }
}

function formatDate(value: string): string {
  const d = new Date(value);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}
