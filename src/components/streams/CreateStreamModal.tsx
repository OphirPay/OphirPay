"use client";
// SPDX-License-Identifier: MIT

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { useWallet } from "@/hooks/useMultiWallet";
import { isValidStellarAddress } from "@/lib/stellar";
import { decimalToStroops } from "@/lib/streams";
import { createStream } from "@/lib/contract-advanced";

interface CreateStreamModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

const DURATION_PRESETS = [
  { label: "1 Hour", seconds: 3600 },
  { label: "1 Day", seconds: 86400 },
  { label: "1 Week", seconds: 604800 },
  { label: "30 Days", seconds: 2592000 },
  { label: "90 Days", seconds: 7776000 },
];

export function CreateStreamModal({ isOpen, onClose, onSuccess }: CreateStreamModalProps) {
  const { wallet } = useWallet();
  const toast = useToast();

  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("");
  const [durationSeconds, setDurationSeconds] = useState(86400); // default 1 day
  const [customDurationHours, setCustomDurationHours] = useState("");
  const [metadata, setMetadata] = useState("");
  const [isCustomDuration, setIsCustomDuration] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (!wallet.publicKey) {
      setFormError("Please connect your Stellar wallet first.");
      return;
    }

    if (!recipient.trim()) {
      setFormError("Recipient address is required.");
      return;
    }

    if (!isValidStellarAddress(recipient.trim())) {
      setFormError("Recipient address must be a valid 56-character Stellar public key (starting with G).");
      return;
    }

    const numAmount = parseFloat(amount);
    if (!amount || isNaN(numAmount) || numAmount <= 0) {
      setFormError("Total amount must be a positive number.");
      return;
    }

    const effectiveDuration = isCustomDuration
      ? Math.round(parseFloat(customDurationHours) * 3600)
      : durationSeconds;

    if (!effectiveDuration || isNaN(effectiveDuration) || effectiveDuration < 60) {
      setFormError("Stream duration must be at least 1 minute (60 seconds).");
      return;
    }

    try {
      setSubmitting(true);
      const totalAmountStroops = decimalToStroops(numAmount);
      const nowSeconds = Math.floor(Date.now() / 1000);
      const startTime = nowSeconds;
      const endTime = nowSeconds + effectiveDuration;
      const assetAddress = wallet.publicKey; // Native Soroban asset reference

      const result = await createStream(
        wallet.publicKey,
        recipient.trim(),
        totalAmountStroops,
        assetAddress,
        startTime,
        endTime,
        metadata.trim()
      );

      if (!result.success) {
        throw new Error(result.error || "On-chain stream creation failed.");
      }

      toast.show(
        `Payment stream created successfully! ${result.txHash ? `Tx: ${result.txHash.slice(0, 8)}...` : ""}`,
        "success"
      );

      // Reset form
      setRecipient("");
      setAmount("");
      setMetadata("");
      setIsCustomDuration(false);
      onClose();
      onSuccess?.();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setFormError(msg);
      toast.show(msg, "error");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Create New Payment Stream"
      className="max-w-lg"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {formError && (
          <div className="p-3 rounded-lg bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 text-xs text-red-700 dark:text-red-300">
            {formError}
          </div>
        )}

        <div>
          <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
            Recipient Stellar Address *
          </label>
          <input
            type="text"
            placeholder="G..."
            value={recipient}
            onChange={(e) => setRecipient(e.target.value)}
            className="w-full px-3 py-2 text-sm font-mono rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-ophir-500 focus:outline-none"
            required
          />
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            The destination wallet that will receive tokens linearly over time.
          </p>
        </div>

        <div>
          <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
            Total Amount (XLM) *
          </label>
          <input
            type="number"
            step="0.0000001"
            min="0.0000001"
            placeholder="e.g. 500"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="w-full px-3 py-2 text-sm font-mono rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-ophir-500 focus:outline-none"
            required
          />
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            Tokens are locked in the contract and vest second-by-second.
          </p>
        </div>

        <div>
          <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1.5">
            Vesting Duration
          </label>
          <div className="grid grid-cols-3 sm:grid-cols-5 gap-1.5 mb-2">
            {DURATION_PRESETS.map((preset) => (
              <button
                key={preset.seconds}
                type="button"
                onClick={() => {
                  setDurationSeconds(preset.seconds);
                  setIsCustomDuration(false);
                }}
                className={`px-2 py-1.5 text-xs font-medium rounded-md border transition-colors ${
                  !isCustomDuration && durationSeconds === preset.seconds
                    ? "bg-ophir-600 text-white border-ophir-600"
                    : "bg-gray-50 dark:bg-gray-900/50 text-gray-700 dark:text-gray-300 border-gray-200 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800"
                }`}
              >
                {preset.label}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2 pt-1">
            <button
              type="button"
              onClick={() => setIsCustomDuration(!isCustomDuration)}
              className="text-xs text-ophir-600 dark:text-ophir-400 hover:underline"
            >
              {isCustomDuration ? "Use preset durations" : "Set custom hours"}
            </button>
            {isCustomDuration && (
              <input
                type="number"
                min="0.1"
                step="0.5"
                placeholder="Hours (e.g. 12)"
                value={customDurationHours}
                onChange={(e) => setCustomDurationHours(e.target.value)}
                className="w-32 px-2.5 py-1 text-xs rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800"
              />
            )}
          </div>
        </div>

        <div>
          <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
            Memo / Purpose (Optional)
          </label>
          <input
            type="text"
            placeholder="e.g. Milestone 1 Grant Stream"
            value={metadata}
            onChange={(e) => setMetadata(e.target.value)}
            className="w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-ophir-500 focus:outline-none"
          />
        </div>

        <div className="flex items-center justify-end gap-3 pt-3 border-t border-gray-200 dark:border-gray-700">
          <Button type="button" variant="secondary" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={submitting}>
            Lock & Create Stream
          </Button>
        </div>
      </form>
    </Modal>
  );
}
