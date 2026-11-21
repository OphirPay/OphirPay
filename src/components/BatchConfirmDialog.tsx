"use client";
// SPDX-License-Identifier: MIT

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
  /** True while Soroban RPC simulates transaction execution to compute resource gas fees */
  isSimulating?: boolean;
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
  isSimulating = false,
  feeBasis,
  feeStale = false,
  onConfirm,
  onCancel,
}: BatchConfirmDialogProps) {
  const visibleRecipients = recipients.slice(0, MAX_VISIBLE);
  const remainingCount = recipients.length - MAX_VISIBLE;
  const feeXlm = formatAmount(parseFloat(estimatedFee) / 10000000, "XLM");

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
          <div className="flex justify-between items-center text-sm">
            <span className="text-gray-500 dark:text-gray-400">Estimated Fee</span>
            {isSimulating ? (
              <span
                data-testid="gas-simulation-spinner"
                className="inline-flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400"
              >
                <svg
                  className="h-3.5 w-3.5 animate-spin"
                  viewBox="0 0 24 24"
                  fill="none"
                  aria-hidden="true"
                >
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8v8H4z"
                  />
                </svg>
                <span>Estimating gas...</span>
              </span>
            ) : (
              <span data-testid="batch-estimated-fee" className="font-medium text-gray-900 dark:text-white">
                {feeXlm}
              </span>
            )}
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
                <span className="text-xs font-mono text-gray-700 dark:text-gray-300 truncate">
                  {shortenAddress(r.address, 8)}
                </span>
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
          <Button
            variant="primary"
            onClick={onConfirm}
            disabled={isSimulating}
            data-testid="batch-confirm-send"
            className="w-full sm:w-auto min-h-[44px]"
          >
            {isSimulating ? "Simulating..." : "Confirm & Sign"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
