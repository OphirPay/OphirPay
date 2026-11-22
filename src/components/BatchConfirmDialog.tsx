"use client";
// SPDX-License-Identifier: MIT

import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { cn, formatAmount, shortenAddress } from "@/lib/utils";

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

  // Index of the recipient row currently showing the "Copied!" tooltip, or
  // `null` when none is visible. Cleared automatically after ~2s.
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  // Message announced to assistive tech via the aria-live region below.
  const [announcement, setAnnouncement] = useState("");
  // Reset timer so a rapid second click restarts the 2s window cleanly.
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clear any pending timer when the dialog unmounts to avoid setting state
  // on an unmounted component.
  useEffect(() => {
    return () => {
      if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
    };
  }, []);

  const handleCopyAddress = useCallback(
    async (address: string, index: number) => {
      if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
      try {
        await navigator.clipboard.writeText(address);
        setCopiedIndex(index);
        setAnnouncement("Address copied to clipboard");
        resetTimerRef.current = setTimeout(() => {
          setCopiedIndex(null);
          setAnnouncement("");
        }, 2000);
      } catch {
        // Clipboard permission denied / API unavailable — fall back to a
        // manual copy: select the full address so the user can press Ctrl/Cmd+C.
        // No "Copied!" tooltip is shown because the copy did not succeed.
        setCopiedIndex(null);
        setAnnouncement(
          "Copy failed. The address is selected — press Control or Command C to copy."
        );
        const selection = window.getSelection();
        const node = document.getElementById(`recipient-address-${index}`);
        if (selection && node) {
          const range = document.createRange();
          range.selectNodeContents(node);
          selection.removeAllRanges();
          selection.addRange(range);
        }
      }
    },
    []
  );

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
                <div className="relative flex items-center min-w-0">
                  <button
                    type="button"
                    id={`recipient-address-${i}`}
                    onClick={() => handleCopyAddress(r.address, i)}
                    title="Copy address"
                    aria-label={`Copy recipient address ${shortenAddress(r.address, 8)}`}
                    className={cn(
                      "group inline-flex items-center gap-1.5 rounded px-1 -mx-1 text-xs font-mono truncate",
                      "transition-colors duration-150 cursor-pointer",
                      "hover:text-gray-900 dark:hover:text-white focus:outline-none",
                      "focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-1",
                      copiedIndex === i
                        ? "text-green-600 dark:text-green-400"
                        : "text-gray-700 dark:text-gray-300"
                    )}
                  >
                    <span className="truncate">{shortenAddress(r.address, 8)}</span>
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      fill="none"
                      viewBox="0 0 24 24"
                      strokeWidth={1.5}
                      stroke="currentColor"
                      aria-hidden="true"
                      className="w-3.5 h-3.5 shrink-0 opacity-50 group-hover:opacity-100"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M15.75 17.25v3.375c0 .621-.504 1.125-1.125 1.125h-9.75a1.125 1.125 0 01-1.125-1.125V7.875c0-.621.504-1.125 1.125-1.125H6.75a9.06 9.06 0 011.5.124m7.5 10.376h3.375c.621 0 1.125-.504 1.125-1.125V11.25c0-4.46-3.243-8.161-7.5-8.876a9.06 9.06 0 00-1.5-.124H9.375c-.621 0-1.125.504-1.125 1.125v3.5m7.5 10.375H9.375a1.125 1.125 0 01-1.125-1.125v-9.25m12 6.625v-1.875a3.375 3.375 0 00-3.375-3.375h-1.5a1.125 1.125 0 01-1.125-1.125v-1.5a3.375 3.375 0 00-3.375-3.375H9.75"
                      />
                    </svg>
                  </button>
                  {copiedIndex === i && (
                    <span
                      data-testid={`copied-tooltip-${i}`}
                      role="tooltip"
                      className={cn(
                        "pointer-events-none absolute left-0 -top-7 z-10 whitespace-nowrap",
                        "rounded bg-gray-900 dark:bg-gray-700 px-2 py-0.5 text-[10px] font-medium text-white",
                        "shadow-sm animate-fade-in"
                      )}
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
          {/* Screen-reader announcement for copy feedback (issue #1894). */}
          <span
            data-testid="batch-copy-announcement"
            aria-live="polite"
            role="status"
            className="sr-only"
          >
            {announcement}
          </span>
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
