"use client";
// SPDX-License-Identifier: MIT

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import {
  submitChangeTrustWithWallet,
  isValidAssetCode,
  isValidStellarPublicKey,
  DEFAULT_TRUSTLINE_LIMIT,
} from "@/lib/stellar-transactions";
import type { AssetInfo } from "@/lib/assets";

interface TrustlineModalProps {
  open: boolean;
  onClose: () => void;
  publicKey: string | null;
  onSuccess: (newAsset: AssetInfo) => void;
  initialAssetCode?: string;
  initialIssuer?: string;
}

export function TrustlineModal({
  open,
  onClose,
  publicKey,
  onSuccess,
  initialAssetCode = "",
  initialIssuer = "",
}: TrustlineModalProps) {
  const [assetCode, setAssetCode] = useState(initialAssetCode);
  const [issuer, setIssuer] = useState(initialIssuer);
  const [limit, setLimit] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const handleReset = () => {
    setAssetCode(initialAssetCode);
    setIssuer(initialIssuer);
    setLimit("");
    setError(null);
    setSuccessMsg(null);
    setSubmitting(false);
  };

  const handleClose = () => {
    handleReset();
    onClose();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccessMsg(null);

    const cleanCode = assetCode.trim().toUpperCase();
    const cleanIssuer = issuer.trim();

    if (!publicKey) {
      setError("Please connect your wallet first.");
      return;
    }

    if (!cleanCode || !isValidAssetCode(cleanCode)) {
      setError("Invalid asset code. Must be 1-12 alphanumeric characters (e.g. USDC, EURC).");
      return;
    }

    if (!cleanIssuer || !isValidStellarPublicKey(cleanIssuer)) {
      setError("Invalid issuer public key. Must be a valid 56-character Stellar G-address.");
      return;
    }

    setSubmitting(true);
    try {
      const finalLimit = limit.trim() || DEFAULT_TRUSTLINE_LIMIT;
      await submitChangeTrustWithWallet(publicKey, cleanCode, cleanIssuer, finalLimit);

      const newAsset: AssetInfo = {
        code: cleanCode,
        issuer: cleanIssuer,
        type: cleanCode.length <= 4 ? "credit_alphanum4" : "credit_alphanum12",
        displayName: cleanCode,
        decimals: 7,
      };

      setSuccessMsg(`Trustline for ${cleanCode} established successfully!`);
      onSuccess(newAsset);

      setTimeout(() => {
        handleClose();
      }, 1200);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to establish trustline.";
      setError(message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title="Add Custom Asset Trustline"
      description="Create a trustline to hold and receive non-native Stellar assets in your connected wallet."
      size="md"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div
            role="alert"
            className="p-3 text-xs rounded-lg bg-red-50 dark:bg-red-950/30 text-red-600 dark:text-red-400 border border-red-200 dark:border-red-800"
          >
            {error}
          </div>
        )}

        {successMsg && (
          <div
            role="status"
            className="p-3 text-xs rounded-lg bg-green-50 dark:bg-green-950/30 text-green-600 dark:text-green-400 border border-green-200 dark:border-green-800"
          >
            ✓ {successMsg}
          </div>
        )}

        <div>
          <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
            Asset Code
          </label>
          <input
            type="text"
            value={assetCode}
            onChange={(e) => setAssetCode(e.target.value.toUpperCase())}
            placeholder="e.g. USDC, EURC, AUDD"
            maxLength={12}
            disabled={submitting}
            className="w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-ophir-500"
            required
          />
          <span className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5 block">
            1 to 12 alphanumeric characters
          </span>
        </div>

        <div>
          <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
            Asset Issuer Public Key
          </label>
          <input
            type="text"
            value={issuer}
            onChange={(e) => setIssuer(e.target.value)}
            placeholder="G..."
            maxLength={56}
            disabled={submitting}
            className="w-full px-3 py-2 text-sm font-mono rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-ophir-500"
            required
          />
          <span className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5 block">
            Standard 56-character Stellar public address starting with G
          </span>
        </div>

        <div>
          <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
            Trust Limit (Optional)
          </label>
          <input
            type="text"
            value={limit}
            onChange={(e) => setLimit(e.target.value)}
            placeholder="Default: Maximum (no limit)"
            disabled={submitting}
            className="w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-ophir-500"
          />
          <span className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5 block">
            Leave blank for default maximum trustline allocation.
          </span>
        </div>

        <div className="pt-2 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={handleClose}
            disabled={submitting}
            className="px-4 py-2 text-xs font-medium rounded-lg text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting || !publicKey}
            className="px-4 py-2 text-xs font-semibold rounded-lg bg-ophir-600 hover:bg-ophir-700 text-white shadow-sm disabled:opacity-50 transition-colors"
          >
            {submitting ? "Waiting for Wallet Approval…" : "Establish Trustline"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
