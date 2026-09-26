"use client";
// SPDX-License-Identifier: MIT

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { usePageTitle } from "@/hooks/usePageTitle";
import { PAGE_TITLES } from "@/lib/page-titles";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { LoadingSkeleton } from "@/components/LoadingSkeleton";
import { EmptyState } from "@/components/EmptyState";
import { useToast } from "@/components/ui/Toast";
import { useWallet } from "@/hooks/useMultiWallet";
import { useApiQuery, type ApiError } from "@/hooks/useApiQuery";
import {
  releaseEscrow,
  claimEscrow,
  releaseEscrowByArbiter,
} from "@/lib/contract-advanced";
import {
  canClaim,
  canArbiterRelease,
  isEscrowSettled,
  secondsUntilUnlock,
  type EscrowRecord,
} from "@/lib/escrow";
import { XLM_STROOPS } from "@/lib/stellar";

function formatCountdown(totalSeconds: number): string {
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  if (days > 0) return `${days}d ${hours}h left`;
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes}m left`;
  return `${Math.max(0, totalSeconds)}s left`;
}

export default function EscrowDetailPage() {
  usePageTitle(PAGE_TITLES.ESCROWS);
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = Array.isArray(params?.id) ? params.id[0] : (params?.id ?? "");
  const toast = useToast();
  const { wallet } = useWallet();

  const {
    data,
    isLoading: loading,
    isError,
    refetch,
  } = useApiQuery<{ available: boolean; error?: string } & Partial<EscrowRecord>>(
    ["escrow", id],
    `/api/escrows?id=${id}`,
  );

  if (loading) {
    return (
      <div className="space-y-6 animate-fade-in">
        <LoadingSkeleton lines={3} variant="card" />
      </div>
    );
  }

  const escrow = data && data.available !== false && typeof data.id !== "undefined"
    ? (data as unknown as EscrowRecord)
    : null;

  if (isError || !escrow) {
    return (
      <div className="space-y-6 animate-fade-in">
        <EmptyState
          icon={<span className="text-2xl">🔒</span>}
          title="Escrow not found"
          description="This escrow does not exist or could not be read on-chain."
          actionLabel="Back to Escrows"
          onAction={() => router.push("/escrows")}
        />
      </div>
    );
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  const settled = isEscrowSettled(escrow);
  const countdown = secondsUntilUnlock(escrow, nowSeconds);
  const showClaim = canClaim(escrow, wallet.publicKey, nowSeconds);
  const showArbiterRelease = canArbiterRelease(escrow, wallet.publicKey);

  const runAction = async (
    label: string,
    fn: () => Promise<{ success: boolean; error?: string }>,
  ) => {
    if (!wallet.publicKey) {
      toast.error("Connect your wallet first");
      return;
    }
    try {
      const result = await fn();
      if (result.success) {
        toast.success(`${label} submitted on-chain`);
        refetch();
      } else {
        toast.error(result.error || `${label} failed`);
      }
    } catch (e) {
      const apiErr = e as ApiError;
      toast.error(apiErr.message || "Network error");
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <Link
        href="/escrows"
        className="text-sm text-gray-500 dark:text-gray-400 hover:text-ophir-600 dark:hover:text-ophir-400 transition-colors"
      >
        ← All escrows
      </Link>

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
              Escrow #{escrow.id}
            </h1>
            <Badge variant={settled ? "success" : "info"}>
              {escrow.claimed ? "Claimed" : escrow.released ? "Released" : "Locked"}
            </Badge>
          </div>
          <p className="text-gray-500 dark:text-gray-400 mt-1 text-sm">
            {(Number(escrow.amount) / XLM_STROOPS).toLocaleString(undefined, {
              maximumFractionDigits: 7,
            })}{" "}
            XLM
            {countdown > 0 ? ` · unlocks in ${formatCountdown(countdown)}` : " · unlocked"}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {showClaim && (
            <Button
              size="sm"
              onClick={() => runAction("Claim", () => claimEscrow(wallet.publicKey!, Number(escrow.id)))}
            >
              Claim
            </Button>
          )}
          {showArbiterRelease && (
            <>
              <Button
                size="sm"
                variant="secondary"
                onClick={() =>
                  runAction("Arbiter release", () =>
                    releaseEscrowByArbiter(wallet.publicKey!, Number(escrow.id), true)
                  )
                }
              >
                Release to Beneficiary
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={() =>
                  runAction("Arbiter release", () =>
                    releaseEscrowByArbiter(wallet.publicKey!, Number(escrow.id), false)
                  )
                }
              >
                Refund Depositor
              </Button>
            </>
          )}
          {!settled && (
            <Button
              size="sm"
              variant="secondary"
              title="Contract owner only — unauthorized attempts surface the contract error"
              onClick={() =>
                runAction("Release", () => releaseEscrow(wallet.publicKey!, Number(escrow.id)))
              }
            >
              Release (Owner)
            </Button>
          )}
        </div>
      </div>

      <Card className="p-6">
        <dl className="divide-y divide-gray-100 dark:divide-gray-800">
          <div className="flex justify-between py-2 text-sm">
            <dt className="text-gray-500 dark:text-gray-400">Depositor</dt>
            <dd className="font-mono text-xs text-gray-900 dark:text-white break-all">
              {escrow.depositor}
            </dd>
          </div>
          <div className="flex justify-between py-2 text-sm">
            <dt className="text-gray-500 dark:text-gray-400">Beneficiary</dt>
            <dd className="font-mono text-xs text-gray-900 dark:text-white break-all">
              {escrow.beneficiary}
            </dd>
          </div>
          <div className="flex justify-between py-2 text-sm">
            <dt className="text-gray-500 dark:text-gray-400">Arbiter</dt>
            <dd className="font-mono text-xs text-gray-900 dark:text-white break-all">
              {escrow.arbiter || "—"}
            </dd>
          </div>
          <div className="flex justify-between py-2 text-sm">
            <dt className="text-gray-500 dark:text-gray-400">Your role</dt>
            <dd className="text-gray-900 dark:text-white">
              {!wallet.publicKey
                ? "Connect wallet"
                : showClaim
                  ? "Beneficiary — you can claim"
                  : showArbiterRelease
                    ? "Arbiter — you can release"
                    : "Viewer"}
            </dd>
          </div>
        </dl>
      </Card>
    </div>
  );
}
