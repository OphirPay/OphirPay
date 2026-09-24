"use client";
// SPDX-License-Identifier: MIT

import { useEffect, useState } from "react";
import {
  buildSep7PayUri,
  type Sep7PayParams,
  SUPPORTED_MOBILE_WALLETS,
} from "@/lib/stellar-uri";
import { QrCode } from "@/components/ui/QrCode";
import { CopyButton } from "@/components/ui/CopyButton";
import { Card } from "@/components/ui/Card";
import { shortenAddress } from "@/lib/utils";

interface Sep7WalletHandoffProps {
  params: Sep7PayParams;
  title?: string;
  showDetailsCard?: boolean;
}

export function Sep7WalletHandoff({
  params,
  title = "Pay with Mobile Wallet",
  showDetailsCard = true,
}: Sep7WalletHandoffProps) {
  const [isMobile, setIsMobile] = useState(false);
  const [showQr, setShowQr] = useState(false);
  const [launchAttempted, setLaunchAttempted] = useState(false);

  const sep7Uri = buildSep7PayUri(params);

  useEffect(() => {
    // Detect mobile device via userAgent and touch points
    const ua = navigator.userAgent || "";
    const isMobileDevice =
      /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(ua) ||
      (navigator.maxTouchPoints && navigator.maxTouchPoints > 2);
    setIsMobile(Boolean(isMobileDevice));
    // Default to showing QR on desktop, direct handoff on mobile
    setShowQr(!isMobileDevice);
  }, []);

  const handleOpenWallet = () => {
    setLaunchAttempted(true);
    // Trigger the SEP-7 custom protocol handler
    window.location.href = sep7Uri;
  };

  const assetLabel = params.assetCode
    ? params.assetCode
    : "XLM (native)";

  return (
    <div className="space-y-6">
      <Card className="p-6 sm:p-8">
        <div className="flex flex-col items-center text-center">
          <div className="h-12 w-12 rounded-full bg-ophir-50 dark:bg-ophir-950/40 flex items-center justify-center mb-4 text-ophir-600 dark:text-ophir-400">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={1.5}
              stroke="currentColor"
              className="w-6 h-6"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M10.5 1.5H8.25A2.25 2.25 0 006 3.75v16.5a2.25 2.25 0 002.25 2.25h7.5A2.25 2.25 0 0018 20.25V3.75a2.25 2.25 0 00-2.25-2.25H13.5m-3 0V3h3V1.5m-3 0h3m-3 18.75h3"
              />
            </svg>
          </div>

          <h2 className="text-xl font-bold text-gray-900 dark:text-white">
            {title}
          </h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 max-w-sm">
            {isMobile
              ? "Open in your installed Stellar wallet app to review and confirm."
              : "Scan with any SEP-7-compatible Stellar wallet app to complete payment."}
          </p>

          {/* Primary Action Button (Open in Wallet) */}
          <div className="mt-6 flex flex-col sm:flex-row items-center gap-3 w-full max-w-xs">
            <a
              href={sep7Uri}
              onClick={handleOpenWallet}
              className="w-full inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-ophir-600 hover:bg-ophir-700 text-white font-medium shadow-sm transition-all focus:outline-none focus:ring-2 focus:ring-ophir-500"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={1.5}
                stroke="currentColor"
                className="w-5 h-5"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25"
                />
              </svg>
              Open in Wallet
            </a>
          </div>

          {/* Toggle QR code on mobile if needed */}
          {isMobile && (
            <button
              type="button"
              onClick={() => setShowQr(!showQr)}
              className="mt-3 text-xs text-ophir-600 dark:text-ophir-400 hover:underline"
            >
              {showQr ? "Hide QR code" : "Need to scan with another device? Show QR code"}
            </button>
          )}

          {/* QR Code Container */}
          {showQr && (
            <div className="mt-6 flex flex-col items-center">
              <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-700 p-4 shadow-sm">
                <QrCode
                  value={sep7Uri}
                  size={200}
                  title="SEP-7 Payment Request QR Code"
                />
              </div>

              <div className="mt-4 rounded-xl border border-blue-100 dark:border-blue-900/40 bg-blue-50/60 dark:bg-blue-950/20 p-3 max-w-sm text-left">
                <div className="flex items-start gap-2">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                    strokeWidth={1.5}
                    stroke="currentColor"
                    className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0 mt-0.5"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z"
                    />
                  </svg>
                  <p className="text-xs text-blue-700 dark:text-blue-300">
                    If your browser does not support custom protocol handlers,
                    scan the QR code using your phone camera or Stellar wallet app.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Launch Fallback Notice */}
          {launchAttempted && (
            <div className="mt-4 p-3 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 text-xs text-amber-800 dark:text-amber-300 max-w-sm">
              Didn&apos;t open automatically? Ensure you have a SEP-7 compatible
              Stellar wallet installed, or scan the QR code above.
            </div>
          )}

          {/* Supported Wallets List */}
          <div className="mt-6 pt-6 border-t border-gray-100 dark:border-gray-800 w-full">
            <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-3">
              Supported Wallets
            </p>
            <div className="flex flex-wrap justify-center gap-2">
              {SUPPORTED_MOBILE_WALLETS.map((w) => (
                <a
                  key={w.name}
                  href={w.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
                >
                  {w.name}
                  <span className="ml-1 text-[10px] text-gray-400">
                    ({w.platform.join("/")})
                  </span>
                </a>
              ))}
            </div>
          </div>
        </div>
      </Card>

      {/* Details Card */}
      {showDetailsCard && (
        <Card className="p-6">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-4">
            Payment Parameters
          </h3>

          <div className="space-y-3 text-sm">
            <div className="flex justify-between py-1 border-b border-gray-100 dark:border-gray-800">
              <span className="text-gray-500 dark:text-gray-400">Destination</span>
              <span className="font-mono text-gray-900 dark:text-white" title={params.destination}>
                {shortenAddress(params.destination, 6)}
              </span>
            </div>

            {params.amount && (
              <div className="flex justify-between py-1 border-b border-gray-100 dark:border-gray-800">
                <span className="text-gray-500 dark:text-gray-400">Amount</span>
                <span className="font-semibold text-gray-900 dark:text-white">
                  {params.amount} {assetLabel}
                </span>
              </div>
            )}

            {params.assetIssuer && (
              <div className="flex justify-between py-1 border-b border-gray-100 dark:border-gray-800">
                <span className="text-gray-500 dark:text-gray-400">Asset Issuer</span>
                <span className="font-mono text-xs text-gray-900 dark:text-white" title={params.assetIssuer}>
                  {shortenAddress(params.assetIssuer, 6)}
                </span>
              </div>
            )}

            {params.memo && (
              <div className="flex justify-between py-1 border-b border-gray-100 dark:border-gray-800">
                <span className="text-gray-500 dark:text-gray-400">Memo</span>
                <span className="font-mono text-gray-900 dark:text-white break-all">
                  {params.memo}
                </span>
              </div>
            )}

            <div className="flex items-center justify-between pt-2">
              <span className="text-xs text-gray-400">Copy SEP-7 URI</span>
              <CopyButton value={sep7Uri} label="SEP-7 URI" />
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}
