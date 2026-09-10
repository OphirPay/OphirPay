"use client";
import { useState } from "react";
import { WalletButton } from "@/components/WalletButton";
import { useWallet } from "@/hooks/useMultiWallet";
import { formatAmount } from "@/lib/utils";
import { buildPaymentTx, submitSignedTx } from "@/lib/stellar";
import { useToast } from "@/components/ui/Toast";
import { getWalletConnector } from "@/lib/wallets";

const STELLAR_NETWORK = process.env.NEXT_PUBLIC_STELLAR_NETWORK || "testnet";
const NETWORK_PASSPHRASE =
  process.env.NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE ||
  "Test SDF Network ; September 2015";

import type { PaymentRequest } from "@prisma/client";

export function PaymentRequestClient({ request }: { request: PaymentRequest }) {
  const { wallet } = useWallet();
  const { toast } = useToast();
  const [submitting, setSubmitting] = useState(false);
  const [paid, setPaid] = useState(request.status === "PAID");

  const handlePay = async () => {
    if (!wallet.publicKey || !wallet.activeWalletId) return;
    setSubmitting(true);

    try {
      const res = await buildPaymentTx({
        sourcePublicKey: wallet.publicKey,
        destination: request.recipientAddress,
        amount: request.amount.toString(),
        memo: request.description || undefined,
        assetCode: request.assetCode,
        assetIssuer: request.assetIssuer || undefined,
      });

      const connector = getWalletConnector(wallet.activeWalletId);
      const signedXdr = await connector.signTransaction(res.xdr, {
        network: STELLAR_NETWORK,
        networkPassphrase: NETWORK_PASSPHRASE,
      });

      const response = await submitSignedTx(signedXdr);

      // Notify backend
      await fetch(`/api/requests/${request.id}/pay`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ txHash: response.hash }),
      });

      setPaid(true);
      toast.success("Payment Sent!", "Your payment was processed successfully.");
    } catch (err) {
      toast.error("Payment Failed", err instanceof Error ? err.message : "An error occurred.");
    } finally {
      setSubmitting(false);
    }
  };

  if (paid) {
    return (
      <div className="max-w-lg mx-auto mt-12 animate-fade-in p-4">
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-8 text-center shadow-lg">
          <div className="h-16 w-16 mx-auto rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center mb-4">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-8 h-8 text-green-600 dark:text-green-400">
              <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
            </svg>
          </div>
          <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-2">Payment Complete</h2>
          <p className="text-gray-600 dark:text-gray-400 mb-6">Thank you! The payment request has been fulfilled.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-md mx-auto mt-12 animate-fade-in p-4">
      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-8 shadow-lg">
        <div className="text-center mb-8">
          <div className="h-16 w-16 mx-auto bg-gray-100 dark:bg-gray-800 rounded-2xl flex items-center justify-center mb-4 border border-gray-200 dark:border-gray-700 shadow-sm">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-8 h-8 text-ophir-600 dark:text-ophir-400">
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18.75a60.07 60.07 0 0115.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 013 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-1.5H21a.75.75 0 00-.75.75v.75m0 0H3.75m0 0h-.375a1.125 1.125 0 01-1.125-1.125V15m1.5 1.5v-.75A.75.75 0 003 15h-.75M15 10.5a3 3 0 11-6 0 3 3 0 016 0zm3 0h.008v.008H18V10.5zm-12 0h.008v.008H6V10.5z" />
            </svg>
          </div>
          <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-2">Payment Request</h2>
          <p className="text-3xl font-mono text-gray-900 dark:text-white">
            {formatAmount(request.amount, request.assetCode)}
          </p>
          {request.description && (
            <p className="text-gray-500 dark:text-gray-400 mt-3 text-sm">{request.description}</p>
          )}
        </div>

        <div className="space-y-4 mb-8">
          <div className="flex justify-between items-center py-2 border-b border-gray-100 dark:border-gray-800">
            <span className="text-sm text-gray-500 dark:text-gray-400">Recipient</span>
            <span className="text-sm font-mono text-gray-900 dark:text-gray-200">
              {request.recipientAddress.slice(0, 5)}...{request.recipientAddress.slice(-4)}
            </span>
          </div>
          {request.expiresAt && (
            <div className="flex justify-between items-center py-2 border-b border-gray-100 dark:border-gray-800">
              <span className="text-sm text-gray-500 dark:text-gray-400">Due Date</span>
              <span className="text-sm font-medium text-gray-900 dark:text-gray-200">
                {new Date(request.expiresAt).toLocaleDateString()}
              </span>
            </div>
          )}
        </div>

        <div className="flex flex-col items-center gap-3">
          {!wallet.publicKey ? (
            <div className="w-full h-12 [&>button]:w-full [&>button]:h-full [&>button]:justify-center">
              <WalletButton />
            </div>
          ) : (
            <button
              onClick={handlePay}
              disabled={submitting}
              className="w-full px-4 py-3 rounded-xl bg-ophir-600 text-white font-medium hover:bg-ophir-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {submitting ? (
                <>
                  <svg className="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  Processing...
                </>
              ) : (
                "Pay with Wallet"
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
