"use client";
// SPDX-License-Identifier: MIT


import { cn, shortenAddress } from "@/lib/utils";
import {
  getStellarExplorerUrl,
  getAccountExplorerUrl,
} from "@/lib/stellar";

interface ExplorerLinkProps {
  /** Transaction hash or account address to link */
  value: string;
  kind?: "tx" | "account";
  shorten?: boolean;
  className?: string;
}

/**
 * Links a tx hash or account address to the Stellar explorer
 * (testnet/public aware), with optional shortened display text.
 */
export function ExplorerLink({
  value,
  kind = "tx",
  shorten = true,
  className,
}: ExplorerLinkProps) {
  if (!value) return null;

  const href =
    kind === "tx"
      ? getStellarExplorerUrl(value)
      : getAccountExplorerUrl(value);

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      title={`View ${kind} on Stellar explorer`}
      className={cn(
        "inline-flex items-center gap-1 text-ophir-600 dark:text-ophir-400 hover:underline font-mono text-xs",
        className
      )}
    >
      {shorten ? shortenAddress(value) : value}
      <svg
        xmlns="http://www.w3.org/2000/svg"
        fill="none"
        viewBox="0 0 24 24"
        strokeWidth={2}
        stroke="currentColor"
        className="w-3 h-3 opacity-60"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25"
        />
      </svg>
    </a>
  );
}
