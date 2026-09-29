// SPDX-License-Identifier: MIT

import { notFound } from "next/navigation";
import { isValidStellarAddress } from "@/lib/stellar";
import { buildSep7PayUri } from "@/lib/stellar-uri";
import prisma from "@/lib/prisma";
import { expireDuePaymentRequests } from "@/lib/payment-request-lifecycle";
import { formatAmount } from "@/lib/utils";
import { RequestPaymentConfirmation } from "./RequestPaymentConfirmation";
import { PayHandoff } from "./PayHandoff";

interface PayPageProps {
  params: Promise<{ address: string }>;
  searchParams: Promise<{
    amount?: string;
    memo?: string;
    asset?: string;
    assetIssuer?: string;
    issuer?: string;
    requestId?: string;
  }>;
}

/**
 * Shareable payment link route.
 * Offers SEP-7 wallet handoff and a browser-wallet fallback. When a request
 * id is provided, renders the public invoice with its current lifecycle state.
 */
export default async function PayPage({ params, searchParams }: PayPageProps) {
  const { address } = await params;
  const { amount, memo, asset, assetIssuer, issuer, requestId } = await searchParams;

  if (!isValidStellarAddress(address)) {
    return (
      <div className="max-w-lg mx-auto mt-12 animate-fade-in">
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-8 text-center">
          <div className="h-16 w-16 mx-auto rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center mb-4">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={2}
              stroke="currentColor"
              className="w-8 h-8 text-red-600 dark:text-red-400"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z"
              />
            </svg>
          </div>
          <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-1">
            Invalid Payment Link
          </h2>
          <p className="text-sm text-red-600 dark:text-red-400 mb-6 max-w-sm mx-auto">
            The recipient address in this link is not a valid Stellar address.
            Please check the link and try again.
          </p>
          <a
            href="/send"
            className="inline-block px-5 py-2.5 rounded-lg bg-ophir-600 text-white text-sm font-medium hover:bg-ophir-700 transition-colors"
          >
            Go to Send
          </a>
        </div>
      </div>
    );
  }

  if (requestId) {
    await expireDuePaymentRequests();
    const paymentRequest = await prisma.paymentRequest.findUnique({
      where: { id: requestId },
    });
    if (!paymentRequest || paymentRequest.recipientAddress !== address) notFound();

    const requestAmount = paymentRequest.amount.toString();
    const sendSearch = new URLSearchParams({
      dest: address,
      amount: requestAmount,
      asset: paymentRequest.assetCode,
      requestId: paymentRequest.id,
    });
    const statusLabel =
      paymentRequest.status === "PAID"
        ? "This invoice has been paid."
        : paymentRequest.status === "EXPIRED"
          ? "This invoice has expired and can no longer be paid."
          : paymentRequest.status === "CANCELLED"
            ? "This invoice was cancelled."
            : null;
    const paymentUri = buildSep7PayUri({
      destination: address,
      amount: requestAmount,
      assetCode: paymentRequest.assetCode,
      assetIssuer: paymentRequest.assetIssuer ?? undefined,
      msg: paymentRequest.description ?? undefined,
    });

    return (
      <main className="max-w-lg mx-auto mt-12 px-4">
        <section className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-8">
          <p className="text-sm font-medium text-ophir-600 dark:text-ophir-400">
            OPHIRPAY INVOICE
          </p>
          <h1 className="mt-3 text-3xl font-bold text-gray-900 dark:text-white">
            {formatAmount(Number(paymentRequest.amount), paymentRequest.assetCode)}
          </h1>
          {paymentRequest.description && (
            <p className="mt-3 text-gray-600 dark:text-gray-300">
              {paymentRequest.description}
            </p>
          )}
          {paymentRequest.dueDate && (
            <p className="mt-3 text-sm text-gray-500 dark:text-gray-400">
              Due {paymentRequest.dueDate.toLocaleDateString()}
            </p>
          )}
          {statusLabel ? (
            <p className="mt-6 rounded-lg bg-gray-50 dark:bg-gray-800 p-3 text-sm text-gray-700 dark:text-gray-300">
              {statusLabel}
            </p>
          ) : (
            <>
              <PayHandoff
                paymentUri={paymentUri}
                sendHref={`/send?${sendSearch.toString()}`}
              />
              <RequestPaymentConfirmation requestId={paymentRequest.id} />
            </>
          )}
        </section>
      </main>
    );
  }

  const paymentUri = buildSep7PayUri({
    destination: address,
    amount,
    memo,
    assetCode: asset,
    assetIssuer: assetIssuer ?? issuer,
  });
  const search = new URLSearchParams({ dest: address });
  if (amount) search.set("amount", amount);
  if (memo) search.set("memo", memo);
  if (asset) search.set("asset", asset);

  return <PayHandoff paymentUri={paymentUri} sendHref={`/send?${search.toString()}`} />;
}
