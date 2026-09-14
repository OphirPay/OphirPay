"use client";
// SPDX-License-Identifier: MIT


import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { cn } from "@/lib/utils";

interface QrCodeProps {
  /** The payload to encode. The QR regenerates whenever this changes. */
  value: string;
  size?: number;
  className?: string;
  /** Accessible label; also used as the image alt text. */
  title?: string;
}

/**
 * QR code rendered from a data URL.
 *
 * Generates the code client-side via the `qrcode` package (browser build —
 * no external API calls, works offline) and regenerates whenever `value`
 * changes. Shows a small loading placeholder and a graceful error state
 * instead of breaking the layout.
 */
export function QrCode({ value, size = 220, className, title = "QR code" }: QrCodeProps) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

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
    // eslint-disable-next-line @next/next/no-img-element -- QR data URLs are not optimizable via next/image
    <img
      src={dataUrl}
      alt={title}
      width={size}
      height={size}
      className={cn("rounded-xl", className)}
    />
  );
}
