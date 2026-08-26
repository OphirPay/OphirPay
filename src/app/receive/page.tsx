"use client";
// SPDX-License-Identifier: MIT

import { useState, useMemo } from "react";
import { useWallet } from "@/hooks/useMultiWallet";
import { buildSep7PayUri, generateQrDataUri } from "@/lib/qr";

export default function ReceivePage() {
  const { wallet } = useWallet();
  const [amount, setAmount] = useState("");
  const [memo, setMemo] = useState("");
  const [memoType, setMemoType] = useState<"MEMO_TEXT" | "MEMO_ID">("MEMO_TEXT");
  const [copied, setCopied] = useState(false);
  const [copiedUri, setCopiedUri] = useState(false);

  const destination = wallet.publicKey || "";

  const sep7Uri = useMemo(() => {
    if (!destination) return "";
    return buildSep7PayUri({
      destination,
      amount: amount || undefined,
      memo: memo || undefined,
      memoType: memo ? memoType : undefined,
    });
  }, [destination, amount, memo, memoType]);

  const qrSrc = useMemo(() => {
    if (!sep7Uri) return "";
    return generateQrDataUri(sep7Uri);
  }, [sep7Uri]);

  const handleCopyAddress = async () => {
    if (!destination) return;
    try {
      await navigator.clipboard.writeText(destination);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback
    }
  };

  const handleCopyUri = async () => {
    if (!sep7Uri) return;
    try {
      await navigator.clipboard.writeText(sep7Uri);
      setCopiedUri(true);
      setTimeout(() => setCopiedUri(false), 2000);
    } catch {
      // Fallback
    }
  };

  return (
    <div className="container mx-auto max-w-2xl px-4 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight text-foreground">
          Receive Stellar Payment
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Share your Stellar address or display the SEP-7 payment QR code to receive funds.
        </p>
      </div>

      {!wallet.connected ? (
        <div className="rounded-xl border border-border bg-card p-8 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
            <svg
              className="h-6 w-6"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z"
              />
            </svg>
          </div>
          <h2 className="text-lg font-semibold text-foreground">No Wallet Connected</h2>
          <p className="text-sm text-muted-foreground mt-1 mb-4">
            Connect your Stellar wallet to generate your personalized payment QR code.
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {/* QR Code and Address Card */}
          <div className="rounded-xl border border-border bg-card p-6 shadow-sm flex flex-col items-center text-center">
            {qrSrc && (
              <div className="relative mb-6 rounded-lg border border-border bg-white p-4 shadow-inner">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={qrSrc}
                  alt={`Stellar payment QR code for ${destination}`}
                  width={220}
                  height={220}
                  className="rounded"
                />
              </div>
            )}

            <div className="w-full">
              <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                Your Public Address
              </label>
              <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/40 p-2.5">
                <span className="flex-1 font-mono text-xs text-foreground truncate select-all text-left">
                  {destination}
                </span>
                <button
                  type="button"
                  onClick={handleCopyAddress}
                  className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
                  aria-label="Copy public address to clipboard"
                >
                  {copied ? "Copied!" : "Copy"}
                </button>
              </div>
            </div>
          </div>

          {/* Payment Customization Options */}
          <div className="rounded-xl border border-border bg-card p-6 shadow-sm">
            <h2 className="text-base font-semibold text-foreground mb-4">
              Request Specific Amount (Optional)
            </h2>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label
                  htmlFor="amount-input"
                  className="block text-xs font-medium text-muted-foreground mb-1"
                >
                  Requested Amount (XLM)
                </label>
                <input
                  id="amount-input"
                  type="number"
                  step="0.0000001"
                  min="0"
                  placeholder="e.g. 25.5"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>

              <div>
                <label
                  htmlFor="memo-input"
                  className="block text-xs font-medium text-muted-foreground mb-1"
                >
                  Transaction Memo
                </label>
                <div className="flex gap-2">
                  <input
                    id="memo-input"
                    type="text"
                    maxLength={28}
                    placeholder="e.g. Invoice #1024"
                    value={memo}
                    onChange={(e) => setMemo(e.target.value)}
                    className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                  <select
                    value={memoType}
                    onChange={(e) => setMemoType(e.target.value as "MEMO_TEXT" | "MEMO_ID")}
                    className="rounded-md border border-input bg-background px-2 py-2 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                    aria-label="Memo Type"
                  >
                    <option value="MEMO_TEXT">TEXT</option>
                    <option value="MEMO_ID">ID</option>
                  </select>
                </div>
              </div>
            </div>

            {sep7Uri && (
              <div className="mt-4 pt-4 border-t border-border">
                <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
                  <span>SEP-0007 Payment URI</span>
                  <button
                    type="button"
                    onClick={handleCopyUri}
                    className="text-primary hover:underline"
                  >
                    {copiedUri ? "Copied URI!" : "Copy URI"}
                  </button>
                </div>
                <p className="font-mono text-xs text-muted-foreground break-all bg-muted/40 p-2 rounded">
                  {sep7Uri}
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
