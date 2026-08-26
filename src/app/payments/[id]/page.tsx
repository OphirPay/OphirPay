"use client";
// SPDX-License-Identifier: MIT

import { useEffect, useState, use } from "react";
import Link from "next/link";

export interface PaymentRecord {
  id: string;
  amount: string | number;
  assetCode: string;
  assetIssuer?: string | null;
  description?: string | null;
  memo?: string | null;
  status: "CREATED" | "PENDING" | "PROCESSING" | "SUBMITTED" | "COMPLETED" | "FAILED" | "CANCELLED";
  transactionHash?: string | null;
  stellarOpId?: string | null;
  sourceAccountId?: string | null;
  destAccountId?: string | null;
  errorMessage?: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt?: string | null;
}

const LIFECYCLE_STEPS = [
  { key: "CREATED", label: "Created", description: "Payment record created in OphirPay" },
  { key: "PROCESSING", label: "Signed / Processing", description: "Transaction signed and prepared for network" },
  { key: "SUBMITTED", label: "Submitted", description: "Sent to Stellar Horizon / Soroban RPC" },
  { key: "COMPLETED", label: "Confirmed", description: "Included in closed ledger" },
];

export function getStepStatus(
  stepKey: string,
  currentStatus: PaymentRecord["status"]
): "completed" | "current" | "upcoming" | "failed" {
  if (currentStatus === "FAILED" || currentStatus === "CANCELLED") {
    if (stepKey === "CREATED") return "completed";
    if (stepKey === "COMPLETED") return "failed";
    return "completed";
  }

  const order = ["CREATED", "PENDING", "PROCESSING", "SUBMITTED", "COMPLETED"];
  const currentIndex = order.indexOf(currentStatus);
  const stepIndex = order.indexOf(stepKey);

  if (stepIndex <= currentIndex) return "completed";
  if (stepIndex === currentIndex + 1) return "current";
  return "upcoming";
}

export function PaymentDetailView({ payment }: { payment: PaymentRecord }) {
  const [copiedTx, setCopiedTx] = useState(false);

  const handleCopyTx = async () => {
    if (!payment.transactionHash) return;
    try {
      await navigator.clipboard.writeText(payment.transactionHash);
      setCopiedTx(true);
      setTimeout(() => setCopiedTx(false), 2000);
    } catch {}
  };

  const isFailed = payment.status === "FAILED" || payment.status === "CANCELLED";

  return (
    <div className="container mx-auto max-w-4xl px-4 py-8 space-y-6">
      {/* Header & Back Link */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
            <Link href="/payments" className="hover:underline">
              Payments
            </Link>
            <span>/</span>
            <span className="font-mono">{payment.id}</span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            Payment Details
          </h1>
        </div>

        <div>
          <span
            className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wider ${
              payment.status === "COMPLETED"
                ? "bg-green-500/10 text-green-600 dark:text-green-400 border border-green-500/20"
                : payment.status === "FAILED" || payment.status === "CANCELLED"
                ? "bg-red-500/10 text-red-600 dark:text-red-400 border border-red-500/20"
                : "bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 border border-yellow-500/20"
            }`}
          >
            {payment.status}
          </span>
        </div>
      </div>

      {/* Visual Lifecycle Timeline */}
      <div className="rounded-xl border border-border bg-card p-6 shadow-sm">
        <h2 className="text-base font-semibold text-foreground mb-6">
          Lifecycle Timeline
        </h2>
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-4 relative">
          {LIFECYCLE_STEPS.map((step, idx) => {
            const stepStatus = getStepStatus(step.key, payment.status);
            return (
              <div key={step.key} className="flex flex-col items-start relative">
                <div className="flex items-center gap-3 mb-2">
                  <div
                    className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold ${
                      stepStatus === "completed"
                        ? "bg-primary text-primary-foreground"
                        : stepStatus === "failed"
                        ? "bg-destructive text-destructive-foreground"
                        : stepStatus === "current"
                        ? "border-2 border-primary text-primary"
                        : "bg-muted text-muted-foreground"
                    }`}
                  >
                    {stepStatus === "completed" ? "✓" : stepStatus === "failed" ? "✕" : idx + 1}
                  </div>
                  <span className="text-sm font-semibold text-foreground">
                    {step.key === "COMPLETED" && isFailed ? "Failed" : step.label}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">{step.description}</p>
              </div>
            );
          })}
        </div>

        {payment.errorMessage && (
          <div className="mt-6 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
            <strong>Failure Reason:</strong> {payment.errorMessage}
          </div>
        )}
      </div>

      {/* Payment Information Grid */}
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        {/* Basic Info */}
        <div className="rounded-xl border border-border bg-card p-6 shadow-sm space-y-4">
          <h2 className="text-base font-semibold text-foreground">Payment Information</h2>
          <div className="space-y-3 text-sm">
            <div className="flex justify-between py-1 border-b border-border/50">
              <span className="text-muted-foreground">Amount</span>
              <span className="font-bold text-foreground font-mono">
                {payment.amount} {payment.assetCode}
              </span>
            </div>
            {payment.description && (
              <div className="flex justify-between py-1 border-b border-border/50">
                <span className="text-muted-foreground">Description</span>
                <span className="text-foreground">{payment.description}</span>
              </div>
            )}
            {payment.memo && (
              <div className="flex justify-between py-1 border-b border-border/50">
                <span className="text-muted-foreground">Memo</span>
                <span className="font-mono text-foreground">{payment.memo}</span>
              </div>
            )}
            <div className="flex justify-between py-1 border-b border-border/50">
              <span className="text-muted-foreground">Created At</span>
              <span className="text-foreground">
                {new Date(payment.createdAt).toLocaleString()}
              </span>
            </div>
            {payment.completedAt && (
              <div className="flex justify-between py-1 border-b border-border/50">
                <span className="text-muted-foreground">Completed At</span>
                <span className="text-foreground">
                  {new Date(payment.completedAt).toLocaleString()}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Stellar Blockchain Details */}
        <div className="rounded-xl border border-border bg-card p-6 shadow-sm space-y-4">
          <h2 className="text-base font-semibold text-foreground">Blockchain Details</h2>
          <div className="space-y-3 text-sm">
            <div>
              <span className="text-xs text-muted-foreground block mb-1">Transaction Hash</span>
              {payment.transactionHash ? (
                <div className="flex items-center gap-2 rounded bg-muted/40 p-2 font-mono text-xs text-foreground">
                  <span className="truncate flex-1">{payment.transactionHash}</span>
                  <button
                    type="button"
                    onClick={handleCopyTx}
                    className="text-primary hover:underline text-xs shrink-0"
                  >
                    {copiedTx ? "Copied!" : "Copy"}
                  </button>
                </div>
              ) : (
                <span className="text-xs text-muted-foreground italic">No transaction hash yet</span>
              )}
            </div>

            {payment.transactionHash && (
              <div className="pt-2">
                <a
                  href={`https://stellar.expert/explorer/testnet/tx/${payment.transactionHash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-primary hover:underline font-medium"
                >
                  View on Stellar.Expert Explorer ↗
                </a>
              </div>
            )}

            {payment.destAccountId && (
              <div className="pt-2 border-t border-border/50">
                <span className="text-xs text-muted-foreground block mb-1">Destination Account</span>
                <span className="font-mono text-xs text-foreground truncate block">
                  {payment.destAccountId}
                </span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function PaymentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [payment, setPayment] = useState<PaymentRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadPayment() {
      try {
        setLoading(true);
        const res = await fetch(`/api/payments/${id}`);
        if (!res.ok) {
          throw new Error(`Failed to load payment: ${res.statusText}`);
        }
        const json = await res.json();
        setPayment(json.data || json);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load payment");
      } finally {
        setLoading(false);
      }
    }
    loadPayment();
  }, [id]);

  if (loading) {
    return (
      <div className="container mx-auto max-w-4xl px-4 py-16 text-center text-muted-foreground">
        Loading payment details...
      </div>
    );
  }

  if (error || !payment) {
    return (
      <div className="container mx-auto max-w-4xl px-4 py-16 text-center">
        <h2 className="text-lg font-semibold text-destructive mb-2">Payment Not Found</h2>
        <p className="text-sm text-muted-foreground mb-4">{error || "Could not find payment"}</p>
        <Link href="/payments" className="text-primary hover:underline text-sm font-medium">
          ← Return to Payments List
        </Link>
      </div>
    );
  }

  return <PaymentDetailView payment={payment} />;
}
