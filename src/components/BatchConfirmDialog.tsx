"use client";
// SPDX-License-Identifier: MIT

import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { formatAmount, shortenAddress } from "@/lib/utils";
import { useState, useEffect } from "react";

interface BatchRecipient {
  address: string;
  amount: string;
}

interface BatchConfirmDialogProps {
  open: boolean;
  recipients: BatchRecipient[];
  totalAmount: number;
  estimatedFee: string;
  feeBasis?: string;
  feeStale?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

const MAX_VISIBLE = 5;
const COPY_FEEDBACK_MS = 2000;

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
  const [copiedTooltip, setCopiedTooltip] = useState(false);
  const [clipboardDenied, setClipboardDenied] = useState(false);

  const visibleRecipients = recipients.slice(0, MAX_VISIBLE);
  const remainingCount = recipients.length - MAX_VISIBLE;
  const feeXlm = formatAmount(parseFloat(estimatedFee) / 10000000, "XLM");

  useEffect(() => {
    if (!copiedTooltip) return;
    const t = setTimeout(() => setCopiedTooltip(false), COPY_FEEDBACK_MS);
    return () => clearTimeout(t);
  }, [copiedTooltip]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(visibleRecipients[0].address);
      setCopiedTooltip(true);
      setClipboardDenied(false);
    } catch (err) {
      setClipboardDenied(true);
      try {
        const ta = document.createElement("textarea");
        ta.value = visibleRecipients[0].address;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
        setCopiedTooltip(true);
        setClipboardDenied(false);
      } catch (fallbackErr) {
        setClipboardDenied(true);
      }
    }
  };

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

        {/* Tooltip */}
        {copiedTooltip && (
          <div
            data-testid="copy-tooltip"
            className="fixed top-0 left-0 w-full bg-gray-600 dark:bg-gray-800 text-white text-sm text-center py-2 rounded"
            role="status"
            aria-live="polite"
          >
            Copied!
          </div>
        )}

        {clipboardDenied && (
          <div
            data-testid="copy-denied"
            className="text-xs text-red-600 dark:text-red-400"
            role="alert"
          >
            Clipboard access denied. Please copy manually.
          </div>
        )}

        {/* Actions */}
        <div className="flex flex-col sm:flex-row justify-end gap-3 pt-2">
          <Button variant="outline" onClick={onCancel} className="w-full sm:w-auto min-h-[44px]">
            Back
          </Button>
          <Button
            variant="primary"
            onClick={handleCopy}
            data-testid="batch-confirm-send"
            className="w-full sm:w-auto min-h-[44px]"
          >
            Confirm & Sign
          </Button>
        </div>
      </div>
    </Modal>
  );
}