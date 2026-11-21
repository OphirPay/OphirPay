"use client";
// SPDX-License-Identifier: MIT

import { useState, useCallback } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { formatAmount, shortenAddress } from "@/lib/utils";

interface BatchRecipient {
  address: string;
  amount: string;
}

interface BatchConfirmDialogProps {
  open: boolean;
  recipients: BatchRecipient[];
  totalAmount: number;
  estimatedFee: string;
  /**
   * Why the quoted fee is what it is (e.g. "p90 of recently charged fees ·
   * ledger 62% full (medium congestion)"). Comes from Horizon fee statistics
   * (issue #825); omitted when no recommendation was fetched.
   */
  feeBasis?: string;
  /** True when the quoted fee is cached/fallback rather than freshly fetched. */
  feeStale?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

const MAX_VISIBLE = 5;

export function BatchConfirmDialog({
  open,
  recipients,
  totalAmount,
  estimatedFee,
  feeBasis,
  feeStale = false,
  onConfirm,
  onCancel,
}: BatchConfirmDialogProps) {
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const visibleRecipients = recipients.slice(0, MAX_VISIBLE);
  const remainingCount = recipients.length - MAX_VISIBLE;
  const feeXlm = formatAmount(parseFloat(estimatedFee) / 10000000, "XLM");

  const handleCopy = useCallback(async (address: string, index: number) => {
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(address);
        setCopiedIndex(index);
        window.setTimeout(() => {
          setCopiedIndex((current) => (current === index ? null : current));
        }, 2000);
      }
    } catch {
      // Handle clipboard permission denial gracefully
      setCopiedIndex(null);
    }
  }, []);

  return (
    <Modal open={open} onClose={onCancel} title="Confirm Batch Payment" size="md">
      <div className="space-y-4">
        {/* Summary */}
        <div className="rounded-lg bg-gray-50 dark:bg-gray-800/50 p-3 sm:p-4 space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-gray-500 dark:text-gray-400">Recipients</span>
            <span className="font-medium text-gray-900 dark:text-white">{recipients.length}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-gray-500 dark:text-gray-400">Total Amount</span>
            <span className="font-semibold text-gray-900 dark:text-white">{formatAmount(totalAmount, "XLM")}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-gray-500 dark:text-gray-400">Estimated Fee</span>
            <span className="font-medium text-gray-900 dark:text-white">{feeXlm}</span>
          </div>
          {feeBasis && (
            <p
              data-testid="batch-fee-basis"
              className="text-xs text-gray-500 dark:text-gray-400 pt-1"
            >
              {feeStale ? "⚠ " : ""}Fee based on {feeBasis}
              {feeStale ? " (may be stale)" : ""}
            </p>
          )}
        </div>

        {/* Recipient list */}
        <div>
          <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Recipients</h3>
          <div className="divide-y divide-gray-100 dark:divide-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
            {visibleRecipients.map((r, i) => (
              <div
                key={i}
                className="flex items-center justify-between px-3 py-2.5 sm:py-2 bg-white dark:bg-gray-900"
              >
                <div className="relative inline-flex items-center">
                  <button
                    type="button"
                    onClick={() => handleCopy(r.address, i)}
                    title={`Click to copy: ${r.address}`}
                    aria-label={`Copy address ${r.address}`}
                    className="group inline-flex items-center gap-1.5 text-xs font-mono text-gray-700 dark:text-gray-300 hover:text-ophir-600 dark:hover:text-ophir-400 focus:outline-none focus:ring-1 focus:ring-ophir-500 rounded px-1 py-0.5 -mx-1 transition-colors"
                  >
                    <span className="truncate">{shortenAddress(r.address, 8)}</span>
                    {copiedIndex === i ? (
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        fill="none"
                        viewBox="0 0 24 24"
                        strokeWidth={2}
                        stroke="currentColor"
                        className="w-3.5 h-3.5 text-green-600 dark:text-green-400 flex-shrink-0"
                        aria-hidden="true"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M4.5 12.75l6 6 9-13.5"
                        />
                      </svg>
                    ) : (
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        fill="none"
                        viewBox="0 0 24 24"
                        strokeWidth={1.5}
                        stroke="currentColor"
                        className="w-3.5 h-3.5 text-gray-400 group-hover:text-ophir-600 dark:group-hover:text-ophir-400 flex-shrink-0 transition-colors"
                        aria-hidden="true"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M15.75 17.25v3.375c0 .621-.504 1.125-1.125 1.125h-9.75a1.125 1.125 0 01-1.125-1.125V7.875c0-.621.504-1.125 1.125-1.125H6.75a9.06 9.06 0 011.5.124m7.5 10.376h3.375c.621 0 1.125-.504 1.125-1.125V11.25c0-4.46-3.243-8.161-7.5-8.876a9.06 9.06 0 00-1.5-.124H9.375c-.621 0-1.125.504-1.125 1.125v3.5m7.5 10.375H9.375a1.125 1.125 0 01-1.125-1.125v-9.25m12 6.625v-1.875a3.375 3.375 0 00-3.375-3.375h-1.5a1.125 1.125 0 01-1.125-1.125v-1.5a3.375 3.375 0 00-3.375-3.375H9.75"
                        />
                      </svg>
                    )}
                  </button>

                  {/* Tooltip with aria-live for accessibility */}
                  {copiedIndex === i && (
                    <span
                      role="status"
                      aria-live="polite"
                      className="absolute -top-7 left-0 z-10 px-2 py-0.5 text-[10px] font-semibold text-white bg-gray-900 dark:bg-gray-100 dark:text-gray-900 rounded shadow-md pointer-events-none transition-opacity duration-200"
                    >
                      Copied!
                    </span>
                  )}
                </div>

                <span className="text-xs font-mono font-semibold text-gray-900 dark:text-white ml-3">
                  {formatAmount(parseFloat(r.amount), "XLM")}
                </span>
              </div>
            ))}
          </div>
          {remainingCount > 0 && (
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-2 text-center">
              …and {remainingCount} more
            </p>
          )}
        </div>

        {/* Actions */}
        <div className="flex flex-col sm:flex-row justify-end gap-3 pt-2">
          <Button variant="outline" onClick={onCancel} className="w-full sm:w-auto min-h-[44px]">
            Back
          </Button>
          <Button variant="primary" onClick={onConfirm} data-testid="batch-confirm-send" className="w-full sm:w-auto min-h-[44px]">
            Confirm & Sign
          </Button>
        </div>
      </div>
    </Modal>
  );
}
