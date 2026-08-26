"use client";
// SPDX-License-Identifier: MIT


import { useEffect, useRef, useState } from "react";
import { useWallet } from "@/hooks/useMultiWallet";
import { shortenAddress, formatAmount, timeAgo } from "@/lib/utils";
import { getAccountExplorerUrl, XLM_STROOPS, STELLAR_NETWORK } from "@/lib/stellar";
import {
  fetchOnChainPayments,
  type OnChainPayment,
} from "@/lib/contracts";
import { useApiQuery } from "@/hooks/useApiQuery";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { LoadingSkeleton } from "@/components/LoadingSkeleton";
import { Breadcrumb } from "@/components/Breadcrumb";
import Link from "next/link";

// ── Page ───────────────────────────────────────────────────────

interface OnChainData {
  payments: OnChainPayment[];
  total: number;
}

export default function TreasuryDashboard() {
  const { wallet, fetchBalance } = useWallet();

  const {
    data,
    isLoading: loading,
    error: fetchError,
    refetch: loadOnChain,
  } = useApiQuery<OnChainData>(
    ["dashboard", "payments"],
    undefined, // REST not used — reads via Soroban simulation below
    {
      // On-chain reads are N+1 RPC simulations — don't refetch on tab focus
      refetchOnWindowFocus: false,
    },
    () => fetchOnChainPayments(20),
  );

  const payments = data?.payments ?? [];
  const totalCount = data?.total ?? 0;
  const error = fetchError ? fetchError.message : null;

  const totalBalance = wallet.balance ? parseFloat(wallet.balance) : 0;

  // On-chain stats (computed from the fetched records)
  const volume = payments.reduce((sum, p) => sum + p.amountStroops / XLM_STROOPS, 0);
  const avgPayment = payments.length > 0 ? volume / payments.length : 0;

  return (
    <div className="space-y-6 animate-fade-in">
      {/* ── Breadcrumb ───────────────────────────────────── */}
      <Breadcrumb items={[{ label: "Treasury" }]} />

      {/* ── Welcome ────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
            Treasury Dashboard
          </h1>
          <div className="flex items-center gap-2 mt-1">
            <p className="text-gray-500 dark:text-gray-400">
              Monitor your financial operations and payment activity
            </p>
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 text-[10px] font-medium text-blue-700 dark:text-blue-400">
              <span className="relative flex h-1.5 w-1.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-green-500" />
              </span>
              {STELLAR_NETWORK}
            </span>
          </div>
        </div>
        {wallet.connected && (
          <Link href="/send">
            <Button
              leftIcon={
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={2}
                  stroke="currentColor"
                  className="w-5 h-5"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5"
                  />
                </svg>
              }
            >
              Send Payment
            </Button>
          </Link>
        )}
      </div>

      {/* ── Stats Cards ────────────────────────────────────── */}
      {loading && !error ? (
        <LoadingSkeleton variant="stats" />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {wallet.connected && wallet.publicKey ? (
            <StatCard
              title="Your XLM Balance"
              value={
                wallet.balanceLoading ? (
                  "Loading..."
                ) : (
                  <AnimatedNumber
                    value={totalBalance}
                    format={(n) => formatAmount(n, "XLM")}
                  />
                )
              }
              icon="⭐"
              trend={
                <button
                  onClick={fetchBalance}
                  className="text-xs text-ophir-600 dark:text-ophir-400 hover:underline"
                >
                  Refresh
                </button>
              }
            />
          ) : (
            <StatCard
              title="Your XLM Balance"
              value="—"
              icon="⭐"
              trend="Connect wallet"
            />
          )}
          <StatCard
            title="Total Payments"
            value={
              <AnimatedNumber
                value={totalCount}
                format={(n) => Math.round(n).toLocaleString()}
              />
            }
            icon="💳"
            trend="On-chain"
          />
          <StatCard
            title="Recorded Volume"
            value={
              <AnimatedNumber value={volume} format={(n) => formatAmount(n, "XLM")} />
            }
            icon="📊"
            trend={`Last ${payments.length} records`}
          />
          <StatCard
            title="Avg Payment"
            value={
              <AnimatedNumber value={avgPayment} format={(n) => formatAmount(n, "XLM")} />
            }
            icon="✅"
            trend="On-chain"
          />
        </div>
      )}

      {/* ── Accounts & Activity ────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Accounts */}
        <Card
          title="Your Accounts"
          className="lg:col-span-1"
          padding="md"
        >
          <div className="space-y-3">
            {wallet.connected && wallet.publicKey ? (
              <div className="p-3 rounded-lg bg-ophir-50 dark:bg-ophir-950/20 border border-ophir-200 dark:border-ophir-800">
                <div className="flex items-center justify-between mb-1">
                  <p className="text-sm font-medium text-ophir-700 dark:text-ophir-400">
                    Connected Wallet
                  </p>
                  <span className="relative flex h-2.5 w-2.5">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                    <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-green-500" />
                  </span>
                </div>
                <p className="text-xs font-mono text-gray-500 dark:text-gray-400">
                  {shortenAddress(wallet.publicKey, 6)}
                </p>
                <div className="mt-2 flex items-center justify-between">
                  <span className="text-xs text-gray-500 dark:text-gray-400">
                    XLM Balance
                  </span>
                  <span className="text-sm font-mono font-semibold text-gray-900 dark:text-white">
                    {wallet.balanceLoading
                      ? "Loading..."
                      : formatAmount(parseFloat(wallet.balance ?? "0"), "XLM")}
                  </span>
                </div>
                <a
                  href={getAccountExplorerUrl(wallet.publicKey)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-2 inline-flex items-center gap-1 text-xs text-ophir-600 dark:text-ophir-400 hover:underline"
                >
                  View on Explorer ↗
                </a>
              </div>
            ) : (
              <div className="text-center py-8">
                <div className="h-12 w-12 mx-auto rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center mb-3">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                    strokeWidth={1.5}
                    stroke="currentColor"
                    className="w-6 h-6 text-gray-400"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M21 12a2.25 2.25 0 00-2.25-2.25H15a3 3 0 11-6 0H5.25A2.25 2.25 0 003 12m18 0v6a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 18v-6m18 0V9M3 12V9m18 0a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 9m18 0V6a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 6v3"
                    />
                  </svg>
                </div>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  Connect your Stellar wallet
                </p>
                <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                  to view accounts and balances
                </p>
              </div>
            )}
          </div>
        </Card>

        {/* Recent Payments */}
        <Card
          title="Recent On-Chain Payments"
          className="lg:col-span-2"
          actions={
            <Link
              href="/payments"
              className="text-sm text-ophir-600 dark:text-ophir-400 hover:text-ophir-700 dark:hover:text-ophir-300 transition-colors font-medium"
            >
              View all →
            </Link>
          }
        >

          {error && (
            <div className="p-3 rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 mb-3">
              <p className="text-sm text-red-700 dark:text-red-400 mb-2">
                Failed to load on-chain data: {error}
              </p>
              <button
                onClick={() => loadOnChain()}
                className="text-sm text-red-600 dark:text-red-400 underline hover:no-underline font-medium"
              >
                Retry
              </button>
            </div>
          )}

          {loading ? (
            <LoadingSkeleton variant="table" lines={5} />
          ) : payments.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-sm text-gray-500 dark:text-gray-400">
                No on-chain payments yet — send one from the Send page.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-800">
                    <th className="pb-3 font-medium">Payment</th>
                    <th className="pb-3 font-medium">Amount</th>
                    <th className="pb-3 font-medium">Status</th>
                    <th className="pb-3 font-medium">Date</th>
                  </tr>
                </thead>
                <tbody>
                  {payments.map((payment) => (
                    <tr
                      key={payment.id}
                      className="border-b border-gray-100 dark:border-gray-800/50 hover:bg-gray-50 dark:hover:bg-gray-800/30 transition-colors"
                    >
                      <td className="py-3 pr-4">
                        <p className="font-medium text-gray-900 dark:text-white">
                          #{payment.id}
                        </p>
                        <p className="text-xs text-gray-400 font-mono mt-0.5">
                          {shortenAddress(payment.payer, 6)} →{" "}
                          {shortenAddress(payment.payee, 6)}
                        </p>
                        {payment.txHash && (
                          <p className="text-xs text-gray-400 font-mono mt-0.5">
                            {shortenAddress(payment.txHash)}
                          </p>
                        )}
                      </td>
                      <td className="py-3 pr-4 text-gray-700 dark:text-gray-300 font-mono">
                        {formatAmount(payment.amountStroops / XLM_STROOPS, "XLM")}
                      </td>
                      <td className="py-3 pr-4">
                        <Badge variant={payment.metadata === "CANCELLED" ? "danger" : "success"} dot>
                          {payment.metadata === "CANCELLED" ? "CANCELLED" : "RECORDED"}
                        </Badge>
                      </td>
                      <td className="py-3 text-gray-500 dark:text-gray-400 text-xs">
                        {payment.timestamp
                          ? timeAgo(new Date(payment.timestamp * 1000).toISOString())
                          : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      {/* ── Quick Actions ──────────────────────────────────── */}
      <Card title="Quick Actions">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <QuickActionButton
            href="/send"
            label="Send Payment"
            icon="💸"
          />
          <QuickActionButton
            href="/batches/new"
            label="Batch Payment"
            icon="📦"
          />
          <QuickActionButton
            href="/requests"
            label="Payment Request"
            icon="📄"
          />
          <QuickActionButton
            href="/recurring"
            label="Recurring Pay"
            icon="🔄"
          />
        </div>
      </Card>
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────

// ── Count-up animation ────────────────────────────────────────

/** Animate a number from 0 to `target` on mount and between changes. */
function useCountUp(target: number, duration = 800): number {
  const [value, setValue] = useState(0);
  const fromRef = useRef(0);

  useEffect(() => {
    const from = fromRef.current;
    fromRef.current = target;
    if (from === target) return;

    // Skip the animation for users who prefer reduced motion.
    const prefersReducedMotion =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

    if (prefersReducedMotion) {
      setValue(target);
      return;
    }

    let frame = 0;
    const start = performance.now();

    const tick = (now: number) => {
      const progress = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3); // ease-out cubic
      setValue(from + (target - from) * eased);
      if (progress < 1) frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target, duration]);

  return value;
}

/** Renders a formatted number with a subtle count-up animation. */
function AnimatedNumber({
  value,
  format,
  duration = 800,
}: {
  value: number;
  format: (n: number) => string;
  duration?: number;
}) {
  const animated = useCountUp(value, duration);
  return <>{format(animated)}</>;
}

function StatCard({
  title,
  value,
  icon,
  trend,
  trendUp = false,
}: {
  title: string;
  value: React.ReactNode;
  icon: string;
  trend?: string | React.ReactNode;
  trendUp?: boolean;
}) {
  return (
    <Card className="hover:shadow-md transition-shadow duration-200">
      <div className="flex items-center justify-between mb-2">
        <span className="text-2xl">{icon}</span>
        {typeof trend === "string" ? (
          <span
            className={`text-xs font-medium ${
              trendUp
                ? "text-green-600 dark:text-green-400"
                : "text-gray-500 dark:text-gray-400"
            }`}
          >
            {trend}
          </span>
        ) : (
          trend
        )}
      </div>
      <p className="text-2xl font-bold text-gray-900 dark:text-white truncate">
        {value}
      </p>
      <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{title}</p>
    </Card>
  );
}

function QuickActionButton({
  href,
  label,
  icon,
}: {
  href: string;
  label: string;
  icon: string;
}) {
  return (
    <Link
      href={href}
      className="flex flex-col items-center gap-2 p-4 rounded-xl bg-gray-50 dark:bg-gray-800/50 border border-gray-100 dark:border-gray-800 hover:bg-ophir-50 dark:hover:bg-ophir-950/20 hover:border-ophir-200 dark:hover:border-ophir-800 transition-all duration-200 group"
    >
      <span className="text-2xl group-hover:scale-110 transition-transform duration-200">
        {icon}
      </span>
      <span className="text-sm font-medium text-gray-700 dark:text-gray-300 group-hover:text-ophir-700 dark:group-hover:text-ophir-400">
        {label}
      </span>
    </Link>
  );
}
