"use client";
// SPDX-License-Identifier: MIT


import { useState } from "react";
import { usePageTitle } from "@/hooks/usePageTitle";
import { PAGE_TITLES } from "@/lib/page-titles";
import { EmptyState } from "@/components/EmptyState";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { CopyButton } from "@/components/ui/CopyButton";
import { StatusBadge } from "@/components/ui/Badge";
import { useToast } from "@/components/ui/Toast";
import { useApiQuery, useApiMutation, type ApiError } from "@/hooks/useApiQuery";
import { generatePaymentLink } from "@/lib/payment-link";
import { formatAmount, cn } from "@/lib/utils";
import { useWallet } from "@/hooks/useMultiWallet";

interface RequestData {
  id: string;
  amount: number;
  assetCode: string;
  status: string;
  dueDate?: string;
  expiresAt?: string;
  reminderCount?: number;
  lastReminderAt?: string;
  description?: string;
  recipientAddress?: string;
  transactionHash?: string;
  createdAt: string;
  updatedAt: string;
}

interface CreateRequestBody {
  amount: number;
  assetCode: string;
  description?: string;
  recipientAddress?: string;
  dueDate?: string;
}

const QR_API = "https://api.qrserver.com/v1/create-qr-code";

export default function RequestsPage() {
  usePageTitle(PAGE_TITLES.REQUESTS);
  const toast = useToast();
  const { wallet } = useWallet();
  const [showCreate, setShowCreate] = useState(false);
  const [selectedRequest, setSelectedRequest] = useState<RequestData | null>(null);
  const [showQR, setShowQR] = useState(false);

  const [formAmount, setFormAmount] = useState("");
  const [formAsset, setFormAsset] = useState("XLM");
  const [formDescription, setFormDescription] = useState("");
  const [formAddress, setFormAddress] = useState("");
  const [formDueDate, setFormDueDate] = useState("");
  const [remindingId, setRemindingId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const {
    data: rawRequests,
    isLoading: loading,
    refetch,
  } = useApiQuery<RequestData[]>(["requests"], "/api/requests");
  const requests = Array.isArray(rawRequests) ? rawRequests : [];

  const createMutation = useApiMutation<CreateRequestBody, RequestData>(
    "/api/requests",
    { invalidateKeys: [["requests"]] }
  );

  const handleCreate = async () => {
    setFormError(null);
    const amt = parseFloat(formAmount);
    if (!formAmount || isNaN(amt) || amt <= 0) {
      setFormError("Please enter a valid amount greater than 0.");
      return;
    }

    setSubmitting(true);
    try {
      await createMutation.mutateAsync({
        amount: amt,
        assetCode: formAsset,
        description: formDescription || undefined,
        recipientAddress: formAddress || wallet.publicKey || undefined,
        dueDate: formDueDate ? new Date(formDueDate).toISOString() : undefined,
      });
      setShowCreate(false);
      resetForm();
      toast.success("Request created", "Share the payment link with your payer.");
    } catch (err) {
      const apiErr = err as ApiError;
      setFormError(apiErr.message || "Failed to create request");
    } finally {
      setSubmitting(false);
    }
  };

  const handleSendReminder = async (id: string) => {
    setRemindingId(id);
    try {
      const res = await fetch(`/api/requests/${id}/remind`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error("Reminder failed", data.error?.message || data.message || "Failed to send reminder.");
        return;
      }
      toast.success(
        "Reminder sent",
        `Reminder #${data.data.reminderCount} sent to recipient.`
      );
      refetch();
    } catch (err: any) {
      toast.error("Reminder failed", err.message || "Network error occurred.");
    } finally {
      setRemindingId(null);
    }
  };

  const resetForm = () => {
    setFormAmount("");
    setFormAsset("XLM");
    setFormDescription("");
    setFormAddress("");
    setFormDueDate("");
    setFormError(null);
  };

  const getPaymentLink = (req: RequestData): string => {
    const link = generatePaymentLink({
      destination: req.recipientAddress || wallet.publicKey || "",
      amount: req.amount.toString(),
      assetCode: req.assetCode,
      message: req.description,
    });
    if (req.dueDate) {
      const u = new URL(link);
      u.searchParams.set("due", req.dueDate);
      return u.toString();
    }
    return link;
  };

  const getQRUrl = (req: RequestData): string => {
    const link = getPaymentLink(req);
    return `${QR_API}?size=250x250&data=${encodeURIComponent(link)}`;
  };

  if (loading) {
    return (
      <div className="space-y-6 animate-fade-in">
        <div>
          <div className="h-8 w-48 bg-gray-200 dark:bg-gray-800 rounded animate-pulse" />
          <div className="h-4 w-72 bg-gray-200 dark:bg-gray-800 rounded animate-pulse mt-2" />
        </div>
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-24 bg-gray-100 dark:bg-gray-800 rounded-xl animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
            Payment Requests
          </h1>
          <p className="text-gray-500 dark:text-gray-400 mt-1">
            {requests.length > 0
              ? `${requests.length} request${requests.length !== 1 ? "s" : ""}`
              : "Create and share payment request links with your payers"}
          </p>
        </div>
        {requests.length > 0 && (
          <Button onClick={() => setShowCreate(true)}>Create Request</Button>
        )}
      </div>

      {requests.length === 0 ? (
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
                d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m3.75 9v6m3-3H9m1.5-12H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z"
              />
            </svg>
          }
          title="No Payment Requests Yet"
          description="Generate payment request links to share with customers, donors, or DAO members. Recipients can pay with one click."
          actionLabel="Create Request"
          onAction={() => setShowCreate(true)}
        />
      ) : (
        <div className="space-y-3">
          {requests.map((req) => {
            const isOverdue =
              req.status === "OVERDUE" ||
              (req.status === "PENDING" &&
                req.dueDate &&
                new Date(req.dueDate).getTime() < Date.now());

            return (
              <div
                key={req.id}
                className={cn(
                  "bg-white dark:bg-gray-900 rounded-xl border p-5 transition-colors",
                  isOverdue
                    ? "border-amber-300 dark:border-amber-700/70 bg-amber-50/20 dark:bg-amber-950/10"
                    : "border-gray-200 dark:border-gray-800 hover:border-gray-300 dark:hover:border-gray-700"
                )}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-3 mb-2">
                      <span className="text-lg font-bold text-gray-900 dark:text-white">
                        {formatAmount(req.amount, req.assetCode)}
                      </span>
                      {isOverdue ? (
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300 border border-amber-300 dark:border-amber-700">
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            viewBox="0 0 20 20"
                            fill="currentColor"
                            className="w-3.5 h-3.5"
                          >
                            <path
                              fillRule="evenodd"
                              d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z"
                              clipRule="evenodd"
                            />
                          </svg>
                          Overdue
                        </span>
                      ) : (
                        <StatusBadge status={req.status} />
                      )}
                    </div>
                    {req.description && (
                      <p className="text-sm text-gray-600 dark:text-gray-400 mb-2">
                        {req.description}
                      </p>
                    )}
                    <div className="flex flex-wrap items-center gap-3 text-xs text-gray-400">
                      <span>
                        Created{" "}
                        {new Date(req.createdAt).toLocaleDateString(undefined, {
                          month: "short",
                          day: "numeric",
                          year: "numeric",
                        })}
                      </span>
                      {req.dueDate && (
                        <span
                          className={
                            isOverdue
                              ? "font-medium text-amber-700 dark:text-amber-400"
                              : "text-gray-400"
                          }
                        >
                          · Due{" "}
                          {new Date(req.dueDate).toLocaleDateString(undefined, {
                            month: "short",
                            day: "numeric",
                            year: "numeric",
                          })}
                          {isOverdue ? " (Overdue)" : ""}
                        </span>
                      )}
                      {req.reminderCount !== undefined && req.reminderCount > 0 && (
                        <span className="text-gray-500 dark:text-gray-400">
                          · {req.reminderCount} reminder
                          {req.reminderCount !== 1 ? "s" : ""} sent
                        </span>
                      )}
                      {req.transactionHash && (
                        <span className="font-mono text-green-600 dark:text-green-400">
                          · Paid
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {(req.status === "PENDING" || isOverdue) && (
                      <button
                        onClick={() => handleSendReminder(req.id)}
                        disabled={remindingId === req.id}
                        className="px-3 py-1.5 rounded-lg text-xs font-medium text-amber-700 dark:text-amber-300 hover:bg-amber-50 dark:hover:bg-amber-950/30 border border-amber-300 dark:border-amber-800 transition-colors disabled:opacity-50"
                      >
                        {remindingId === req.id ? "Sending..." : "Send Reminder"}
                      </button>
                    )}
                    <button
                      onClick={() => {
                        const link = getPaymentLink(req);
                        navigator.clipboard.writeText(link);
                        toast.success("Link copied", "Share this link with your payer.");
                      }}
                      className="px-3 py-1.5 rounded-lg text-xs font-medium text-ophir-600 dark:text-ophir-400 hover:bg-ophir-50 dark:hover:bg-ophir-950/30 border border-ophir-200 dark:border-ophir-800 transition-colors"
                    >
                      Copy Link
                    </button>
                    <button
                      onClick={() => {
                        setSelectedRequest(req);
                        setShowQR(true);
                      }}
                      className="px-3 py-1.5 rounded-lg text-xs font-medium text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 border border-gray-200 dark:border-gray-700 transition-colors"
                    >
                      QR Code
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Create Modal */}
      <Modal
        open={showCreate}
        onClose={() => {
          setShowCreate(false);
          resetForm();
        }}
        title="Create Payment Request"
        description="Generate a shareable payment link for your payer."
        size="md"
        footer={
          <>
            <button
              onClick={() => {
                setShowCreate(false);
                resetForm();
              }}
              disabled={submitting}
              className="px-4 py-2.5 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={handleCreate}
              disabled={submitting}
              className="px-4 py-2.5 rounded-lg bg-gradient-to-r from-ophir-600 to-stellar-dark text-white text-sm font-medium hover:from-ophir-700 hover:to-stellar transition-all disabled:opacity-50 flex items-center gap-2"
            >
              {submitting ? (
                <>
                  <svg
                    className="animate-spin h-4 w-4"
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                  >
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Creating...
                </>
              ) : (
                "Create Request"
              )}
            </button>
          </>
        }
      >
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
              Amount ({formAsset})
            </label>
            <div className="relative">
              <input
                type="number"
                value={formAmount}
                onChange={(e) => setFormAmount(e.target.value)}
                placeholder="0.00"
                step="0.0000001"
                min="0.0000001"
                className="w-full px-4 py-2.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-400 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-ophir-500 focus:border-transparent pr-16"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-gray-400 font-medium">
                {formAsset}
              </span>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
              Description <span className="text-gray-400 font-normal">(optional)</span>
            </label>
            <input
              type="text"
              value={formDescription}
              onChange={(e) => setFormDescription(e.target.value)}
              placeholder="e.g. Invoice #42 — Consulting services"
              className="w-full px-4 py-2.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-400 text-sm focus:outline-none focus:ring-2 focus:ring-ophir-500 focus:border-transparent"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
              Due Date <span className="text-gray-400 font-normal">(optional — marked overdue after this date)</span>
            </label>
            <input
              type="date"
              value={formDueDate}
              onChange={(e) => setFormDueDate(e.target.value)}
              className="w-full px-4 py-2.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-400 text-sm focus:outline-none focus:ring-2 focus:ring-ophir-500 focus:border-transparent"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
              Recipient Address <span className="text-gray-400 font-normal">(optional — uses your wallet by default)</span>
            </label>
            <input
              type="text"
              value={formAddress}
              onChange={(e) => setFormAddress(e.target.value)}
              placeholder={wallet.publicKey || "G..."}
              className="w-full px-4 py-2.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-400 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-ophir-500 focus:border-transparent"
            />
          </div>

          {formError && (
            <div className="p-3 rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800">
              <p className="text-sm text-red-600 dark:text-red-400">{formError}</p>
            </div>
          )}
        </div>
      </Modal>

      {/* QR Code Modal */}
      <Modal
        open={showQR && selectedRequest !== null}
        onClose={() => {
          setShowQR(false);
          setSelectedRequest(null);
        }}
        title="Payment QR Code"
        description="Scan to pay with any Stellar wallet"
        size="sm"
        footer={
          <button
            onClick={() => {
              setShowQR(false);
              setSelectedRequest(null);
            }}
            className="px-5 py-2.5 rounded-lg bg-ophir-600 text-white text-sm font-medium hover:bg-ophir-700 transition-colors mx-auto"
          >
            Done
          </button>
        }
      >
        {selectedRequest && (
          <div className="space-y-4 text-center">
            <div className="bg-white rounded-xl p-4 inline-block border border-gray-200 dark:border-gray-700">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={getQRUrl(selectedRequest)}
                alt="Payment QR Code"
                className="w-56 h-56"
              />
            </div>
            <div>
              <p className="text-lg font-bold text-gray-900 dark:text-white">
                {formatAmount(selectedRequest.amount, selectedRequest.assetCode)}
              </p>
              {selectedRequest.description && (
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                  {selectedRequest.description}
                </p>
              )}
            </div>
            <div className="flex items-center justify-center gap-2">
              <code className="text-xs font-mono text-gray-500 dark:text-gray-400 truncate max-w-[240px]">
                {getPaymentLink(selectedRequest)}
              </code>
              <CopyButton value={getPaymentLink(selectedRequest)} />
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
