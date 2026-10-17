"use client";
// SPDX-License-Identifier: MIT

import { useMemo, useState } from "react";
import {
  buildSep7PayUri,
  isValidSep7Address,
  type Sep7MemoType,
} from "@/lib/stellar-uri";
import { QrCode } from "@/components/ui/QrCode";

export interface PaymentRequestModalProps {
  open: boolean;
  onClose: () => void;
  defaultDestination: string;
  defaultAmount?: string;
  defaultAssetCode?: string;
  defaultAssetIssuer?: string;
  defaultMemo?: string;
  defaultMemoType?: Sep7MemoType;
}

const PRESET_ASSETS: Array<{ code: string; issuer?: string; label: string }> = [
  { code: "XLM", label: "XLM (Native)" },
  {
    code: "USDC",
    issuer: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
    label: "USDC (Centre)",
  },
  {
    code: "EURC",
    issuer: "GDHU6WRG4IEQXM5NZ4BMPKOXHW76MZM4Y2IEMFDVXBSDP6SJY4ITNPP2",
    label: "EURC (Circle)",
  },
];

export function PaymentRequestModal({
  open,
  onClose,
  defaultDestination,
  defaultAmount = "",
  defaultAssetCode = "XLM",
  defaultAssetIssuer = "",
  defaultMemo = "",
  defaultMemoType = "MEMO_TEXT",
}: PaymentRequestModalProps) {
  const [destination, setDestination] = useState(defaultDestination);
  const [amount, setAmount] = useState(defaultAmount);
  const [assetCode, setAssetCode] = useState(defaultAssetCode);
  const [assetIssuer, setAssetIssuer] = useState(defaultAssetIssuer);
  const [memo, setMemo] = useState(defaultMemo);
  const [memoType, setMemoType] = useState<Sep7MemoType>(defaultMemoType);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const { uri, error } = useMemo(() => {
    const trimmedDest = destination.trim();
    if (!isValidSep7Address(trimmedDest)) {
      return {
        uri: null,
        error: "Enter a valid 56-character Stellar public key (G...).",
      };
    }
    try {
      const built = buildSep7PayUri({
        destination: trimmedDest,
        amount: amount.trim() || undefined,
        assetCode: assetCode.trim() || "XLM",
        assetIssuer:
          assetCode.trim() !== "XLM" && assetIssuer.trim()
            ? assetIssuer.trim()
            : undefined,
        memo: memo.trim() || undefined,
        memoType,
      });
      return { uri: built, error: null };
    } catch (err) {
      return {
        uri: null,
        error: err instanceof Error ? err.message : "Invalid SEP-0007 URI parameters",
      };
    }
  }, [destination, amount, assetCode, assetIssuer, memo, memoType]);

  if (!open) return null;

  const handlePresetAssetChange = (code: string) => {
    setAssetCode(code);
    const preset = PRESET_ASSETS.find((a) => a.code === code);
    if (preset?.issuer) {
      setAssetIssuer(preset.issuer);
    } else if (code === "XLM") {
      setAssetIssuer("");
    }
  };

  const handleCopyUri = async () => {
    if (!uri) return;
    try {
      await navigator.clipboard?.writeText(uri);
    } catch {
      // Fallback when clipboard API is unavailable in test environments
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownloadQr = () => {
    if (!uri) return;
    const downloadHref =
      qrDataUrl ||
      `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="220" height="220"><text x="10" y="110">${uri}</text></svg>`)}`;
    const a = document.createElement("a");
    a.href = downloadHref;
    a.download = `ophirpay-request-${assetCode.toLowerCase()}.png`;
    a.click();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Generate QR Payment Request"
      data-testid="payment-request-modal"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
    >
      <div className="w-full max-w-lg rounded-2xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 p-6 shadow-xl space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-gray-900 dark:text-white">
            QR Code Payment Request (SEP-0007)
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close modal"
            data-testid="close-payment-request-modal"
            className="text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400"
          >
            ✕
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="sm:col-span-2">
            <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
              Recipient Address
            </label>
            <input
              type="text"
              value={destination}
              onChange={(e) => setDestination(e.target.value)}
              data-testid="qr-destination-input"
              className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 font-mono text-xs"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
              Amount
            </label>
            <input
              type="text"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00 (optional)"
              data-testid="qr-amount-input"
              className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 font-mono text-xs"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
              Asset
            </label>
            <select
              value={assetCode}
              onChange={(e) => handlePresetAssetChange(e.target.value)}
              data-testid="qr-asset-select"
              className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-xs"
            >
              {PRESET_ASSETS.map((a) => (
                <option key={a.code} value={a.code}>
                  {a.label}
                </option>
              ))}
            </select>
          </div>

          {assetCode !== "XLM" && (
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                Asset Issuer
              </label>
              <input
                type="text"
                value={assetIssuer}
                onChange={(e) => setAssetIssuer(e.target.value)}
                placeholder="G... issuer address"
                data-testid="qr-asset-issuer-input"
                className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 font-mono text-xs"
              />
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
              Memo
            </label>
            <input
              type="text"
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
              placeholder="Optional memo"
              data-testid="qr-memo-input"
              className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-xs"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
              Memo Type
            </label>
            <select
              value={memoType}
              onChange={(e) => setMemoType(e.target.value as Sep7MemoType)}
              data-testid="qr-memo-type-select"
              className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-xs"
            >
              <option value="MEMO_TEXT">MEMO_TEXT</option>
              <option value="MEMO_ID">MEMO_ID</option>
              <option value="MEMO_HASH">MEMO_HASH</option>
              <option value="MEMO_RETURN">MEMO_RETURN</option>
            </select>
          </div>
        </div>

        {error ? (
          <p
            role="alert"
            data-testid="qr-uri-error"
            className="text-xs text-red-600 dark:text-red-400"
          >
            {error}
          </p>
        ) : (
          uri && (
            <div className="flex flex-col items-center space-y-3 pt-2">
              <QrCode
                value={uri}
                size={200}
                title="SEP-0007 Payment Request QR Code"
                onDataUrlReady={setQrDataUrl}
              />
              <code
                data-testid="sep7-uri-preview"
                className="w-full p-2.5 rounded-lg bg-gray-100 dark:bg-gray-800 text-[11px] font-mono break-all text-gray-700 dark:text-gray-300"
              >
                {uri}
              </code>
              <div className="flex items-center gap-3 w-full">
                <button
                  type="button"
                  onClick={() => {
                    void handleCopyUri();
                  }}
                  data-testid="copy-sep7-uri-btn"
                  className="flex-1 py-2 px-3 rounded-lg border border-gray-200 dark:border-gray-700 text-xs font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800"
                >
                  {copied ? "Copied!" : "Copy URI"}
                </button>
                <button
                  type="button"
                  onClick={handleDownloadQr}
                  data-testid="download-qr-btn"
                  className="flex-1 py-2 px-3 rounded-lg bg-ophir-600 text-white text-xs font-medium hover:bg-ophir-700"
                >
                  Download QR Image
                </button>
              </div>
            </div>
          )
        )}
      </div>
    </div>
  );
}
