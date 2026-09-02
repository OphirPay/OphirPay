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
import { formatAmount } from "@/lib/utils";
import { useWallet } from "@/hooks/useMultiWallet";

interface RequestData {
  id: string;
  amount: number;
  assetCode: string;
  status: string;
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
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const {
    data: rawRequests,
    isLoading: loading,
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

  const resetForm = () => {
    setFormAmount("");
    setFormAsset("XLM");
    setFormDescription("");
    setFormAddress("");
    setFormError(null);
  };

  const getPaymentLink = (req: RequestData): string => {
    return generatePaymentLink({
      destination: req.recipientAddress || wallet.publicKey || "",
      amount: req.amount.toString(),
      assetCode: req.assetCode,
      message: req.description,
    });
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
          {requests.map((req) => (
            <div
              key={req.id}
              className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5 hover:border-gray-300 dark:hover:border-gray-700 transition-colors"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-3 mb-2">
                    <span className="text-lg font-bold text-gray-900 dark:text-white">
                      {formatAmount(req.amount, req.assetCode)}
                    </span>
                    <StatusBadge status={req.status} />
                  </div>
                  {req.description && (
                    <p className="text-sm text-gray-600 dark:text-gray-400 mb-2">
                      {req.description}
                    </p>
                  )}
                  <div className="flex items-center gap-3 text-xs text-gray-400">
                    <span>
                      {new Date(req.createdAt).toLocaleDateString(undefined, {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                      })}
                    </span>
                    {req.transactionHash && (
                      <span className="font-mono text-green-600 dark:text-green-400">
                        Paid
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
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
          ))}
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
