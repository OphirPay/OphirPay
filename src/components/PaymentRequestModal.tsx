"use client";
// SPDX-License-Identifier: MIT

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { QrCode, type PaymentQrParams } from "@/components/ui/QrCode";
import { Button } from "@/components/ui/Button";
import { shortenAddress } from "@/lib/utils";
import { isValidStellarAddress } from "@/lib/stellar";

export interface PaymentRequestFormData {
  destination: string;
  amount: string;
  assetCode: string;
  assetIssuer: string;
  memo: string;
}

interface PaymentRequestModalProps {
  open: boolean;
  onClose: () => void;
  /** Called with the form data when the user generates the payment request */
  onSubmit: (data: PaymentRequestFormData) => void;
}

const initialFormData: PaymentRequestFormData = {
  destination: "",
  amount: "",
  assetCode: "XLM",
  assetIssuer: "",
  memo: "",
};

/**
 * Modal for generating a payment request QR code.
 *
 * Collects destination, amount, asset, and memo; on submit calls `onSubmit`
 * with the form data. The parent component decides whether to show a
 * preview or store the request.
 */
export function PaymentRequestModal({
  open,
  onClose,
  onSubmit,
}: PaymentRequestModalProps) {
  const [formData, setFormData] = useState<PaymentRequestFormData>(initialFormData);
  const [error, setError] = useState<string | null>(null);

  const updateField = (field: keyof PaymentRequestFormData, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const validate = (): boolean => {
    setError(null);
    if (!formData.destination.trim()) {
      setError("Destination address is required.");
      return false;
    }
    if (!isValidStellarAddress(formData.destination.trim())) {
      setError("Invalid Stellar address. Must start with G and be 56 characters long.");
      return false;
    }
    if (formData.amount && isNaN(parseFloat(formData.amount))) {
      setError("Amount must be a valid number.");
      return false;
    }
    if (formData.assetCode !== "XLM" && !formData.assetIssuer.trim()) {
      setError("Asset issuer is required for non-native assets.");
      return false;
    }
    return true;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;
    onSubmit({
      ...formData,
      destination: formData.destination.trim(),
      assetIssuer: formData.assetIssuer.trim(),
      memo: formData.memo.trim(),
    });
    setFormData(initialFormData);
    onClose();
  };

  const handleClose = () => {
    setFormData(initialFormData);
    setError(null);
    onClose();
  };

  const paymentParams: PaymentQrParams = {
    destination: formData.destination.trim() || "GABC…",
    amount: formData.amount || undefined,
    assetCode: formData.assetCode || undefined,
    assetIssuer: formData.assetIssuer || undefined,
    memo: formData.memo || undefined,
  };

  const isValidDestination = isValidStellarAddress(formData.destination.trim());

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title="Request Payment"
      description="Generate a SEP-7 QR code to request a Stellar payment"
    >
      <form onSubmit={handleSubmit} className="space-y-5">
        {/* Destination */}
        <div>
          <label
            htmlFor="pr-destination"
            className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5"
          >
            Destination Address <span className="text-red-500">*</span>
          </label>
          <input
            id="pr-destination"
            type="text"
            value={formData.destination}
            onChange={(e) => updateField("destination", e.target.value)}
            placeholder="GABC…"
            autoComplete="off"
            className="w-full px-4 py-2.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-400 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-ophir-500 focus:border-transparent"
          />
          {isValidDestination && (
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              {shortenAddress(formData.destination.trim(), 8)}
            </p>
          )}
        </div>

        {/* Amount */}
        <div>
          <label
            htmlFor="pr-amount"
            className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5"
          >
            Amount <span className="text-gray-400 font-normal">(optional)</span>
          </label>
          <div className="relative">
            <input
              id="pr-amount"
              type="number"
              inputMode="decimal"
              value={formData.amount}
              onChange={(e) => updateField("amount", e.target.value)}
              placeholder="0.00"
              step="0.0000001"
              min="0"
              className="w-full px-4 py-2.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-400 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-ophir-500 focus:border-transparent pr-16"
            />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-gray-400 font-medium">
              {formData.assetCode || "XLM"}
            </span>
          </div>
        </div>

        {/* Asset code */}
        <div>
          <label
            htmlFor="pr-asset"
            className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5"
          >
            Asset
          </label>
          <select
            id="pr-asset"
            value={formData.assetCode}
            onChange={(e) => {
              const code = e.target.value;
              updateField("assetCode", code);
              if (code === "XLM") updateField("assetIssuer", "");
            }}
            className="w-full px-4 py-2.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-ophir-500 focus:border-transparent"
          >
            <option value="XLM">XLM (Native)</option>
            <option value="USDC">USDC</option>
            <option value="EURC">EURC</option>
          </select>
        </div>

        {/* Asset issuer (for non-native) */}
        {formData.assetCode !== "XLM" && (
          <div>
            <label
              htmlFor="pr-issuer"
              className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5"
            >
              Asset Issuer <span className="text-red-500">*</span>
            </label>
            <input
              id="pr-issuer"
              type="text"
              value={formData.assetIssuer}
              onChange={(e) => updateField("assetIssuer", e.target.value)}
              placeholder="GABC…"
              autoComplete="off"
              className="w-full px-4 py-2.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-400 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-ophir-500 focus:border-transparent"
            />
          </div>
        )}

        {/* Memo */}
        <div>
          <label
            htmlFor="pr-memo"
            className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5"
          >
            Memo <span className="text-gray-400 font-normal">(optional)</span>
          </label>
          <input
            id="pr-memo"
            type="text"
            value={formData.memo}
            onChange={(e) => updateField("memo", e.target.value)}
            placeholder="Payment for services"
            maxLength={28}
            className="w-full px-4 py-2.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-400 text-sm focus:outline-none focus:ring-2 focus:ring-ophir-500 focus:border-transparent"
          />
        </div>

        {/* Validation error */}
        {error && (
          <div className="p-3 rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800">
            <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
          </div>
        )}

        {/* Live QR preview (only when destination is valid) */}
        {isValidDestination && (
          <div className="pt-2 border-t border-gray-200 dark:border-gray-700">
            <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-3 text-center">
              QR Preview
            </p>
            <div className="flex justify-center">
              <QrCode
                payment={paymentParams}
                size={180}
                title="Payment request QR code"
              />
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center justify-end gap-3 pt-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleClose}
          >
            Cancel
          </Button>
          <Button
            variant="primary"
            size="sm"
            type="submit"
          >
            Generate Request
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/**
 * Read-only preview of a generated payment request.
 * Shows the QR code with Download/Copy actions.
 */
export function PaymentRequestPreview({
  payment,
  onClose,
}: {
  payment: PaymentQrParams;
  onClose: () => void;
}) {
  return (
    <div className="flex flex-col items-center gap-4">
      <QrCode
        payment={payment}
        size={220}
        title="Payment request QR code — SEP-7 pay URI"
        showActions
      />
      <Button variant="ghost" size="sm" onClick={onClose}>
        Close
      </Button>
    </div>
  );
}
