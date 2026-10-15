"use client";
// SPDX-License-Identifier: MIT

import { useCallback, useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { cn } from "@/lib/utils";

// ── Payment mode types ─────────────────────────────────────────

export interface PaymentQrParams {
  /** Destination Stellar address (G...) */
  destination: string;
  /** Amount in the asset's base units */
  amount?: string;
  /** Asset code; defaults to XLM (native) when omitted or "XLM" */
  assetCode?: string;
  /** Asset issuer for non-native assets */
  assetIssuer?: string;
  /** Optional transaction memo */
  memo?: string;
}

// ── Component props ────────────────────────────────────────────

interface BaseQrProps {
  size?: number;
  className?: string;
  /** Accessible label; also used as the image alt text. */
  title?: string;
}

interface PlainQrProps extends BaseQrProps {
  /** The payload to encode. The QR regenerates whenever this changes. */
  value: string;
}

interface PaymentQrProps extends BaseQrProps {
  /** Payment parameters — builds a SEP-7 web+stellar:pay URI */
  payment: PaymentQrParams;
  /** Show action buttons (Download QR Image, Copy URI) below the QR */
  showActions?: boolean;
}

export type QrCodeProps = PlainQrProps | PaymentQrProps;

function isPaymentMode(props: QrCodeProps): props is PaymentQrProps {
  return "payment" in props;
}

/**
 * QR code rendered from a data URL.
 *
 * Generates the code client-side via the `qrcode` package (browser build —
 * no external API calls, works offline) and regenerates whenever `value`
 * or `payment` changes. Shows a small loading placeholder and a graceful
 * error state instead of breaking the layout.
 *
 * When `payment` is provided, the component encodes a SEP-7
 * `web+stellar:pay` URI via `buildSep7PayUri`, and optionally shows
 * "Download QR Image" and "Copy URI" buttons below the QR.
 */
export function QrCode(props: QrCodeProps) {
  const size = props.size ?? 220;
  const className = props.className;
  const title = props.title ?? "QR code";

  const [uri, setUri] = useState<string | null>(null);
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [copied, setCopied] = useState(false);
  const dataUrlRef = useRef<string | null>(null);

  // Build SEP-7 URI in payment mode; in plain mode use value directly
  useEffect(() => {
    if (!isPaymentMode(props)) {
      setUri(props.value);
      return;
    }
    // Lazy import to keep the SEP-7 builder out of the plain-QR bundle
    import("@/lib/stellar-uri")
      .then(({ buildSep7PayUri }) => {
        try {
          const built = buildSep7PayUri({
            destination: props.payment.destination,
            amount: props.payment.amount,
            memo: props.payment.memo,
            assetCode: props.payment.assetCode,
            assetIssuer: props.payment.assetIssuer,
          });
          setUri(built);
        } catch {
          setFailed(true);
        }
      })
      .catch(() => setFailed(true));
  }, [props.value, props.payment]);

  // Generate QR data URL whenever the URI or size changes
  useEffect(() => {
    if (!uri) {
      setDataUrl(null);
      dataUrlRef.current = null;
      return;
    }
    let cancelled = false;
    setDataUrl(null);
    setFailed(false);

    QRCode.toDataURL(uri, {
      width: size,
      margin: 1,
      errorCorrectionLevel: "M",
    })
      .then((url) => {
        if (!cancelled) {
          setDataUrl(url);
          dataUrlRef.current = url;
        }
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });

    return () => {
      cancelled = true;
    };
  }, [uri, size]);

  const handleDownload = useCallback(async () => {
    if (!dataUrlRef.current) return;
    try {
      const blob = await (await fetch(dataUrlRef.current)).blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `qr-${isPaymentMode(props) ? "payment" : "code"}-${Date.now()}.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      // Silently fail — user can still use the Copy URI button
    }
  }, [props]);

  const handleCopyUri = useCallback(async () => {
    if (!uri) return;
    try {
      await navigator.clipboard.writeText(uri);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }, [uri]);

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

  const showActions = isPaymentMode(props) && (props.showActions ?? false);

  return (
    <div className="flex flex-col items-center gap-3">
      {/* QR image / placeholder */}
      {!dataUrl ? (
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
          className={cn("rounded-xl", className)}
        />
      )}

      {/* Action buttons for payment mode */}
      {showActions && dataUrl && (
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleDownload}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700 hover:text-gray-900 dark:hover:text-white transition-colors"
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
                d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3"
              />
            </svg>
            Download QR Image
          </button>
          <button
            type="button"
            onClick={handleCopyUri}
            className={cn(
              "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors",
              copied
                ? "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400"
                : "bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700 hover:text-gray-900 dark:hover:text-white"
            )}
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
                d="M15.75 17.25v3.375c0 .621-.504 1.125-1.125 1.125h-9.75a1.125 1.125 0 01-1.125-1.125V7.875c0-.621.504-1.125 1.125-1.125H6.75a9.06 9.06 0 011.5.124m7.5 10.376h3.375c.621 0 1.125-.504 1.125-1.125V11.25c0-4.46-3.243-8.161-7.5-8.876a9.06 9.06 0 00-1.5-.124H9.375c-.621 0-1.125.504-1.125 1.125v3.5m7.5 10.375H9.375a1.125 1.125 0 01-1.125-1.125v-9.25m12 6.625v-1.875a3.375 3.375 0 00-3.375-3.375h-1.5a1.125 1.125 0 01-1.125-1.125v-1.5a3.375 3.375 0 00-3.375-3.375H9.75"
              />
            </svg>
            {copied ? "Copied!" : "Copy URI"}
          </button>
        </div>
      )}
    </div>
  );
}
