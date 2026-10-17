"use client";
// SPDX-License-Identifier: MIT

import { useEffect, useState, useMemo, useCallback } from "react";
import QRCode from "qrcode";
import { cn } from "@/lib/utils";
import { buildSep7PayUri, type Sep7PayParams } from "@/lib/stellar-uri";

export interface QrCodeProps {
  /** The payload to encode. Takes priority if specified. */
  value?: string;
  /** Structured SEP-0007 parameters used to construct `web+stellar:pay` URI when `value` is omitted. */
  payParams?: Sep7PayParams;

  /** Shorthand payment parameters */
  destination?: string;
  amount?: string;
  assetCode?: string;
  assetIssuer?: string;
  memo?: string;
  memoType?: Sep7PayParams["memoType"];
  msg?: string;

  /** Size of the QR code preview image in pixels */
  size?: number;
  className?: string;
  /** Accessible label; also used as image alt text. */
  title?: string;

  /** When true, renders quick-copy and high-resolution PNG download buttons */
  showActions?: boolean;
  /** Layout of action buttons */
  actionsLayout?: "row" | "column";
  /** File name when downloading the QR code PNG */
  downloadFileName?: string;
  /** Target resolution width when downloading PNG */
  highResSize?: number;
}

/**
 * QR code rendered from a data URL.
 * Supports standard arbitrary strings as well as SEP-0007 `web+stellar:pay` payment requests.
 * Includes interactive high-resolution PNG download and quick-copy feedback actions.
 */
export function QrCode({
  value,
  payParams,
  destination,
  amount,
  assetCode,
  assetIssuer,
  memo,
  memoType,
  msg,
  size = 220,
  className,
  title = "QR code",
  showActions = false,
  actionsLayout = "row",
  downloadFileName = "stellar-payment-qr.png",
  highResSize = 1024,
}: QrCodeProps) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [downloading, setDownloading] = useState(false);

  // Compute final payload URI
  const resolvedValue = useMemo(() => {
    if (value !== undefined) return value;
    if (payParams) {
      try {
        return buildSep7PayUri(payParams);
      } catch {
        return "";
      }
    }
    if (destination) {
      try {
        return buildSep7PayUri({
          destination,
          amount,
          assetCode,
          assetIssuer,
          memo,
          memoType,
          msg,
        });
      } catch {
        return "";
      }
    }
    return "";
  }, [value, payParams, destination, amount, assetCode, assetIssuer, memo, memoType, msg]);

  useEffect(() => {
    let cancelled = false;
    setDataUrl(null);
    setFailed(false);

    if (!resolvedValue) {
      setFailed(true);
      return;
    }

    QRCode.toDataURL(resolvedValue, {
      width: size,
      margin: 1,
      errorCorrectionLevel: "M",
    })
      .then((url) => {
        if (!cancelled) setDataUrl(url);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });

    return () => {
      cancelled = true;
    };
  }, [resolvedValue, size]);

  const handleCopy = useCallback(async () => {
    if (!resolvedValue) return;
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard) {
        await navigator.clipboard.writeText(resolvedValue);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }
    } catch {
      // Fallback
    }
  }, [resolvedValue]);

  const handleDownload = useCallback(async () => {
    if (!resolvedValue) return;
    setDownloading(true);
    try {
      const highResUrl = await QRCode.toDataURL(resolvedValue, {
        width: highResSize,
        margin: 2,
        errorCorrectionLevel: "H",
      });

      if (typeof document !== "undefined") {
        const link = document.createElement("a");
        link.href = highResUrl;
        link.download = downloadFileName;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      }
    } catch {
      // ignore download error
    } finally {
      setDownloading(false);
    }
  }, [resolvedValue, highResSize, downloadFileName]);

  return (
    <div className="flex flex-col items-center">
      {failed ? (
        <div
          role="img"
          aria-label={`${title} — failed to generate`}
          style={{ width: size, height: size }}
          className={cn(
            "flex items-center justify-center rounded-xl border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/30 text-xs text-red-600 dark:text-red-400 text-center px-2",
            className
          )}
        >
          Couldn&apos;t generate QR code
        </div>
      ) : !dataUrl ? (
        <div
          role="status"
          aria-label="Generating QR code"
          style={{ width: size, height: size }}
          className={cn(
            "flex items-center justify-center rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900",
            className
          )}
        >
          <svg
            className="animate-spin h-6 w-6 text-gray-300 dark:text-gray-600"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
          >
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        </div>
      ) : (
        // eslint-disable-next-line @next/next/no-img-element -- QR data URLs are not optimizable via next/image
        <img
          src={dataUrl}
          alt={title}
          width={size}
          height={size}
          className={cn("rounded-xl border border-gray-200 dark:border-gray-800 shadow-sm bg-white p-2", className)}
        />
      )}

      {showActions && (
        <div
          className={cn(
            "mt-3 flex gap-2 w-full",
            actionsLayout === "column" ? "flex-col" : "flex-row justify-center"
          )}
        >
          <button
            type="button"
            onClick={handleCopy}
            disabled={!resolvedValue || failed}
            aria-label={copied ? "URI Copied" : "Copy URI"}
            className={cn(
              "inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors",
              copied
                ? "border-emerald-500 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400"
                : "border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
            )}
          >
            {copied ? (
              <>
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
                <span>Copied!</span>
              </>
            ) : (
              <>
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
                <span>Copy URI</span>
              </>
            )}
          </button>

          <button
            type="button"
            onClick={handleDownload}
            disabled={!resolvedValue || failed || downloading}
            aria-label="Download QR Image"
            className="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            <span>{downloading ? "Downloading..." : "Download QR"}</span>
          </button>
        </div>
      )}
    </div>
  );
}
