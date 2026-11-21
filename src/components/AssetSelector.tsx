"use client";
// SPDX-License-Identifier: MIT


import { useCallback, useEffect, useRef, useState } from "react";

import { TrustlineModal } from "@/components/wallet/TrustlineModal";
import { useXlmPrice } from "@/hooks/usePrice";
import {
  type ClientAssetMetadata,
  fetchAssetMetadata,
} from "@/lib/asset-metadata-client";
import {
  type AssetInfo,
  USDC_MAINNET,
  USDC_TESTNET,
  XLM_ASSET,
} from "@/lib/assets";
import { sanitizeImageUrl } from "@/lib/sanitize-url";
import { type AssetBalance, fetchAllBalances, STELLAR_NETWORK } from "@/lib/stellar";
import { checkTrustline, getTrustlineMessage, type TrustlineInfo, type TrustlineState } from "@/lib/trustline";
import { cn } from "@/lib/utils";

// ── Helpers ────────────────────────────────────────────────────

/**
 * Renders an issuer-supplied asset logo, or the two-letter badge when there is
 * no logo or the URL failed the sanitizer (issue #1391).
 *
 * The URL is passed through `sanitizeImageUrl`, which permits only `https:` and
 * safe base64 raster `data:` URIs — blocking `javascript:`/`vbscript:` schemes
 * and script-bearing `image/svg+xml` payloads. It is rendered exclusively via
 * `<img>` (never raw HTML), with `referrerPolicy="no-referrer"` so the issuer's
 * host cannot see the referring page.
 */
function AssetMark({
  code,
  image,
  className,
}: {
  code: string;
  image?: string | null;
  className?: string;
}) {
  const safe = sanitizeImageUrl(image);
  if (safe) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- issuer logos are arbitrary remote hosts that cannot be allowlisted for next/image; the URL is sanitized above.
      <img
        src={safe}
        alt=""
        aria-hidden="true"
        loading="lazy"
        decoding="async"
        referrerPolicy="no-referrer"
        className={cn("rounded-full object-cover bg-white dark:bg-gray-800", className)}
      />
    );
  }
  return (
    <span
      className={cn(
        "rounded-full bg-ophir-100 dark:bg-ophir-900/30 flex items-center justify-center text-xs font-bold text-ophir-700 dark:text-ophir-300",
        className,
      )}
    >
      {code.slice(0, 2)}
    </span>
  );
}

const KNOWN_ASSETS: AssetInfo[] = [
  XLM_ASSET,
  STELLAR_NETWORK === "PUBLIC" ? USDC_MAINNET : USDC_TESTNET,
];

function findAssetBalance(
  balances: AssetBalance[],
  asset: AssetInfo,
): string {
  if (asset.type === "native") {
    return balances.find((b) => b.type === "native")?.balance ?? "0";
  }
  return (
    balances.find(
      (b) => b.assetCode === asset.code && b.assetIssuer === asset.issuer,
    )?.balance ?? "0"
  );
}

/**
 * Filter an asset list by a free-text query.
 *
 * Matches (case-insensitively, as a substring) the asset code, the display
 * label and the issuer address, so users can search by ticker (`USDC`) or by
 * pasting all or part of an issuer account. A blank query returns every asset.
 */
export function filterAssets(
  assets: AssetInfo[],
  query: string,
  labelFor: (asset: AssetInfo) => string = (a) => a.displayName,
): AssetInfo[] {
  const q = query.trim().toLowerCase();
  if (!q) return assets;
  return assets.filter(
    (asset) =>
      asset.code.toLowerCase().includes(q) ||
      labelFor(asset).toLowerCase().includes(q) ||
      (asset.issuer ?? "").toLowerCase().includes(q),
  );
}

interface AssetSelectorProps {
  publicKey: string | null;
  selectedAsset: AssetInfo;
  onSelect: (asset: AssetInfo) => void;
  className?: string;
  disabled?: boolean;
  /** Assets offered in the dropdown. Defaults to the built-in known assets. */
  assets?: AssetInfo[];
}

// ── Component ──────────────────────────────────────────────────

export function AssetSelector({
  publicKey,
  selectedAsset,
  onSelect,
  className,
  disabled = false,
  assets = KNOWN_ASSETS,
}: AssetSelectorProps) {
  const [accountBalances, setAccountBalances] = useState<{
    publicKey: string;
    values: AssetBalance[];
  } | null>(null);
  const balances = accountBalances?.publicKey === publicKey ? accountBalances?.values ?? [] : [];
  const [query, setQuery] = useState("");
  const [trustlineStatus, setTrustlineStatus] = useState<
    Record<string, { hasTrustline: boolean; checking: boolean; state?: TrustlineState }>
  >({});
  // Non-null while the quick-action trustline dialog is open for that asset.
  const [trustlineAsset, setTrustlineAsset] = useState<AssetInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  // Issuer-supplied display metadata (issue #824), keyed by `code:issuer`.
  // Absent/`null` entries fall back to the built-in display name.
  const [metadata, setMetadata] = useState<Record<string, ClientAssetMetadata | null>>({});

  const balanceGeneration = useRef(0);
  const fetchBalances = useCallback(async () => {
    if (!publicKey) return;
    const generation = ++balanceGeneration.current;
    setLoading(true);
    try {
      const allBalances = await fetchAllBalances(publicKey);
      if (generation === balanceGeneration.current) setAccountBalances({ publicKey, values: allBalances });
    } catch {
      // silent
    } finally {
      if (generation === balanceGeneration.current) setLoading(false);
    }
  }, [publicKey]);

  useEffect(() => {
    setAccountBalances(null);
    setLoading(false);
    void fetchBalances();
    return () => { balanceGeneration.current += 1; };
  }, [fetchBalances]);

  // Resolve ticker/issuer names for the non-native assets we might display.
  // Resolution happens server-side via /api/assets/metadata; a missing or
  // unreachable TOML just leaves the built-in display name in place.
  useEffect(() => {
    let cancelled = false;
    const targets = [selectedAsset, ...assets].filter(
      (a) => a.type !== "native" && !!a.issuer
    );
    const seen = new Set<string>();
    for (const asset of targets) {
      const key = `${asset.code}:${asset.issuer}`;
      if (seen.has(key)) continue;
      seen.add(key);
      fetchAssetMetadata(asset.code, asset.issuer!).then((meta) => {
        if (cancelled) return;
        setMetadata((prev) => ({ ...prev, [key]: meta }));
      });
    }
    return () => {
      cancelled = true;
    };
  }, [selectedAsset, assets]);

  // Start every open with a fresh, unfiltered list.
  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  useEffect(() => {
    if (!publicKey || selectedAsset.type === "native" || !selectedAsset.issuer) return;
    const key = `${selectedAsset.code}:${selectedAsset.issuer}`;
    let cancelled = false;
    setTrustlineStatus((prev) => ({
      ...prev,
      [key]: { ...prev[key], checking: true },
    }));
    checkTrustline(publicKey, selectedAsset.code, selectedAsset.issuer).then((info) => {
      if (cancelled) return;
      setTrustlineStatus((prev) => ({
        ...prev,
        [key]: { hasTrustline: info.hasTrustline, checking: false, state: info.state },
      }));
    });
    return () => {
      cancelled = true;
    };
  }, [publicKey, selectedAsset.code, selectedAsset.issuer, selectedAsset.type]);

  const handleSelect = async (asset: AssetInfo) => {
    // For non-native assets, check trustline before selecting
    if (asset.type !== "native" && asset.issuer && publicKey) {
      const key = `${asset.code}:${asset.issuer}`;
      setTrustlineStatus((prev) => ({
        ...prev,
        [key]: { ...prev[key], checking: true },
      }));

      const info = await checkTrustline(publicKey, asset.code, asset.issuer);

      setTrustlineStatus((prev) => ({
        ...prev,
        [key]: { hasTrustline: info.hasTrustline, checking: false, state: info.state },
      }));
      if (info.state !== "authorized") {
        onSelect(asset);
        return;
      }
    }

    onSelect(asset);
    setOpen(false);
  };

  /**
   * Called by the trustline dialog after the changeTrust lands and Horizon
   * confirms it: seed the row state from the verified result, select the asset
   * and re-read balances so the new holding shows up without a page reload.
   */
  const handleTrustlineCreated = useCallback(
    async (createdAsset: AssetInfo, info: TrustlineInfo) => {
      if (!createdAsset.issuer) return;
      const key = `${createdAsset.code}:${createdAsset.issuer}`;
      setTrustlineStatus((prev) => ({
        ...prev,
        [key]: {
          hasTrustline: info.hasTrustline,
          checking: false,
          state: info.state,
        },
      }));
      onSelect(createdAsset);
      await fetchBalances();
      setOpen(false);
    },
    [onSelect, fetchBalances],
  );

  const balance = findAssetBalance(balances, selectedAsset);
  const { price } = useXlmPrice({ enabled: !!publicKey && selectedAsset.type === "native" });
  const usdc = STELLAR_NETWORK === "PUBLIC" ? USDC_MAINNET : USDC_TESTNET;
  const rate = selectedAsset.type === "native" ? price :
    selectedAsset.code === usdc.code && selectedAsset.issuer === usdc.issuer ? 1 : null;
  const usd = publicKey && !loading && rate !== null ? Number(balance) * rate : NaN;
  const fiatEstimate = Number.isFinite(usd)
    ? new Intl.NumberFormat(undefined, { style: "currency", currency: "USD" }).format(usd)
    : null;

  /**
   * Display label for an asset: the resolved TOML name when one exists,
   * otherwise the built-in display name (issue #824).
   */
  const labelFor = (asset: AssetInfo): string => {
    const resolved = metadata[`${asset.code}:${asset.issuer}`];
    return resolved?.name ?? asset.displayName;
  };

  const visibleAssets = filterAssets(assets, query, labelFor);

  return (
    <div className={cn("relative", className)}>
      <button
        type="button"
        onClick={() => !disabled && setOpen(!open)}
        disabled={disabled}
        className={cn(
          "w-full flex items-center justify-between gap-2 px-4 py-2.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm transition-colors",
          !disabled &&
            "hover:border-gray-300 dark:hover:border-gray-600 cursor-pointer",
          disabled && "opacity-50 cursor-not-allowed",
        )}
      >
        <span className="flex items-center gap-2">
          <AssetMark
            code={selectedAsset.code}
            image={metadata[`${selectedAsset.code}:${selectedAsset.issuer}`]?.image}
            className="w-6 h-6"
          />
          <span className="text-gray-900 dark:text-white font-medium">
            {selectedAsset.code}
          </span>
        </span>

        <span className="flex items-center gap-2">
          <span className="text-xs text-gray-400">
            {loading ? "..." : balance}{fiatEstimate && <span className="ml-1">≈ {fiatEstimate}</span>}
          </span>
          <svg
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={2}
            stroke="currentColor"
            className={cn(
              "w-4 h-4 text-gray-400 transition-transform",
              open && "rotate-180",
            )}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M19.5 8.25l-7.5 7.5-7.5-7.5"
            />
          </svg>
        </span>
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute z-20 top-full left-0 right-0 mt-1 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-xl py-1 animate-fade-in">
            <div className="px-3 pt-2 pb-1">
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search by code or issuer"
                aria-label="Search assets"
                autoComplete="off"
                spellCheck={false}
                className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-1.5 text-sm text-gray-900 dark:text-white placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-ophir-500"
              />
            </div>

            {visibleAssets.length === 0 && (
              <p
                role="status"
                className="px-4 py-3 text-sm text-gray-500 dark:text-gray-400"
              >
                No assets found
              </p>
            )}

            {visibleAssets.map((asset) => {
              const bal = findAssetBalance(balances, asset);
              const key = `${asset.code}:${asset.issuer}`;
              const tl = trustlineStatus[key];

              return (
                <button
                  key={key}
                  type="button"
                  data-testid="asset-option"
                  onClick={() => handleSelect(asset)}
                  className={cn(
                    "w-full flex items-center justify-between px-4 py-2.5 text-sm hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors",
                    selectedAsset.code === asset.code &&
                      selectedAsset.issuer === asset.issuer &&
                      "bg-ophir-50 dark:bg-ophir-950/20",
                  )}
                >
                  <div className="flex items-center gap-2">
                    <AssetMark
                      code={asset.code}
                      image={metadata[key]?.image}
                      className="w-6 h-6"
                    />
                    <div className="text-left">
                      <span className="text-gray-900 dark:text-white font-medium">
                        {asset.code}
                      </span>
                      <span
                        className="block text-xs text-gray-400"
                        // The issuer is available on demand (hover/focus) when
                        // no human-readable metadata could be resolved.
                        title={asset.issuer ?? undefined}
                      >
                        {labelFor(asset)}
                      </span>
                    </div>
                  </div>
                  <div className="text-right">
                    <span className="text-xs text-gray-500 dark:text-gray-400">
                      {bal}
                    </span>
                    {asset.type !== "native" &&
                      (tl?.checking ? (
                        <span className="block text-xs text-gray-400">
                          checking...
                        </span>
                      ) : tl?.state === "missing" ? (
                        // Warning badge: a missing trustline is actionable, not
                        // merely a status, so it reads as a badge the user can
                        // act on below rather than a grey footnote.
                        <span className="mt-0.5 inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
                          Trustline Required
                        </span>
                      ) : (
                        <span
                          className={cn(
                            "block text-xs",
                            tl?.state === "authorized"
                              ? "text-green-500"
                              : tl?.state === "frozen" || tl?.state === "unauthorized"
                                ? "text-red-500"
                                : "text-gray-400",
                          )}
                        >
                          {tl?.state === "authorized"
                            ? "✓ authorized"
                            : tl?.state === "frozen"
                              ? "frozen"
                              : tl?.state === "unauthorized"
                                ? "not authorized"
                                : tl?.state === "unavailable"
                                  ? "status unavailable"
                                  : ""}
                        </span>
                      ))}
                  </div>
                </button>
              );
            })}

            {selectedAsset.type !== "native" && selectedAsset.issuer && trustlineStatus[`${selectedAsset.code}:${selectedAsset.issuer}`]?.state && (
              <div className="border-t border-gray-100 dark:border-gray-700 mt-1 px-4 py-3">
                <p className="text-xs text-gray-600 dark:text-gray-300">
                  {getTrustlineMessage(trustlineStatus[`${selectedAsset.code}:${selectedAsset.issuer}`].state!, selectedAsset.code)}
                </p>
                {trustlineStatus[`${selectedAsset.code}:${selectedAsset.issuer}`].state === "missing" && (
                  <>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                      Creating a trustline lets this account hold the asset and requires additional XLM for the network reserve (currently 0.5 XLM), plus a small transaction fee.
                    </p>
                    <button
                      type="button"
                      onClick={() => setTrustlineAsset(selectedAsset)}
                      disabled={!publicKey}
                      className="mt-3 px-3 py-2 rounded-lg bg-ophir-600 text-white text-xs font-semibold disabled:opacity-50"
                    >
                      Create trustline
                    </button>
                  </>
                )}
              </div>
            )}

            {/* Custom token input */}
            <div className="border-t border-gray-100 dark:border-gray-700 mt-1 pt-1 px-3 pb-2">
              <p className="text-xs text-gray-400 px-1 mb-1">
                Custom token coming soon
              </p>
            </div>
          </div>
        </>
      )}

      <TrustlineModal
        open={trustlineAsset !== null}
        onClose={() => setTrustlineAsset(null)}
        publicKey={publicKey}
        asset={trustlineAsset}
        onCreated={handleTrustlineCreated}
      />
    </div>
  );
}
