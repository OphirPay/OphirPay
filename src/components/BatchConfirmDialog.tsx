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
  onConfirm: () => void;
  onCancel: () => void;
}

const MAX_VISIBLE = 5;

export function BatchConfirmDialog({
  open,
  recipients,
  totalAmount,
  estimatedFee,
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
        <div className="rounded-lg bg-gray-50 dark:bg-gray-800/50 p-4 space-y-2">
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
        </div>

        {/* Recipient list */}
        <div>
          <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Recipients</h3>
          <div className="divide-y divide-gray-100 dark:divide-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
            {visibleRecipients.map((r, i) => (
              <div
                key={i}
                className="flex items-center justify-between px-3 py-2 bg-white dark:bg-gray-900"
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
        <div className="flex justify-end gap-3 pt-2">
          <Button variant="outline" onClick={onCancel}>
            Back
          </Button>
          <Button variant="primary" onClick={onConfirm} data-testid="batch-confirm-send">
            Confirm & Sign
          </Button>
        </div>
      </div>
    </Modal>
  );
}
