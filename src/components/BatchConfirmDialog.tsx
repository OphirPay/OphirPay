"use client";
// SPDX-License-Identifier: MIT

import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
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

interface RecipientAddressCopyProps {
  address: string;
  index: number;
}

export function RecipientAddressCopy({ address, index }: RecipientAddressCopyProps) {
  const [copied, setCopied] = useState(false);
  const [hovered, setHovered] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(address);
        setCopied(true);
        if (timeoutRef.current) clearTimeout(timeoutRef.current);
        timeoutRef.current = setTimeout(() => {
          setCopied(false);
        }, 2000);
      }
    } catch {
      setCopied(false);
    }
  };

  const showTooltip = copied || hovered;
  const tooltipText = copied ? "Copied!" : "Copy address";

  return (
    <div className="relative inline-flex items-center">
      <button
        type="button"
        onClick={handleCopy}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onFocus={() => setHovered(true)}
        onBlur={() => setHovered(false)}
        aria-label={`Copy address ${shortenAddress(address, 8)}`}
        title={copied ? "Copied!" : `Copy address ${shortenAddress(address, 8)}`}
        data-testid={`copy-address-button-${index}`}
        className="p-1 rounded text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-ophir-500 transition-colors"
      >
        {copied ? (
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 20 20"
            fill="currentColor"
            className="w-3.5 h-3.5 text-green-600 dark:text-green-400"
            aria-hidden="true"
          >
            <path
              fillRule="evenodd"
              d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z"
              clipRule="evenodd"
            />
          </svg>
        ) : (
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.5}
            className="w-3.5 h-3.5"
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

      {/* Screen reader live notification */}
      {copied && (
        <span role="status" className="sr-only">
          Address copied to clipboard
        </span>
      )}

      {/* Feedback tooltip */}
      {showTooltip && (
        <div
          role="tooltip"
          data-testid={`copy-tooltip-${index}`}
          className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 z-20 px-2 py-0.5 text-xs font-medium rounded-md whitespace-nowrap shadow-md pointer-events-none animate-fade-in bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900"
        >
          {tooltipText}
        </div>
      )}
    </div>
  );
}

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
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className="text-xs font-mono text-gray-700 dark:text-gray-300 truncate">
                    {shortenAddress(r.address, 8)}
                  </span>
                  <RecipientAddressCopy address={r.address} index={i} />
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
