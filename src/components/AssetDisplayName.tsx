"use client";
// SPDX-License-Identifier: MIT

import { cn } from "@/lib/utils";
import {
  USDC_TESTNET,
  USDC_MAINNET,
  getAssetDisplayParts,
} from "@/lib/assets";
import { useAssetMetadata } from "@/hooks/useAssetMetadata";

/** Assets whose display name is already known locally — no lookup needed. */
const KNOWN_ISSUED_ASSETS = [USDC_TESTNET, USDC_MAINNET];

interface AssetDisplayNameProps {
  code: string;
  issuer?: string | null;
  className?: string;
}

/**
 * Display label for a custom asset: the resolved SEP-1 name alongside the
 * code when metadata exists, degrading to the raw code plus a shortened
 * issuer when it doesn't. The full issuer is always available on demand via
 * the element's title tooltip. Renders nothing for assets without an issuer
 * (native XLM) — the caller already shows the code in the amount.
 */
export function AssetDisplayName({
  code,
  issuer,
  className,
}: AssetDisplayNameProps) {
  const known = KNOWN_ISSUED_ASSETS.find(
    (a) => a.code === code && a.issuer === issuer,
  );
  const { metadata } = useAssetMetadata(code, known ? undefined : issuer);

  if (!issuer) return null;

  // Known issued assets already carry a curated local display name.
  if (known) {
    return (
      <span
        className={cn("text-xs text-gray-400 dark:text-gray-500", className)}
        title={issuer}
      >
        {known.displayName}
      </span>
    );
  }

  const parts = getAssetDisplayParts(code, issuer, metadata?.name);
  const label =
    parts.title !== code
      ? `${parts.title} (${parts.subtitle})` // resolved name alongside code
      : parts.subtitle; // degraded: shortened issuer under the raw code

  return (
    <span
      className={cn("text-xs text-gray-400 dark:text-gray-500", className)}
      title={issuer}
    >
      {label}
    </span>
  );
}
