// SPDX-License-Identifier: MIT

import { redirect } from "next/navigation";
import { isValidStellarAddress } from "@/lib/stellar";

interface PayPageProps {
  params: Promise<{ address: string }>;
  searchParams: Promise<{
    amount?: string;
    memo?: string;
    asset?: string;
    due?: string;
    status?: string;
    msg?: string;
  }>;
}

/**
 * Shareable payment link and invoice route.
 * Redirects to the send form pre-filled with the recipient address and
 * query params, while showing clear overdue styling and warnings when a
 * payment request has passed its due date.
 */
export default async function PayPage({ params, searchParams }: PayPageProps) {
  const { address } = await params;
  const { amount, memo, asset, due, status, msg } = await searchParams;

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

  const isOverdue =
    status === "OVERDUE" ||
    status === "EXPIRED" ||
    (due ? !isNaN(new Date(due).getTime()) && new Date(due).getTime() < Date.now() : false);

  const search = new URLSearchParams();
  search.set("dest", address);
  if (amount) search.set("amount", amount);
  if (memo) search.set("memo", memo);
  if (asset) search.set("asset", asset);

  // If the request is overdue, present a clear warning banner before payment
  if (isOverdue) {
    const formattedDueDate = due
      ? new Date(due).toLocaleDateString(undefined, {
          month: "long",
          day: "numeric",
          year: "numeric",
        })
      : null;

    return (
      <div className="max-w-lg mx-auto mt-12 animate-fade-in space-y-6">
        <div className="bg-white dark:bg-gray-900 rounded-2xl border-2 border-amber-300 dark:border-amber-700/60 p-8 shadow-sm">
          {/* Overdue Warning Header */}
          <div className="flex items-center gap-3 p-4 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 text-amber-900 dark:text-amber-200 mb-6">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="currentColor"
              className="w-6 h-6 shrink-0 text-amber-600 dark:text-amber-400"
            >
              <path
                fillRule="evenodd"
                d="M9.401 3.003c1.155-2 4.043-2 5.197 0l7.355 12.748c1.154 2-.29 4.5-2.599 4.5H4.645c-2.309 0-3.752-2.5-2.598-4.5L9.4 3.003zM12 8.25a.75.75 0 01.75.75v3.75a.75.75 0 01-1.5 0V9a.75.75 0 01.75-.75zm0 8.25a.75.75 0 100-1.5.75.75 0 000 1.5z"
                clipRule="evenodd"
              />
            </svg>
            <div>
              <p className="font-semibold text-sm">Payment Request Overdue</p>
              <p className="text-xs text-amber-800 dark:text-amber-300 mt-0.5">
                {formattedDueDate
                  ? `This payment request was expected by ${formattedDueDate}.`
                  : "This payment request has passed its due date."}{" "}
                You can still complete the payment below.
              </p>
            </div>
          </div>

          <div className="space-y-4 text-center">
            {amount && (
              <div>
                <span className="text-xs text-gray-500 uppercase tracking-wider font-semibold">
                  Requested Amount
                </span>
                <p className="text-3xl font-extrabold text-gray-900 dark:text-white mt-1">
                  {amount} {asset || "XLM"}
                </p>
              </div>
            )}

            {msg && (
              <p className="text-sm text-gray-600 dark:text-gray-400 italic">
                "{msg}"
              </p>
            )}

            <div className="pt-2 pb-4 text-xs font-mono text-gray-500 dark:text-gray-400 break-all">
              Recipient: {address}
            </div>

            <div className="flex flex-col gap-3">
              <a
                href={`/send?${search.toString()}`}
                className="w-full inline-flex items-center justify-center px-5 py-3 rounded-xl bg-ophir-600 hover:bg-ophir-700 text-white font-medium shadow-sm transition-all focus:outline-none focus:ring-2 focus:ring-ophir-500"
              >
                Proceed to Payment ({amount || ""} {asset || "XLM"})
              </a>
              <a
                href="/"
                className="text-xs text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
              >
                Back to OphirPay Home
              </a>
            </div>
          </div>
        </div>
      </div>
    );
  }

  redirect(`/send?${search.toString()}`);
}
