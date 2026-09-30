"use client";
// SPDX-License-Identifier: MIT

import { useState } from "react";
import { useApiMutation } from "@/hooks/useApiQuery";
import { useToast } from "@/components/ui/Toast";

export function RequestPaymentConfirmation({ requestId }: { requestId: string }) {
  const toast = useToast();
  const [transactionHash, setTransactionHash] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const mutation = useApiMutation<
    { transactionHash: string },
    { status: string }
  >(`/api/requests/${encodeURIComponent(requestId)}/paid`);

  const confirmPayment = async () => {
    try {
      await mutation.mutateAsync({ transactionHash: transactionHash.trim() });
      setConfirmed(true);
      toast.success("Payment confirmed", "The requester has been notified.");
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : typeof error === "object" && error !== null && "message" in error
            ? String(error.message)
            : "Check the transaction hash and try again.";
      toast.error(
        "Could not confirm payment",
        message,
      );
    }
  };

  if (confirmed) {
    return (
      <p role="status" className="mt-5 text-sm text-green-700 dark:text-green-400">
        Payment confirmed. The requester has been notified.
      </p>
    );
  }

  return (
    <form
      className="mt-6 border-t border-gray-200 dark:border-gray-700 pt-5"
      onSubmit={(event) => {
        event.preventDefault();
        void confirmPayment();
      }}
    >
      <label
        htmlFor="payment-transaction-hash"
        className="block text-sm font-medium text-gray-700 dark:text-gray-300"
      >
        Already paid with a wallet app?
      </label>
      <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
        Enter the transaction hash to verify payment and notify the requester.
      </p>
      <div className="mt-2 flex gap-2">
        <input
          id="payment-transaction-hash"
          value={transactionHash}
          onChange={(event) => setTransactionHash(event.target.value)}
          placeholder="Stellar transaction hash"
          autoComplete="off"
          className="min-w-0 flex-1 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-xs font-mono text-gray-900 dark:text-white"
        />
        <button
          type="submit"
          disabled={mutation.isPending || !transactionHash.trim()}
          className="rounded-lg bg-gray-100 dark:bg-gray-800 px-3 py-2 text-xs font-medium text-gray-700 dark:text-gray-300 disabled:opacity-50"
        >
          {mutation.isPending ? "Checking..." : "Confirm"}
        </button>
      </div>
    </form>
  );
}
