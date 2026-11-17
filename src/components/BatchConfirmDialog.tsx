"use client";
// SPDX-License-Identifier: MIT

import { useEffect, useRef, useState } from "react";
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
  const visibleRecipients = recipients.slice(0, MAX_VISIBLE);
  const remainingCount = recipients.length - MAX_VISIBLE;
  const feeXlm = formatAmount(parseFloat(estimatedFee) / 10000000, "XLM");

  // Copy-to-clipboard feedback (issue #1894): index of the recipient row
  // whose address was just copied, or null when no tooltip is showing.
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clear a pending tooltip timer on unmount so it cannot fire into an
  // unmounted component.
  useEffect(() => {
    return () => {
      if (copyTimerRef.current !== null) {
        clearTimeout(copyTimerRef.current);
      }
    };
  }, []);

  const handleCopyAddress = async (index: number, address: string) => {
    try {
      // Copy the full address, not the shortened display form.
      await navigator.clipboard.writeText(address);
    } catch {
      // Clipboard API unavailable or permission denied — fail gracefully:
      // no tooltip, no announcement, no exception.
      return;
    }
    if (copyTimerRef.current !== null) {
      clearTimeout(copyTimerRef.current);
    }
    setCopiedIndex(index);
    copyTimerRef.current = setTimeout(() => setCopiedIndex(null), 2000);
  };

  return (
    <Modal open={open} onClose={onCancel} title="Confirm Batch Payment" size="md">
      <div className="space-y-4">
        {/* Screen-reader announcement for a successful copy */}
        <span aria-live="polite" className="sr-only">
          {copiedIndex !== null ? "Address copied" : ""}
        </span>
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
                <span className="relative inline-flex min-w-0">
                  <button
                    type="button"
                    onClick={() => void handleCopyAddress(i, r.address)}
                    aria-label={`Copy recipient address ${shortenAddress(r.address, 8)}`}
                    title="Copy address"
                    className="text-xs font-mono text-gray-700 dark:text-gray-300 truncate cursor-pointer hover:text-gray-900 dark:hover:text-white hover:underline underline-offset-2"
                  >
                    {shortenAddress(r.address, 8)}
                  </button>
                  {copiedIndex === i && (
                    <span
                      role="tooltip"
                      className="absolute bottom-full left-0 z-10 mb-1 whitespace-nowrap rounded bg-gray-900 dark:bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-white dark:text-gray-900 shadow"
                    >
                      Copied!
                    </span>
                  )}
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
          <Button variant="primary" onClick={onConfirm} data-testid="batch-confirm-send" className="w-full sm:w-auto min-h-[44px]">
            Confirm & Sign
          </Button>
        </div>
      </div>
    </Modal>
  );
}
