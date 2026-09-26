// SPDX-License-Identifier: MIT

import Link from "next/link";
import { isValidStellarAddress } from "@/lib/stellar";
import { Sep7WalletHandoff } from "@/components/payments/Sep7WalletHandoff";
import { Breadcrumb } from "@/components/Breadcrumb";

interface PayPageProps {
  params: Promise<{ address: string }>;
  searchParams: Promise<{
    amount?: string;
    memo?: string;
    memo_type?: string;
    asset?: string;
    asset_code?: string;
    issuer?: string;
    asset_issuer?: string;
    msg?: string;
  }>;
}

/**
 * Shareable payment request page.
 *
 * Offers mobile users a direct SEP-7 "Open in Wallet" action (e.g. Lobstr, Solar, Beans, Decaf),
 * displays a QR code for desktop or cross-device scanning, and provides a link to pay via the
 * OphirPay web app.
 */
export default async function PayPage({ params, searchParams }: PayPageProps) {
  const { address } = await params;
  const query = await searchParams;

  const amount = query.amount;
  const memo = query.memo;
  const memoType = (query.memo_type as "MEMO_TEXT" | "MEMO_ID" | "MEMO_HASH" | "MEMO_RETURN") || undefined;
  const assetCode = query.asset || query.asset_code;
  const assetIssuer = query.issuer || query.asset_issuer;
  const msg = query.msg;

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
          <Link
            href="/send"
            className="inline-block px-5 py-2.5 rounded-lg bg-ophir-600 text-white text-sm font-medium hover:bg-ophir-700 transition-colors"
          >
            Go to Send
          </Link>
        </div>
      </div>
    );
  }

  // Build the web app fallback URL (/send?dest=...)
  const webSendSearch = new URLSearchParams();
  webSendSearch.set("dest", address);
  if (amount) webSendSearch.set("amount", amount);
  if (memo) webSendSearch.set("memo", memo);
  if (assetCode) webSendSearch.set("asset", assetCode);
  if (assetIssuer) webSendSearch.set("issuer", assetIssuer);

  return (
    <div className="max-w-2xl mx-auto space-y-6 animate-fade-in py-4">
      <Breadcrumb
        items={[
          { label: "Pay", href: "#" },
          { label: `${address.slice(0, 4)}...${address.slice(-4)}` },
        ]}
      />

      <div className="text-center">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
          Payment Request
        </h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          Complete this payment using your mobile Stellar wallet or the OphirPay web app.
        </p>
      </div>

      <Sep7WalletHandoff
        params={{
          destination: address,
          amount,
          memo,
          memoType,
          assetCode,
          assetIssuer,
          msg,
        }}
        title="Open in Stellar Wallet"
      />

      {/* Alternative: Pay with web wallet extension */}
      <div className="text-center pt-2">
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">
          Prefer using a browser extension (Freighter, xBull, Albedo)?
        </p>
        <Link
          href={`/send?${webSendSearch.toString()}`}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-ophir-600 dark:text-ophir-400 hover:underline"
        >
          Pay with OphirPay Web App
          <svg
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={2}
            stroke="currentColor"
            className="w-4 h-4"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
          </svg>
        </Link>
      </div>
    </div>
  );
}
