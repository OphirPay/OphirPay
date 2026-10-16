"use client";
// SPDX-License-Identifier: MIT

import { useMemo, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { QrCode } from "@/components/ui/QrCode";
import { CopyButton } from "@/components/ui/CopyButton";
import { generateSep7PayUri } from "@/lib/stellar-uri";
import { generatePaymentLink } from "@/lib/payment-link";
import { formatAmount } from "@/lib/utils";

export interface PaymentRequestItem {
  id: string;
  amount: number | string;
  assetCode: string;
  assetIssuer?: string;
  description?: string;
  recipientAddress?: string;
}

interface PaymentRequestModalProps {
  open: boolean;
  onClose: () => void;
  request: PaymentRequestItem | null;
  defaultWalletAddress?: string;
}

export function PaymentRequestModal({
  open,
  onClose,
  request,
  defaultWalletAddress = "",
}: PaymentRequestModalProps) {
  const [activeTab, setActiveTab] = useState<"sep7" | "weblink">("sep7");

  const destination = request?.recipientAddress || defaultWalletAddress;

  // SEP-0007 compliant payment URI for mobile wallets (Lobstr, Vibrant, etc.)
  const sep7Uri = useMemo(() => {
    if (!request || !destination) return "";
    try {
      return generateSep7PayUri({
        destination,
        amount: request.amount,
        assetCode: request.assetCode,
        assetIssuer: request.assetIssuer,
        memo: request.description ? request.description.slice(0, 28) : undefined,
        msg: request.description,
      });
    } catch {
      return "";
    }
  }, [request, destination]);

  // OphirPay internal web link (/pay/[address])
  const webLink = useMemo(() => {
    if (!request || !destination) return "";
    try {
      const link = generatePaymentLink({
        destination,
        amount: request.amount.toString(),
        assetCode: request.assetCode,
        message: request.description,
      });
      const url = new URL(link);
      url.searchParams.set("requestId", request.id);
      return url.toString();
    } catch {
      return "";
    }
  }, [request, destination]);

  if (!request) return null;

  const currentPayload = activeTab === "sep7" ? sep7Uri : webLink;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Payment QR Code"
      description="Scan to pay with any Stellar mobile wallet"
      size="sm"
      footer={
        <button
          type="button"
          onClick={onClose}
          className="px-5 py-2.5 rounded-lg bg-ophir-600 text-white text-sm font-medium hover:bg-ophir-700 transition-colors mx-auto"
        >
          Done
        </button>
      }
    >
      <div className="space-y-4 text-center">
        {/* Format Selector Tabs */}
        <div className="flex p-1 bg-gray-100 dark:bg-gray-800 rounded-lg text-xs font-medium">
          <button
            type="button"
            onClick={() => setActiveTab("sep7")}
            className={`flex-1 py-1.5 rounded-md transition-colors ${
              activeTab === "sep7"
                ? "bg-white dark:bg-gray-700 text-ophir-600 dark:text-ophir-400 shadow-sm"
                : "text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
            }`}
          >
            Stellar Wallet (SEP-0007)
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("weblink")}
            className={`flex-1 py-1.5 rounded-md transition-colors ${
              activeTab === "weblink"
                ? "bg-white dark:bg-gray-700 text-ophir-600 dark:text-ophir-400 shadow-sm"
                : "text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
            }`}
          >
            Web Payment Link
          </button>
        </div>

        {/* QR Code Container with High-Res Download and Copy */}
        <div className="py-2">
          <QrCode
            value={currentPayload}
            size={220}
            allowDownload
            downloadFilename={`ophirpay-${activeTab}-${request.id.slice(0, 8)}.png`}
            showCopy
            title={`Payment QR Code for ${request.amount} ${request.assetCode}`}
          />
        </div>

        {/* Amount & Description details */}
        <div>
          <p className="text-xl font-bold text-gray-900 dark:text-white">
            {formatAmount(Number(request.amount), request.assetCode)}
          </p>
          {request.description && (
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              {request.description}
            </p>
          )}
          <p className="text-xs text-gray-400 dark:text-gray-500 font-mono mt-1 truncate max-w-[280px] mx-auto">
            To: {destination}
          </p>
        </div>

        {/* Raw Payload preview & quick copy */}
        <div className="flex items-center justify-center gap-2 p-2 bg-gray-50 dark:bg-gray-900/60 rounded-lg border border-gray-200 dark:border-gray-800">
          <code className="text-xs font-mono text-gray-500 dark:text-gray-400 truncate max-w-[230px]">
            {currentPayload}
          </code>
          <CopyButton value={currentPayload} label={activeTab === "sep7" ? "SEP-7 URI" : "Payment Link"} />
        </div>
      </div>
    </Modal>
  );
}
