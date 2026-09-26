"use client";
// SPDX-License-Identifier: MIT

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { useWallet } from "@/hooks/useMultiWallet";
import { isValidStellarAddress } from "@/lib/stellar";
import { decimalToStroops } from "@/lib/escrows";
import { createEscrow } from "@/lib/contract-advanced";

interface CreateEscrowModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

const DEADLINE_PRESETS = [
  { label: "1 Day", seconds: 86400 },
  { label: "3 Days", seconds: 259200 },
  { label: "1 Week", seconds: 604800 },
  { label: "30 Days", seconds: 2592000 },
];

export function CreateEscrowModal({ isOpen, onClose, onSuccess }: CreateEscrowModalProps) {
  const { wallet } = useWallet();
  const toast = useToast();

  const [beneficiary, setBeneficiary] = useState("");
  const [arbiter, setArbiter] = useState("");
  const [amount, setAmount] = useState("");
  const [durationSeconds, setDurationSeconds] = useState(86400 * 3); // default 3 days
  const [customDays, setCustomDays] = useState("");
  const [isCustomDays, setIsCustomDays] = useState(false);
  const [metadata, setMetadata] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (!wallet.publicKey) {
      setFormError("Please connect your Stellar wallet first.");
      return;
    }

    if (!beneficiary.trim()) {
      setFormError("Beneficiary address is required.");
      return;
    }

    if (!isValidStellarAddress(beneficiary.trim())) {
      setFormError("Beneficiary address must be a valid 56-character Stellar public key (starting with G).");
      return;
    }

    if (arbiter.trim() && !isValidStellarAddress(arbiter.trim())) {
      setFormError("Arbiter address must be a valid 56-character Stellar public key (starting with G).");
      return;
    }

    const numAmount = parseFloat(amount);
    if (!amount || isNaN(numAmount) || numAmount <= 0) {
      setFormError("Escrow amount must be a positive number.");
      return;
    }

    const effectiveDuration = isCustomDays
      ? Math.round(parseFloat(customDays) * 86400)
      : durationSeconds;

    if (!effectiveDuration || isNaN(effectiveDuration) || effectiveDuration < 300) {
      setFormError("Escrow deadline must be at least 5 minutes in the future.");
      return;
    }

    try {
      setSubmitting(true);
      const amountStroops = decimalToStroops(numAmount);
      const nowSeconds = Math.floor(Date.now() / 1000);
      const deadline = nowSeconds + effectiveDuration;
      const assetAddress = wallet.publicKey; // Native Soroban contract asset identifier
      const arbiterAddress = arbiter.trim() ? arbiter.trim() : null;

      const result = await createEscrow(
        wallet.publicKey,
        beneficiary.trim(),
        arbiterAddress,
        amountStroops,
        assetAddress,
        deadline,
        metadata.trim()
      );

      if (!result.success) {
        throw new Error(result.error || "On-chain escrow creation failed.");
      }

      toast.show(
        `Escrow created successfully! ${result.txHash ? `Tx: ${result.txHash.slice(0, 8)}...` : ""}`,
        "success"
      );

      // Reset
      setBeneficiary("");
      setArbiter("");
      setAmount("");
      setMetadata("");
      setIsCustomDays(false);
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
      open={isOpen}
      onClose={onClose}
      title="Create Secure Escrow"
      size="md"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {formError && (
          <div className="p-3 rounded-lg bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 text-xs text-red-700 dark:text-red-300">
            {formError}
          </div>
        )}

        <div>
          <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
            Beneficiary Address *
          </label>
          <input
            type="text"
            placeholder="G..."
            value={beneficiary}
            onChange={(e) => setBeneficiary(e.target.value)}
            className="w-full px-3 py-2 text-sm font-mono rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-ophir-500 focus:outline-none"
            required
          />
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            Party entitled to claim funds upon release or after deadline expiration.
          </p>
        </div>

        <div>
          <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
            Escrow Amount (XLM) *
          </label>
          <input
            type="number"
            step="0.0000001"
            min="0.0000001"
            placeholder="e.g. 1000"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="w-full px-3 py-2 text-sm font-mono rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-ophir-500 focus:outline-none"
            required
          />
        </div>

        <div>
          <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
            Dispute Arbiter (Optional)
          </label>
          <input
            type="text"
            placeholder="G... (Leave blank if no arbiter)"
            value={arbiter}
            onChange={(e) => setArbiter(e.target.value)}
            className="w-full px-3 py-2 text-sm font-mono rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-ophir-500 focus:outline-none"
          />
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            Optional independent arbiter who can resolve disagreements and release or refund funds.
          </p>
        </div>

        <div>
          <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1.5">
            Release Deadline
          </label>
          <div className="grid grid-cols-4 gap-2 mb-2">
            {DEADLINE_PRESETS.map((preset) => (
              <button
                key={preset.seconds}
                type="button"
                onClick={() => {
                  setDurationSeconds(preset.seconds);
                  setIsCustomDays(false);
                }}
                className={`px-2 py-1.5 text-xs font-medium rounded-md border transition-colors ${
                  !isCustomDays && durationSeconds === preset.seconds
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
              onClick={() => setIsCustomDays(!isCustomDays)}
              className="text-xs text-ophir-600 dark:text-ophir-400 hover:underline"
            >
              {isCustomDays ? "Use preset deadlines" : "Custom days"}
            </button>
            {isCustomDays && (
              <input
                type="number"
                min="1"
                placeholder="Days (e.g. 14)"
                value={customDays}
                onChange={(e) => setCustomDays(e.target.value)}
                className="w-32 px-2.5 py-1 text-xs rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800"
              />
            )}
          </div>
        </div>

        <div>
          <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
            Agreement Memo / Release Conditions
          </label>
          <input
            type="text"
            placeholder="e.g. Code delivery verified and approved"
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
            Deposit & Lock Escrow
          </Button>
        </div>
      </form>
    </Modal>
  );
}
