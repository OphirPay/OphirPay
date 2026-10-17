"use client";
// SPDX-License-Identifier: MIT

import { useState, useId, useMemo } from "react";
import { Modal } from "@/components/ui/Modal";
import { QrCode } from "@/components/ui/QrCode";
import { isValidSep7Address, buildSep7PayUri, type Sep7PayParams } from "@/lib/stellar-uri";
import { cn } from "@/lib/utils";

export interface PaymentRequestModalProps {
  open: boolean;
  onClose: () => void;
  /** Optional prefilled Stellar recipient address (G...) */
  initialDestination?: string;
  initialAmount?: string;
  initialAssetCode?: string;
  initialAssetIssuer?: string;
  initialMemo?: string;
  initialMemoType?: Sep7PayParams["memoType"];
  initialMsg?: string;
  /** Dialog title */
  title?: string;
}

const COMMON_ASSETS = [
  { code: "XLM", label: "XLM (Native)", issuer: "" },
  { code: "USDC", label: "USDC (Centre)", issuer: "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN" },
];

/**
 * Interactive SEP-0007 payment request modal.
 * Generates mobile-wallet compatible `web+stellar:pay` QR codes with configurable
 * destination, amount, asset, issuer, and transaction memo.
 */
export function PaymentRequestModal({
  open,
  onClose,
  initialDestination = "",
  initialAmount = "",
  initialAssetCode = "XLM",
  initialAssetIssuer = "",
  initialMemo = "",
  initialMemoType = "MEMO_TEXT",
  initialMsg = "",
  title = "Stellar Payment Request",
}: PaymentRequestModalProps) {
  const [destination, setDestination] = useState(initialDestination);
  const [amount, setAmount] = useState(initialAmount);
  const [assetCode, setAssetCode] = useState(initialAssetCode);
  const [assetIssuer, setAssetIssuer] = useState(initialAssetIssuer);
  const [memo, setMemo] = useState(initialMemo);
  const [memoType, setMemoType] = useState<Sep7PayParams["memoType"]>(initialMemoType);
  const [msg, setMsg] = useState(initialMsg);
  const [copiedLink, setCopiedLink] = useState(false);

  const destInputId = useId();
  const amountInputId = useId();
  const assetSelectId = useId();
  const memoInputId = useId();
  const msgInputId = useId();

  const isDestinationValid = useMemo(() => {
    return !destination || isValidSep7Address(destination);
  }, [destination]);

  // Construct SEP-0007 pay URI
  const generatedUri = useMemo(() => {
    if (!destination || !isValidSep7Address(destination)) {
      return "";
    }
    try {
      return buildSep7PayUri({
        destination,
        amount: amount.trim() || undefined,
        assetCode: assetCode === "XLM" ? undefined : assetCode.trim() || undefined,
        assetIssuer: assetCode === "XLM" ? undefined : assetIssuer.trim() || undefined,
        memo: memo.trim() || undefined,
        memoType: memo.trim() ? memoType : undefined,
        msg: msg.trim() || undefined,
      });
    } catch {
      return "";
    }
  }, [destination, amount, assetCode, assetIssuer, memo, memoType, msg]);

  const handleCopyLink = async () => {
    if (!generatedUri) return;
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard) {
        await navigator.clipboard.writeText(generatedUri);
        setCopiedLink(true);
        setTimeout(() => setCopiedLink(false), 2000);
      }
    } catch {
      // ignore
    }
  };

  const handleAssetChange = (code: string) => {
    setAssetCode(code);
    const matched = COMMON_ASSETS.find((a) => a.code === code);
    if (matched) {
      setAssetIssuer(matched.issuer);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      description="Scan with Lobstr, Vibrant, or any SEP-0007 compatible Stellar mobile wallet."
      size="lg"
    >
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Left: Configuration Form */}
        <div className="space-y-4">
          <div>
            <label
              htmlFor={destInputId}
              className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1"
            >
              Destination Address <span className="text-red-500">*</span>
            </label>
            <input
              id={destInputId}
              type="text"
              value={destination}
              onChange={(e) => setDestination(e.target.value.trim())}
              placeholder="G..."
              className={cn(
                "w-full px-3 py-2 text-sm rounded-lg border bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 font-mono transition-colors",
                !isDestinationValid
                  ? "border-red-500 focus:ring-red-500"
                  : "border-gray-300 dark:border-gray-700 focus:ring-ophir-500"
              )}
            />
            {!isDestinationValid && (
              <p className="mt-1 text-xs text-red-500">Invalid Stellar public key address</p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label
                htmlFor={amountInputId}
                className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1"
              >
                Amount (Optional)
              </label>
              <input
                id={amountInputId}
                type="number"
                step="any"
                min="0"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="Any"
                className="w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
              />
            </div>

            <div>
              <label
                htmlFor={assetSelectId}
                className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1"
              >
                Asset
              </label>
              <select
                id={assetSelectId}
                value={assetCode}
                onChange={(e) => handleAssetChange(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
              >
                {COMMON_ASSETS.map((a) => (
                  <option key={a.code} value={a.code}>
                    {a.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label
              htmlFor={memoInputId}
              className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1"
            >
              Memo (Optional)
            </label>
            <div className="flex gap-2">
              <input
                id={memoInputId}
                type="text"
                value={memo}
                onChange={(e) => setMemo(e.target.value)}
                placeholder="Invoice # or ID"
                maxLength={28}
                className="flex-1 px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
              />
              <select
                value={memoType}
                onChange={(e) => setMemoType(e.target.value as Sep7PayParams["memoType"])}
                className="w-28 px-2 py-2 text-xs rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
                aria-label="Memo Type"
              >
                <option value="MEMO_TEXT">TEXT</option>
                <option value="MEMO_ID">ID</option>
                <option value="MEMO_HASH">HASH</option>
              </select>
            </div>
          </div>

          <div>
            <label
              htmlFor={msgInputId}
              className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1"
            >
              Message / Note (Optional)
            </label>
            <input
              id={msgInputId}
              type="text"
              value={msg}
              onChange={(e) => setMsg(e.target.value)}
              placeholder="e.g. Thanks for your business!"
              maxLength={140}
              className="w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
            />
          </div>
        </div>

        {/* Right: QR Code Visual & Actions */}
        <div className="flex flex-col items-center justify-center p-4 rounded-xl border border-gray-200 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-900/50">
          {generatedUri ? (
            <>
              <QrCode
                value={generatedUri}
                size={200}
                title="SEP-0007 Payment QR Code"
                showActions
                downloadFileName={`payment-request-${destination.slice(0, 8)}.png`}
              />
              <div className="mt-4 w-full">
                <div className="flex items-center gap-1.5 p-2 rounded-lg bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-xs">
                  <span className="font-mono truncate text-gray-600 dark:text-gray-300 flex-1">
                    {generatedUri}
                  </span>
                  <button
                    type="button"
                    onClick={handleCopyLink}
                    aria-label="Copy Payment Link"
                    className="p-1 rounded text-gray-500 hover:text-gray-800 dark:hover:text-gray-200"
                  >
                    {copiedLink ? (
                      <span className="text-emerald-600 font-semibold text-[10px]">Copied</span>
                    ) : (
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                      </svg>
                    )}
                  </button>
                </div>
              </div>
            </>
          ) : (
            <div className="text-center py-8 text-gray-400 dark:text-gray-500 text-xs">
              <svg
                className="w-12 h-12 mx-auto mb-2 text-gray-300 dark:text-gray-700"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z" />
              </svg>
              Enter a valid destination address to generate payment QR code
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
