"use client";
// SPDX-License-Identifier: MIT


import { useCallback, useEffect, useState } from "react";
import QRCode from "qrcode";
import { cn } from "@/lib/utils";
import { CopyButton } from "@/components/ui/CopyButton";

interface QrCodeProps {
  /** The payload to encode. The QR regenerates whenever this changes. */
  value: string;
  size?: number;
  className?: string;
  /** Accessible label; also used as the image alt text. */
  title?: string;
  /**
   * Render "Download PNG" and "Copy URI" actions below the code.
   *
   * Used by the payment-request modal (#1375), where a merchant needs to save
   * a print-quality code or paste the SEP-7 URI into another channel.
   */
  showActions?: boolean;
  /** Filename for the downloaded PNG. Defaults to `qr-code.png`. */
  downloadFileName?: string;
  /**
   * Width of the downloaded PNG, in pixels. The on-screen code stays at
   * `size`; the file is rendered separately at this resolution so it remains
   * sharp when printed, without inflating the display payload.
   */
  downloadSize?: number;
}

/**
 * QR code rendered from a data URL.
 *
 * Generates the code client-side via the `qrcode` package (browser build —
 * no external API calls, works offline) and regenerates whenever `value`
 * changes. Shows a small loading placeholder and a graceful error state
 * instead of breaking the layout.
 */
export function QrCode({
  value,
  size = 220,
  className,
  title = "QR code",
  showActions = false,
  downloadFileName = "qr-code.png",
  downloadSize = 1024,
}: QrCodeProps) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setDataUrl(null);
    setFailed(false);

    QRCode.toDataURL(value, {
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
  }, [value, size]);

  const handleDownload = useCallback(async () => {
    if (!dataUrl || downloading) return;
    setDownloading(true);

    let href = dataUrl;
    try {
      // Re-render at print resolution rather than scaling the display PNG,
      // which would hand the user a blurry 220px square.
      href = await QRCode.toDataURL(value, {
        width: downloadSize,
        margin: 2,
        errorCorrectionLevel: "M",
      });
    } catch {
      // Fall back to the already-rendered code — a smaller file is better
      // than a failed download.
    }

    try {
      const link = document.createElement("a");
      link.href = href;
      link.download = downloadFileName;
      link.rel = "noopener";
      document.body.appendChild(link);
      link.click();
      link.remove();
    } finally {
      setDownloading(false);
    }
  }, [dataUrl, value, downloadSize, downloadFileName, downloading]);

  if (failed) {
    return (
      <div
        role="img"
        aria-label={`${title} — failed to generate`}
        style={{ width: size, height: size }}
        className={cn(
          "flex items-center justify-center rounded-xl border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/30 text-xs text-red-600 dark:text-red-400",
          className
        )}
      >
        Couldn&apos;t generate QR code
      </div>
    );
  }

  if (!dataUrl) {
    return (
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
    );
  }

  return (
    <div className="inline-flex flex-col items-center gap-3">
      {/* eslint-disable-next-line @next/next/no-img-element -- QR data URLs are not optimizable via next/image */}
      <img
        src={dataUrl}
        alt={title}
        width={size}
        height={size}
        className={cn("rounded-xl", className)}
      />

      {showActions && (
        <div className="flex flex-wrap items-center justify-center gap-2">
          <button
            type="button"
            onClick={() => void handleDownload()}
            disabled={downloading}
            className={cn(
              "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium",
              "bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-200",
              "hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors",
              "disabled:opacity-50 disabled:cursor-not-allowed"
            )}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={1.5}
              stroke="currentColor"
              className="w-3.5 h-3.5"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3"
              />
            </svg>
            {downloading ? "Preparing…" : "Download PNG"}
          </button>
          <CopyButton value={value} label="Copy URI" title="Copy payment URI" />
        </div>
      )}
    </div>
  );
}
