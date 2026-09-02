// SPDX-License-Identifier: MIT

import { redirect } from "next/navigation";
import { isValidStellarAddress } from "@/lib/stellar";

interface PayPageProps {
  params: Promise<{ address: string }>;
  searchParams: Promise<{ amount?: string; memo?: string; asset?: string }>;
}

/**
 * Shareable payment link route.
 * Redirects to the send form pre-filled with the recipient address and
 * any optional amount/memo/asset query params. Invalid addresses show a
 * clear error instead of crashing.
 */
export default async function PayPage({ params, searchParams }: PayPageProps) {
  const { address } = await params;
  const { amount, memo, asset } = await searchParams;

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

  const search = new URLSearchParams();
  search.set("dest", address);
  if (amount) search.set("amount", amount);
  if (memo) search.set("memo", memo);
  if (asset) search.set("asset", asset);

  redirect(`/send?${search.toString()}`);
}
