"use client";
// SPDX-License-Identifier: MIT

import { useMemo } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { CopyButton } from "@/components/ui/CopyButton";
import { QrCode } from "@/components/ui/QrCode";
import {
  buildSep7PayUri,
  type Sep7PayParams,
} from "@/lib/stellar-uri";

/**
 * The subset of a payment request needed to build a SEP-7 payload.
 *
 * Deliberately independent of the Prisma/API record shape: the modal is a
 * presentation component, and the caller decides how a stored request maps
 * onto these fields.
 */
export interface PaymentRequestDetails {
  /** Request id; used only to name the downloaded QR file. */
  id?: string;
  /** Recipient Stellar account (G…). Required for a valid SEP-7 URI. */
  destination: string;
  /** Amount in the asset's display units (e.g. "12.5"). */
  amount?: string;
  /** Asset code; omit or "XLM" for native. */
  assetCode?: string;
  /** Issuer of a non-native asset. Required by SEP-7 for wallets to resolve it. */
  assetIssuer?: string;
  /** Optional transaction memo. */
  memo?: string;
  memoType?: Sep7PayParams["memoType"];
  /** Human-readable note shown to the payer (`msg`). */
  description?: string;
}

interface PaymentRequestModalProps {
  open: boolean;
  onClose: () => void;
  request: PaymentRequestDetails | null;
  /**
   * Optional browser share link. Shown alongside the QR so a merchant can
   * send the request to a remote payer; the QR itself always encodes the
   * wallet-native SEP-7 URI.
   */
  paymentLink?: string;
}

/**
 * Payment-request QR modal (#1375).
 *
 * The previous flow embedded a third-party QR image service, which meant the
 * recipient address, amount and memo were sent to an external host — and the
 * encoded payload was an https link rather than a URI wallets understand. This
 * modal builds a SEP-7 `web+stellar:pay` payload locally (see
 * `buildSep7PayUri`) and renders it in-browser, so nothing leaves the device.
 */
export function PaymentRequestModal({
  open,
  onClose,
  request,
  paymentLink,
}: PaymentRequestModalProps) {
  const { uri, error, missingIssuer } = useMemo(() => {
    if (!request) {
      return { uri: null, error: null, missingIssuer: false };
    }

    const assetCode = request.assetCode?.toUpperCase();
    const isNative = !assetCode || assetCode === "XLM";

    try {
      return {
        uri: buildSep7PayUri({
          destination: request.destination,
          amount: request.amount,
          assetCode: isNative ? undefined : assetCode,
          assetIssuer: isNative ? undefined : request.assetIssuer,
          memo: request.memo,
          memoType: request.memoType,
          msg: request.description,
        }),
        error: null,
        // SEP-7 requires an issuer to disambiguate a non-native asset. Without
        // one the URI is syntactically valid but a wallet cannot know which
        // USDC (for example) is being requested.
        missingIssuer: !isNative && !request.assetIssuer,
      };
    } catch {
      return {
        uri: null,
        error:
          "This request does not have a valid Stellar recipient address, so a payment QR cannot be generated.",
        missingIssuer: false,
      };
    }
  }, [request]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Payment QR code"
      description="Scan with any SEP-7 compatible Stellar wallet"
      size="sm"
      footer={<Button onClick={onClose}>Done</Button>}
    >
      {request && (
        <div className="space-y-4 text-center">
          {(request.amount || request.assetCode) && (
            <p className="text-lg font-bold text-gray-900 dark:text-white">
              {request.amount ? `${request.amount} ` : ""}
              {(request.assetCode || "XLM").toUpperCase()}
            </p>
          )}
          {request.description && (
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {request.description}
            </p>
          )}

          {uri ? (
            <>
              <div className="inline-block rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700">
                <QrCode
                  value={uri}
                  size={240}
                  title="SEP-7 payment QR code"
                  showActions
                  downloadFileName={`ophirpay-request-${request.id ?? "payment"}.png`}
                />
              </div>

              <div className="space-y-1 text-left">
                <p className="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
                  SEP-7 payment URI
                </p>
                <div className="flex items-center gap-2">
                  <code className="min-w-0 flex-1 truncate rounded-lg bg-gray-50 px-2 py-1.5 font-mono text-xs text-gray-600 dark:bg-gray-800 dark:text-gray-300">
                    {uri}
                  </code>
                  <CopyButton value={uri} label="Copy URI" title="Copy payment URI" />
                </div>
              </div>

              {missingIssuer && (
                <p
                  role="status"
                  className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-left text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200"
                >
                  This request uses a custom asset without an issuer. Wallets
                  need the issuer to identify the asset, so scanning may fail
                  until the request includes one.
                </p>
              )}
            </>
          ) : (
            <p
              role="alert"
              className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/30 dark:text-red-300"
            >
              {error}
            </p>
          )}

          {paymentLink && (
            <div className="space-y-1 border-t border-gray-100 pt-3 text-left dark:border-gray-800">
              <p className="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
                Shareable link
              </p>
              <div className="flex items-center gap-2">
                <code className="min-w-0 flex-1 truncate font-mono text-xs text-gray-500 dark:text-gray-400">
                  {paymentLink}
                </code>
                <CopyButton value={paymentLink} label="Copy link" />
              </div>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
