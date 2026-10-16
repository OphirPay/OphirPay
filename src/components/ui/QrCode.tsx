"use client";
// SPDX-License-Identifier: MIT

import { useCallback, useEffect, useMemo, useState } from "react";
import QRCode from "qrcode";
import { cn } from "@/lib/utils";
import { CopyButton } from "@/components/ui/CopyButton";
import { generateSep7PayUri, type Sep7PayParams } from "@/lib/stellar-uri";

export interface QrCodeProps {
  /** The payload to encode. If omitted, sep7Params will be used. */
  value?: string;
  /** Parameters to generate a SEP-0007 compliant `web+stellar:pay` URI. */
  sep7Params?: Sep7PayParams;
  size?: number;
  className?: string;
  /** Accessible label; also used as the image alt text. */
  title?: string;
  /** Whether to show a high-resolution download button. */
  allowDownload?: boolean;
  /** Filename for high-res download (default: 'stellar-pay-qr.png'). */
  downloadFilename?: string;
  /** Whether to show a quick-copy button for the URI. */
  showCopy?: boolean;
}

/**
 * QR code rendered client-side via `qrcode` data URLs.
 * Supports SEP-0007 pay URI generation, high-res PNG download, and quick copy.
 */
export function QrCode({
  value,
  sep7Params,
  size = 220,
  className,
  title = "QR code",
  allowDownload = false,
  downloadFilename = "stellar-pay-qr.png",
  showCopy = false,
}: QrCodeProps) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [downloading, setDownloading] = useState(false);

  // Compute final payload: either direct value or generated SEP-7 URI
  const finalValue = useMemo(() => {
    if (value) return value;
    if (sep7Params) {
      try {
        return generateSep7PayUri(sep7Params);
      } catch {
        return "";
      }
    }
    return "";
  }, [value, sep7Params]);

  useEffect(() => {
    let cancelled = false;
    setDataUrl(null);
    setFailed(false);

    if (!finalValue) {
      return;
    }

    QRCode.toDataURL(finalValue, {
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
  }, [finalValue, size]);

  const handleDownload = useCallback(async () => {
    if (!finalValue) return;
    setDownloading(true);
    try {
      // Generate a crisp, high-resolution PNG (1024x1024)
      const highResUrl = await QRCode.toDataURL(finalValue, {
        width: 1024,
        margin: 2,
        errorCorrectionLevel: "H",
      });
      const link = document.createElement("a");
      link.href = highResUrl;
      link.download = downloadFilename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch {
      // Fallback to dataUrl if high-res generation fails
      if (dataUrl) {
        const link = document.createElement("a");
        link.href = dataUrl;
        link.download = downloadFilename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      }
    } finally {
      setDownloading(false);
    }
  }, [finalValue, downloadFilename, dataUrl]);

  if (failed || (!finalValue && !dataUrl)) {
    return (
      <div
        role="img"
        aria-label={`${title} — failed to generate`}
        style={{ width: size, height: size }}
        className={cn(
          "flex items-center justify-center rounded-xl border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/30 text-xs text-red-600 dark:text-red-400 p-2 text-center",
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
    <div className="flex flex-col items-center gap-2">
      <div className="bg-white p-2 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm inline-block">
        {/* eslint-disable-next-line @next/next/no-img-element -- QR data URLs are not optimizable via next/image */}
        <img
          src={dataUrl}
          alt={title}
          width={size}
          height={size}
          className={cn("rounded-lg", className)}
        />
      </div>

      {(allowDownload || showCopy) && (
        <div className="flex items-center gap-2 mt-1">
          {allowDownload && (
            <button
              type="button"
              onClick={handleDownload}
              disabled={downloading}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
              title="Download high-resolution PNG"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={1.5}
                stroke="currentColor"
                className="w-3.5 h-3.5"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.5V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3"
                />
              </svg>
              {downloading ? "Saving..." : "Download QR"}
            </button>
          )}

          {showCopy && finalValue && (
            <CopyButton value={finalValue} label="URI" />
          )}
        </div>
      )}
    </div>
  );
}
