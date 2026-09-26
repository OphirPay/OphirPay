"use client";
// SPDX-License-Identifier: MIT

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { FiatOnRampModal } from "@/components/fiat/FiatOnRampModal";
import { useWallet } from "@/hooks/useMultiWallet";
import { shortenAddress } from "@/lib/utils";

export default function FiatRampPage() {
  const { wallet } = useWallet();
  const [modalOpen, setModalOpen] = useState(false);
  const [initialKind, setInitialKind] = useState<"deposit" | "withdrawal">("deposit");

  const openDeposit = () => {
    setInitialKind("deposit");
    setModalOpen(true);
  };

  const openWithdraw = () => {
    setInitialKind("withdrawal");
    setModalOpen(true);
  };

  return (
    <div className="space-y-6 animate-fade-in max-w-4xl mx-auto py-4">
      <div>
        <Link href="/" className="text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 transition-colors">
          ← Dashboard
        </Link>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mt-2">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Fiat On & Off-Ramp</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              Deposit fiat to acquire USDC or XLM on Stellar, or withdraw crypto to your bank account via SEP-24 anchors.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="success">SEP-24 Protocol</Badge>
            <Badge variant="primary">Non-Custodial</Badge>
          </div>
        </div>
      </div>

      {/* Main Action Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* On-Ramp Card */}
        <Card className="p-6 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-3">
              <span className="text-2xl">💳</span>
              <Badge variant="success">Instant Settlement</Badge>
            </div>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
              Deposit (Fiat → Crypto)
            </h2>
            <p className="text-sm text-gray-600 dark:text-gray-300 mb-4">
              Fund your Stellar account using a debit card, bank transfer, ACH, or SEPA through regulated anchors.
            </p>
            <ul className="text-xs text-gray-500 space-y-1.5 mb-6">
              <li>• Supported assets: <strong>USDC, XLM, EURC</strong></li>
              <li>• KYC handled securely by third-party anchor</li>
              <li>• Automated deposit sync into your OphirPay payment ledger</li>
            </ul>
          </div>

          <Button
            className="w-full"
            disabled={!wallet.connected}
            onClick={openDeposit}
          >
            {wallet.connected ? "Deposit Fiat Funds →" : "Connect Wallet to Deposit"}
          </Button>
        </Card>

        {/* Off-Ramp Card */}
        <Card className="p-6 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-3">
              <span className="text-2xl">🏦</span>
              <Badge variant="primary">Direct Wire / SEPA</Badge>
            </div>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
              Withdraw (Crypto → Fiat)
            </h2>
            <p className="text-sm text-gray-600 dark:text-gray-300 mb-4">
              Convert your on-chain USDC or XLM directly to fiat deposited to your local bank account.
            </p>
            <ul className="text-xs text-gray-500 space-y-1.5 mb-6">
              <li>• Direct to personal or corporate bank accounts</li>
              <li>• Real-time interactive session via SEP-24 standard</li>
              <li>• Transaction status polling with on-chain receipts</li>
            </ul>
          </div>

          <Button
            variant="outline"
            className="w-full"
            disabled={!wallet.connected}
            onClick={openWithdraw}
          >
            {wallet.connected ? "Withdraw to Bank →" : "Connect Wallet to Withdraw"}
          </Button>
        </Card>
      </div>

      {/* Connected Account & Anchor Summary */}
      <Card className="p-5">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-3">Configuration & Connectivity</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
          <div>
            <span className="text-gray-500">Connected Wallet:</span>
            <p className="font-mono font-medium text-gray-900 dark:text-white mt-0.5">
              {wallet.publicKey ? shortenAddress(wallet.publicKey, 16) : "Not connected"}
            </p>
          </div>
          <div>
            <span className="text-gray-500">Default Discovery Anchor:</span>
            <p className="font-mono font-medium text-gray-900 dark:text-white mt-0.5">
              testnet.kado.sh (Configurable via ANCHOR_DOMAIN)
            </p>
          </div>
        </div>
      </Card>

      {/* Compliance & KYC Boundary Guide */}
      <Card className="p-6 border-amber-200 dark:border-amber-900/50 bg-amber-50/50 dark:bg-amber-950/10">
        <h3 className="text-base font-semibold text-amber-900 dark:text-amber-200 mb-2 flex items-center gap-2">
          <span>🛡️</span> Regulatory Compliance & KYC Architecture
        </h3>
        <div className="space-y-3 text-xs text-amber-800 dark:text-amber-300 leading-relaxed">
          <p>
            <strong>Zero Custody of Fiat:</strong> OphirPay is open-source payment orchestration software.
            OphirPay never accepts, transmits, holds, or custodies fiat currencies at any point in the lifecycle.
          </p>
          <p>
            <strong>Third-Party KYC Boundary:</strong> Customer Due Diligence (CDD), Identity Verification (KYC),
            and Anti-Money Laundering (AML) sanctions screening are conducted exclusively by regulated Stellar
            anchors (such as Kado, MoonPay, or licensed financial institutions) within their interactive window.
          </p>
          <p>
            <strong>Open Standards:</strong> The integration strictly implements <strong>SEP-1 (Discovery)</strong> and{" "}
            <strong>SEP-24 (Hosted Interactive Deposit and Withdrawal)</strong> to ensure full vendor independence
            and compatibility across the entire Stellar anchor network.
          </p>
        </div>
      </Card>

      {/* Interactive Modal */}
      <FiatOnRampModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        initialKind={initialKind}
      />
    </div>
  );
}
