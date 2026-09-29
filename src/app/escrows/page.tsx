"use client";
// SPDX-License-Identifier: MIT

import { useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { useWallet } from "@/hooks/useMultiWallet";
import { useApiQuery } from "@/hooks/useApiQuery";
import { usePageTitle } from "@/hooks/usePageTitle";
import { PAGE_TITLES } from "@/lib/page-titles";
import { createEscrow, claimEscrow, getContractOwner, releaseEscrow, releaseEscrowByArbiter } from "@/lib/contract-advanced";
import { fetchRecentContractRecords } from "@/lib/on-chain-records";
import type { EscrowData } from "@/types/contract-abi";
import { shortenAddress } from "@/lib/utils";

const XLM_STROOPS = BigInt(10_000_000);
const XLM_ASSET = "native";

function parseXlmAmount(value: string): bigint | null {
  const match = /^(\d+)(?:\.(\d{0,7}))?$/.exec(value.trim());
  if (!match) return null;
  return BigInt(match[1]) * XLM_STROOPS + BigInt((match[2] ?? "").padEnd(7, "0") || "0");
}

function formatStroops(value: number | string | bigint): string {
  const stroops = BigInt(value);
  const whole = stroops / XLM_STROOPS;
  const fractional = (stroops % XLM_STROOPS).toString().padStart(7, "0").replace(/0+$/, "");
  return `${new Intl.NumberFormat().format(whole)}.${fractional.padEnd(2, "0")} XLM`;
}

export default function EscrowsPage() {
  usePageTitle(PAGE_TITLES.ESCROWS);
  const { wallet } = useWallet();
  const toast = useToast();
  const [showCreate, setShowCreate] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [beneficiary, setBeneficiary] = useState("");
  const [arbiter, setArbiter] = useState("");
  const [amount, setAmount] = useState("");
  const [deadline, setDeadline] = useState("");
  const [metadata, setMetadata] = useState("");
  const { data: contractOwner } = useApiQuery<string>(
    ["contract-owner"],
    undefined,
    { staleTime: 60_000 },
    getContractOwner,
  );

  const {
    data: escrows = [],
    isLoading,
    isError,
    error,
    refetch,
  } = useApiQuery<EscrowData[]>(
    ["escrows"],
    undefined,
    undefined,
    () => fetchRecentContractRecords<EscrowData>("escrows"),
  );

  const submit = async (action: () => Promise<{ success: boolean; error?: string }>, success: string) => {
    setSubmitting(true);
    try {
      const result = await action();
      if (!result.success) throw new Error(result.error || "The escrow transaction failed.");
      toast.success(success);
      setShowCreate(false);
      await refetch();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "The escrow transaction failed.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleCreate = async () => {
    if (!wallet.publicKey) {
      toast.error("Connect the depositor wallet first.");
      return;
    }
    if (!beneficiary.trim() || !amount || !deadline) {
      toast.error("Beneficiary, amount, and deadline are required.");
      return;
    }
    const deadlineSeconds = Math.floor(new Date(deadline).getTime() / 1000);
    const stroops = parseXlmAmount(amount);
    if (stroops === null || stroops <= BigInt(0) || !Number.isSafeInteger(deadlineSeconds)) {
      toast.error("Enter a valid amount and deadline.");
      return;
    }
    await submit(
      () => createEscrow(
        wallet.publicKey!,
        beneficiary.trim(),
        arbiter.trim() || null,
        stroops,
        XLM_ASSET,
        deadlineSeconds,
        metadata.trim(),
      ),
      "Escrow created",
    );
    setBeneficiary("");
    setArbiter("");
    setAmount("");
    setDeadline("");
    setMetadata("");
  };

  const handleClaim = (id: number) => {
    if (!wallet.publicKey) return;
    return submit(() => claimEscrow(wallet.publicKey!, id), `Escrow ${id} claimed`);
  };

  const handleArbiterRelease = (id: number, toBeneficiary: boolean) => {
    if (!wallet.publicKey) return;
    return submit(
      () => releaseEscrowByArbiter(wallet.publicKey!, id, toBeneficiary),
      `Escrow ${id} released`,
    );
  };

  const handleOwnerRelease = (id: number) => {
    if (!wallet.publicKey) return;
    return submit(() => releaseEscrow(wallet.publicKey!, id), `Escrow ${id} released`);
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Escrows</h1>
          <p className="mt-1 text-gray-500 dark:text-gray-400">
            Lock XLM until the beneficiary can claim or an arbiter resolves the escrow.
          </p>
        </div>
        <Button onClick={() => setShowCreate(true)} disabled={!wallet.connected}>
          + Create escrow
        </Button>
      </div>

      {!wallet.connected && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
          Connect a wallet to create, claim, or arbitrate escrows.
        </p>
      )}

      {isLoading ? (
        <p className="text-sm text-gray-500">Loading on-chain escrows…</p>
      ) : isError ? (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/30 dark:text-red-300">
          {error?.message || "Unable to load escrows from the Stellar network."}
        </div>
      ) : escrows.length === 0 ? (
        <Card className="p-8 text-center">
          <h2 className="font-semibold text-gray-900 dark:text-white">No escrows yet</h2>
          <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
            New escrows appear here after their creation transaction confirms.
          </p>
        </Card>
      ) : (
        <div className="space-y-3">
          {escrows.map((escrow) => {
            const id = Number(escrow.id);
            const isSettled = escrow.released || escrow.claimed;
            const deadlineReached = Math.floor(Date.now() / 1000) >= Number(escrow.deadline);
            const isBeneficiary = wallet.publicKey === escrow.beneficiary;
            const isArbiter = Boolean(escrow.arbiter && wallet.publicKey === escrow.arbiter);
            return (
              <Card key={id} className="space-y-3 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="font-semibold text-gray-900 dark:text-white">Escrow #{id}</h2>
                  <Badge variant={isSettled ? "success" : "info"}>{isSettled ? "Settled" : "Locked"}</Badge>
                  <span className="ml-auto text-lg font-semibold text-gray-900 dark:text-white">
                    {formatStroops(escrow.amount)}
                  </span>
                </div>
                <dl className="grid gap-2 text-sm text-gray-600 dark:text-gray-400 sm:grid-cols-2">
                  <div><dt className="inline font-medium">Depositor: </dt><dd className="inline font-mono">{shortenAddress(escrow.depositor, 12)}</dd></div>
                  <div><dt className="inline font-medium">Beneficiary: </dt><dd className="inline font-mono">{shortenAddress(escrow.beneficiary, 12)}</dd></div>
                  <div><dt className="inline font-medium">Arbiter: </dt><dd className="inline font-mono">{escrow.arbiter ? shortenAddress(escrow.arbiter, 12) : "Not set"}</dd></div>
                  <div><dt className="inline font-medium">Claimable after: </dt><dd className="inline">{new Date(Number(escrow.deadline) * 1000).toLocaleString()}</dd></div>
                </dl>
                {escrow.metadata && <p className="text-sm text-gray-500">{escrow.metadata}</p>}
                {!isSettled && wallet.connected && (
                  <div className="flex flex-wrap gap-2">
                    {isBeneficiary && deadlineReached && (
                      <Button size="sm" onClick={() => void handleClaim(id)} loading={submitting}>Claim escrow</Button>
                    )}
                    {isArbiter && (
                      <>
                        <Button size="sm" onClick={() => void handleArbiterRelease(id, true)} loading={submitting}>Release to beneficiary</Button>
                        <Button size="sm" variant="secondary" onClick={() => void handleArbiterRelease(id, false)} loading={submitting}>Return to depositor</Button>
                      </>
                    )}
                    {wallet.publicKey === contractOwner && (
                      <Button size="sm" onClick={() => void handleOwnerRelease(id)} loading={submitting}>Owner release</Button>
                    )}
                    {isBeneficiary && !deadlineReached && (
                      <span className="self-center text-xs text-gray-500">Claim becomes available after the deadline.</span>
                    )}
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}

      <Modal open={showCreate} onClose={() => setShowCreate(false)} title="Create escrow" description="Deposit XLM into a contract escrow with an optional arbiter.">
        <div className="space-y-4">
          <label className="block text-sm">Beneficiary Stellar address
            <input value={beneficiary} onChange={(e) => setBeneficiary(e.target.value)} className="mt-1 w-full rounded-lg border px-3 py-2 font-mono text-xs dark:border-gray-700 dark:bg-gray-800" placeholder="G…" />
          </label>
          <label className="block text-sm">Arbiter address <span className="text-gray-500">(optional)</span>
            <input value={arbiter} onChange={(e) => setArbiter(e.target.value)} className="mt-1 w-full rounded-lg border px-3 py-2 font-mono text-xs dark:border-gray-700 dark:bg-gray-800" placeholder="G…" />
          </label>
          <label className="block text-sm">Amount (XLM)
            <input type="number" min="0.0000001" step="0.0000001" value={amount} onChange={(e) => setAmount(e.target.value)} className="mt-1 w-full rounded-lg border px-3 py-2 dark:border-gray-700 dark:bg-gray-800" />
          </label>
          <label className="block text-sm">Beneficiary claim deadline
            <input type="datetime-local" value={deadline} onChange={(e) => setDeadline(e.target.value)} className="mt-1 w-full rounded-lg border px-3 py-2 dark:border-gray-700 dark:bg-gray-800" />
          </label>
          <label className="block text-sm">Memo <span className="text-gray-500">(optional)</span>
            <input value={metadata} onChange={(e) => setMetadata(e.target.value)} maxLength={256} className="mt-1 w-full rounded-lg border px-3 py-2 dark:border-gray-700 dark:bg-gray-800" />
          </label>
          <Button className="w-full" loading={submitting} onClick={() => void handleCreate()}>Sign and create escrow</Button>
        </div>
      </Modal>
    </div>
  );
}
