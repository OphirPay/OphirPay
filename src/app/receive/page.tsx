"use client";
// SPDX-License-Identifier: MIT

import { useState, useMemo, useCallback, useRef, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { useWallet } from "@/hooks/useMultiWallet";
import { usePageTitle } from "@/hooks/usePageTitle";
import { PAGE_TITLES } from "@/lib/page-titles";
import { isValidStellarAddress } from "@/lib/stellar";
import { generateSep7PayUri, generateQrSvg, type Sep7MemoType } from "@/lib/qr";
import { CopyButton } from "@/components/ui/CopyButton";
import { Breadcrumb } from "@/components/Breadcrumb";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { shortenAddress } from "@/lib/utils";
import { QrCodeIcon, DownloadIcon, WalletIcon } from "@/components/ui/Icon";
import { WalletButton } from "@/components/WalletButton";

export default function ReceivePage() {
  return (
    <Suspense fallback={null}>
      <ReceivePageClient />
    </Suspense>
  );
}

function ReceivePageClient() {
  usePageTitle(PAGE_TITLES.RECEIVE);
  const { wallet } = useWallet();
  const searchParams = useSearchParams();

  // Form options for custom payment requests
  const [amount, setAmount] = useState<string>(searchParams?.get("amount") || "");
  const [assetCode, setAssetCode] = useState<string>(searchParams?.get("asset") || "XLM");
  const [assetIssuer, setAssetIssuer] = useState<string>(searchParams?.get("issuer") || "");
  const [memo, setMemo] = useState<string>(searchParams?.get("memo") || "");
  const [memoType, setMemoType] = useState<Sep7MemoType>("MEMO_TEXT");
  const [message, setMessage] = useState<string>(searchParams?.get("msg") || "");
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Manual fallback address for testing or viewing unlinked address
  const [manualAddress, setManualAddress] = useState("");

  const activeAddress = useMemo(() => {
    if (wallet.connected && wallet.publicKey) {
      return wallet.publicKey;
    }
    if (manualAddress && isValidStellarAddress(manualAddress)) {
      return manualAddress;
    }
    return null;
  }, [wallet.connected, wallet.publicKey, manualAddress]);

  // Compute SEP-0007 URI payload
  const sep7Uri = useMemo(() => {
    if (!activeAddress) return "";
    try {
      return generateSep7PayUri({
        destination: activeAddress,
        amount: amount || undefined,
        assetCode: assetCode || undefined,
        assetIssuer: assetIssuer || undefined,
        memo: memo || undefined,
        memoType: memo ? memoType : undefined,
        msg: message || undefined,
      });
    } catch {
      return "";
    }
  }, [activeAddress, amount, assetCode, assetIssuer, memo, memoType, message]);

  // Compute QR code SVG representation
  const qrSvgString = useMemo(() => {
    if (!sep7Uri) return "";
    try {
      return generateQrSvg(sep7Uri, {
        size: 260,
        margin: 4,
        fgColor: "#0f172a",
        bgColor: "#ffffff",
        title: `Receive Stellar Payment - ${activeAddress ? shortenAddress(activeAddress) : ""}`,
      });
    } catch {
      return "";
    }
  }, [sep7Uri, activeAddress]);

  // Web payment link URL
  const paymentLinkUrl = useMemo(() => {
    if (!activeAddress) return "";
    const base = typeof window !== "undefined" ? window.location.origin : "https://ophirpay.vercel.app";
    const url = new URL(`/send`, base);
    url.searchParams.set("destination", activeAddress);
    if (amount) url.searchParams.set("amount", amount);
    if (memo) url.searchParams.set("memo", memo);
    if (assetCode && assetCode.toUpperCase() !== "XLM") url.searchParams.set("asset", assetCode);
    return url.toString();
  }, [activeAddress, amount, memo, assetCode]);

  // Download QR Code as SVG
  const handleDownloadSvg = useCallback(() => {
    if (!qrSvgString) return;
    const blob = new Blob([qrSvgString], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `stellar-receive-qr-${activeAddress?.slice(0, 8) || "address"}.svg`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, [qrSvgString, activeAddress]);

  // Download QR Code as PNG
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const handleDownloadPng = useCallback(() => {
    if (!qrSvgString) return;
    const img = new Image();
    const svgBlob = new Blob([qrSvgString], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(svgBlob);

    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = 512;
      canvas.height = 512;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, 512, 512);
        ctx.drawImage(img, 0, 0, 512, 512);
        const pngUrl = canvas.toDataURL("image/png");
        const link = document.createElement("a");
        link.href = pngUrl;
        link.download = `stellar-receive-qr-${activeAddress?.slice(0, 8) || "address"}.png`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      }
      URL.revokeObjectURL(url);
    };
    img.src = url;
  }, [qrSvgString, activeAddress]);

  return (
    <div className="space-y-6 max-w-5xl mx-auto p-4 md:p-6">
      <Breadcrumb items={[{ label: "Receive" }]} />

      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-gray-900 dark:text-white">
            Receive Payment
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Share your Stellar address or display your SEP-0007 QR code to receive XLM and custom tokens.
          </p>
        </div>

        {wallet.connected && wallet.publicKey && (
          <div className="flex items-center gap-2">
            <Badge variant="success">Wallet Connected</Badge>
          </div>
        )}
      </div>

      {!wallet.connected && !manualAddress && (
        <Card className="border-dashed border-2 border-gray-300 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-900/50">
          <div className="p-8 text-center space-y-4">
            <div className="mx-auto w-12 h-12 rounded-full bg-blue-100 dark:bg-blue-900/40 flex items-center justify-center text-blue-600 dark:text-blue-400">
              <WalletIcon className="w-6 h-6" />
            </div>
            <div className="max-w-md mx-auto space-y-1">
              <h3 className="text-base font-medium text-gray-900 dark:text-white">
                Connect your Stellar wallet
              </h3>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                Connect Freighter, Albedo, xBull, or another supported wallet to generate your personal receive QR code.
              </p>
            </div>
            <div className="flex justify-center pt-2">
              <WalletButton />
            </div>

            <div className="pt-6 border-t border-gray-200 dark:border-gray-800 max-w-sm mx-auto">
              <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">
                Or enter a Stellar public address manually:
              </p>
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="G... or M..."
                  value={manualAddress}
                  onChange={(e) => setManualAddress(e.target.value)}
                  className="flex-1 px-3 py-1.5 text-xs font-mono rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:outline-none"
                />
              </div>
            </div>
          </div>
        </Card>
      )}

      {activeAddress && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Left Column: QR Code & Quick Actions */}
          <div className="lg:col-span-5 flex flex-col items-center">
            <Card className="w-full flex flex-col items-center p-6 text-center shadow-sm">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 text-xs font-semibold mb-4">
                <QrCodeIcon className="w-4 h-4" />
                <span>SEP-0007 Pay QR Code</span>
              </div>

              {/* QR Code Container */}
              <div
                data-testid="qr-code-container"
                className="p-4 bg-white rounded-xl shadow-inner border border-gray-200 dark:border-gray-700 inline-block transition-transform duration-200 hover:scale-[1.02]"
              >
                {qrSvgString ? (
                  <div
                    dangerouslySetInnerHTML={{ __html: qrSvgString }}
                    className="w-[240px] h-[240px] flex items-center justify-center"
                    aria-label="SEP-7 Payment QR Code"
                  />
                ) : (
                  <div className="w-[240px] h-[240px] flex items-center justify-center text-sm text-gray-400">
                    Generating QR...
                  </div>
                )}
              </div>

              {/* Connected Address Display */}
              <div className="mt-4 w-full space-y-2">
                <span className="text-xs font-medium text-gray-500 dark:text-gray-400">
                  Account Public Key
                </span>
                <div className="flex items-center justify-between gap-2 p-2.5 rounded-lg bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-800">
                  <span
                    data-testid="receive-address"
                    className="font-mono text-xs text-gray-800 dark:text-gray-200 truncate select-all"
                    title={activeAddress}
                  >
                    {shortenAddress(activeAddress, 10)}
                  </span>
                  <CopyButton value={activeAddress} label="Address" />
                </div>
              </div>

              {/* Download Buttons */}
              <div className="flex items-center gap-2 mt-4 w-full">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleDownloadSvg}
                  className="flex-1 inline-flex items-center justify-center gap-1.5 text-xs"
                >
                  <DownloadIcon className="w-3.5 h-3.5" />
                  SVG
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleDownloadPng}
                  className="flex-1 inline-flex items-center justify-center gap-1.5 text-xs"
                >
                  <DownloadIcon className="w-3.5 h-3.5" />
                  PNG
                </Button>
              </div>
            </Card>
          </div>

          {/* Right Column: Customization Form & SEP-7 Payload */}
          <div className="lg:col-span-7 space-y-6">
            <Card
              title="Payment Request Details (Optional)"
              subtitle="Specify an amount, memo, or token to embed into the SEP-0007 QR code payload."
            >
              <div className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label
                      htmlFor="receive-amount"
                      className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1"
                    >
                      Requested Amount
                    </label>
                    <input
                      id="receive-amount"
                      type="number"
                      step="any"
                      min="0"
                      placeholder="0.00"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      className="w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:outline-none"
                    />
                  </div>

                  <div>
                    <label
                      htmlFor="receive-asset"
                      className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1"
                    >
                      Asset / Token
                    </label>
                    <select
                      id="receive-asset"
                      value={assetCode}
                      onChange={(e) => setAssetCode(e.target.value)}
                      className="w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:outline-none"
                    >
                      <option value="XLM">XLM (Native)</option>
                      <option value="USDC">USDC</option>
                      <option value="CUSTOM">Custom Asset...</option>
                    </select>
                  </div>
                </div>

                {assetCode === "CUSTOM" && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t border-gray-100 dark:border-gray-800">
                    <div>
                      <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                        Asset Code
                      </label>
                      <input
                        type="text"
                        placeholder="e.g. BTC, ETH"
                        value={assetCode === "CUSTOM" ? "" : assetCode}
                        onChange={(e) => setAssetCode(e.target.value.toUpperCase())}
                        className="w-full px-3 py-2 text-sm font-mono rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                        Issuer Public Key
                      </label>
                      <input
                        type="text"
                        placeholder="G..."
                        value={assetIssuer}
                        onChange={(e) => setAssetIssuer(e.target.value)}
                        className="w-full px-3 py-2 text-sm font-mono rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:outline-none"
                      />
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div className="sm:col-span-2">
                    <label
                      htmlFor="receive-memo"
                      className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1"
                    >
                      Memo
                    </label>
                    <input
                      id="receive-memo"
                      type="text"
                      placeholder="e.g. invoice-482 or order ID"
                      value={memo}
                      onChange={(e) => setMemo(e.target.value)}
                      className="w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:outline-none"
                    />
                  </div>

                  <div>
                    <label
                      htmlFor="receive-memo-type"
                      className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1"
                    >
                      Memo Type
                    </label>
                    <select
                      id="receive-memo-type"
                      value={memoType}
                      onChange={(e) => setMemoType(e.target.value as Sep7MemoType)}
                      className="w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:outline-none"
                    >
                      <option value="MEMO_TEXT">MEMO_TEXT</option>
                      <option value="MEMO_ID">MEMO_ID</option>
                      <option value="MEMO_HASH">MEMO_HASH</option>
                      <option value="MEMO_RETURN">MEMO_RETURN</option>
                    </select>
                  </div>
                </div>

                <div>
                  <button
                    type="button"
                    onClick={() => setShowAdvanced(!showAdvanced)}
                    className="text-xs text-blue-600 dark:text-blue-400 hover:underline inline-flex items-center gap-1"
                  >
                    {showAdvanced ? "Hide message" : "+ Add payer message"}
                  </button>
                  {showAdvanced && (
                    <div className="mt-2">
                      <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                        Payer Note / Message
                      </label>
                      <input
                        type="text"
                        placeholder="e.g. Thanks for your business!"
                        value={message}
                        onChange={(e) => setMessage(e.target.value)}
                        className="w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:outline-none"
                      />
                    </div>
                  )}
                </div>
              </div>
            </Card>

            {/* Live SEP-0007 Payload & Payment Links */}
            <Card
              title="Encoded SEP-0007 URI"
              subtitle="Standard URI compatible with Stellar wallets (Lobstr, Freighter, Solar, Albedo)."
            >
              <div className="space-y-3">
                <div className="p-3 rounded-lg bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-800 font-mono text-xs text-gray-700 dark:text-gray-300 break-all select-all flex items-center justify-between gap-2">
                  <span data-testid="sep7-uri-text" className="truncate">{sep7Uri}</span>
                  <CopyButton value={sep7Uri} label="SEP-7 URI" />
                </div>

                <div className="pt-2 border-t border-gray-100 dark:border-gray-800">
                  <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400 mb-1">
                    <span>Direct OphirPay Web Link</span>
                    <CopyButton value={paymentLinkUrl} label="Web Link" />
                  </div>
                  <div className="p-2 rounded bg-gray-50 dark:bg-gray-900 font-mono text-xs text-gray-600 dark:text-gray-400 truncate">
                    {paymentLinkUrl}
                  </div>
                </div>
              </div>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
