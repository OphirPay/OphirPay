"use client";
// SPDX-License-Identifier: MIT

/**
 * Payment request creation modal (issue #364).
 *
 * Acceptance criteria:
 *   - Modal with amount, asset, memo, optional due date
 *   - Generate shareable link and QR code
 *   - Request link opens a public page showing the request
 *   - Requester notified when paid
 *   - Invalid/expired requests show friendly error
 */

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { useWallet } from "@/hooks/useMultiWallet";
import { generatePaymentLink } from "@/lib/payment-link";
import { isValidStellarAddress } from "@/lib/stellar";
import { QRCodeSVG } from "qrcode.react";

const ASSETS = ["XLM", "USDC", "EURC", "yXLM"];

interface PaymentRequestModalProps {
  open: boolean;
  onClose: () => void;
}

export function PaymentRequestModal({ open, onClose }: PaymentRequestModalProps) {
  const { wallet } = useWallet();
  const { success, error } = useToast();
  const [amount, setAmount] = useState("");
  const [asset, setAsset] = useState("XLM");
  const [memo, setMemo] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [requestUrl, setRequestUrl] = useState("");
  const [loading, setLoading] = useState(false);

  const reset = () => {
    setAmount("");
    setAsset("XLM");
    setMemo("");
    setDueDate("");
    setRequestUrl("");
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const handleCreate = async () => {
    if (!wallet.connected || !wallet.publicKey) {
      error("Connect your wallet first");
      return;
    }
    const amt = parseFloat(amount);
    if (!amount || isNaN(amt) || amt <= 0) {
      error("Enter a valid amount");
      return;
    }

    setLoading(true);
    try {
      const url = generatePaymentLink({
        destination: wallet.publicKey,
        amount: amount,
        memo: memo || undefined,
        assetCode: asset,
        message: `Payment request (due ${dueDate || "ASAP"})`,
      });

      // Store request metadata server-side so we can notify on payment
      const res = await fetch("/api/requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amount: amt,
          assetCode: asset,
          memo: memo || null,
          dueDate: dueDate || null,
          requestUrl: url,
        }),
      });

      if (!res.ok) throw new Error("Failed to save request");
      setRequestUrl(url);
      success("Payment request created", "Share the link or QR code with the payer");
    } catch (err) {
      error(err instanceof Error ? err.message : "Failed to create request");
    } finally {
      setLoading(false);
    }
  };

  const copyLink = () => {
    navigator.clipboard.writeText(requestUrl);
    success("Link copied", "Share it with the payer");
  };

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title={requestUrl ? "Payment Request Ready" : "Create Payment Request"}
      size="md"
      footer={
        requestUrl ? (
          <div className="flex gap-2 w-full">
            <Button variant="secondary" onClick={copyLink} className="flex-1">📋 Copy Link</Button>
            <Button variant="primary" onClick={handleClose} className="flex-1">Done</Button>
          </div>
        ) : (
          <div className="flex gap-2 w-full">
            <Button variant="ghost" onClick={handleClose} className="flex-1">Cancel</Button>
            <Button variant="primary" onClick={handleCreate} loading={loading} className="flex-1">Create Request</Button>
          </div>
        )
      }
    >
      {requestUrl ? (
        <div className="flex flex-col items-center gap-6 py-4">
          <div className="bg-white p-4 rounded-xl shadow">
            <QRCodeSVG value={requestUrl} size={200} level="M" />
          </div>
          <div className="text-center space-y-2">
            <p className="text-sm text-gray-500">Scan with any Stellar wallet</p>
            <p className="text-xs text-gray-400 break-all max-w-sm">{requestUrl}</p>
          </div>
          <div className="bg-blue-50 dark:bg-blue-900/20 p-3 rounded-lg text-sm text-blue-700 dark:text-blue-300">
            <strong>Amount:</strong> {amount} {asset}<br />
            {memo && <><strong>Memo:</strong> {memo}<br /></>}
            {dueDate && <><strong>Due:</strong> {new Date(dueDate).toLocaleString()}</>}
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {!wallet.connected && (
            <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 text-sm text-amber-700 dark:text-amber-300">
              ⚠️ Connect your wallet to create a payment request.
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Amount</label>
            <div className="flex gap-2">
              <input
                type="number"
                min="0"
                step="0.0000001"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
                className="flex-1 px-3 py-2 border rounded-lg text-sm dark:bg-gray-800 dark:border-gray-700"
              />
              <select
                value={asset}
                onChange={(e) => setAsset(e.target.value)}
                className="px-3 py-2 border rounded-lg text-sm dark:bg-gray-800 dark:border-gray-700"
              >
                {ASSETS.map((a) => (
                  <option key={a} value={a}>{a}</option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Memo</label>
            <input
              type="text"
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
              placeholder="Optional description..."
              maxLength={500}
              className="w-full px-3 py-2 border rounded-lg text-sm dark:bg-gray-800 dark:border-gray-700"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Due Date (optional)</label>
            <input
              type="datetime-local"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              className="w-full px-3 py-2 border rounded-lg text-sm dark:bg-gray-800 dark:border-gray-700"
            />
          </div>

          <div className="p-3 rounded-lg bg-gray-50 dark:bg-gray-800 text-xs text-gray-500 dark:text-gray-400">
            <strong>Recipient:</strong> {wallet.publicKey ? `${wallet.publicKey.slice(0, 8)}…${wallet.publicKey.slice(-4)}` : "Not connected"}
          </div>
        </div>
      )}
    </Modal>
  );
}
