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
import { useTableKeyboardNavigation } from "@/hooks/useTableKeyboardNavigation";
import { PAGE_TITLES } from "@/lib/page-titles";
import {
  createEscrow,
  claimEscrow,
  getContractOwner,
  raiseEscrowDispute,
  releaseEscrow,
  releaseEscrowByArbiter,
  resolveEscrowDispute,
} from "@/lib/contract-advanced";
import { fetchRecentContractRecords } from "@/lib/on-chain-records";
import { formatXlmStroops, parseXlmAmount } from "@/lib/stellar-amount";
import type { EscrowData } from "@/types/contract-abi";
import { cn, shortenAddress } from "@/lib/utils";

const XLM_ASSET = "native";

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
  const [selectedEscrow, setSelectedEscrow] = useState<EscrowData | null>(null);
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

  const { activeIndex, getRowProps, onRowsKeyDown, tbodyRef } =
    useTableKeyboardNavigation<HTMLDivElement>(escrows.length, {
      rowSelector: "[data-row-index]",
      onActivate: (index) => {
        const escrow = escrows[index];
        if (escrow) setSelectedEscrow(escrow);
      },
    });

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

  const handleRaiseDispute = (id: number) => {
    if (!wallet.publicKey) return;
    return submit(
      () => raiseEscrowDispute(wallet.publicKey!, id),
      `Dispute opened for escrow ${id}`,
    );
  };

  const handleResolveDispute = (id: number, releaseToBeneficiary: boolean) => {
    if (!wallet.publicKey) return;
    return submit(
      () => resolveEscrowDispute(wallet.publicKey!, id, releaseToBeneficiary),
      releaseToBeneficiary
        ? `Escrow ${id} resolved for the seller`
        : `Escrow ${id} refunded to the buyer`,
    );
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
        <div
          ref={tbodyRef}
          onKeyDown={onRowsKeyDown}
          role="list"
          aria-label="Escrows"
          className="space-y-3"
        >
          {escrows.map((escrow, index) => {
            const id = Number(escrow.id);
            const isSettled = escrow.released || escrow.claimed;
            const isDisputed = Number(escrow.dispute_initiated_at ?? 0) > 0;
            const deadlineReached = Math.floor(Date.now() / 1000) >= Number(escrow.deadline);
            const isBeneficiary = wallet.publicKey === escrow.beneficiary;
            const isDepositor = wallet.publicKey === escrow.depositor;
            const isArbiter = Boolean(escrow.arbiter && wallet.publicKey === escrow.arbiter);
            return (
              <div
                key={id}
                role="listitem"
                data-row-index={index}
                {...getRowProps(index)}
                className={cn(
                  "rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-ophir-500 dark:focus-visible:ring-offset-gray-900",
                  index === activeIndex && "ring-2 ring-ophir-200 dark:ring-ophir-800"
                )}
              >
              <Card className="space-y-3 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="font-semibold text-gray-900 dark:text-white">Escrow #{id}</h2>
                  <Badge variant={isSettled ? "success" : isDisputed ? "warning" : "info"}>
                    {isSettled ? "Settled" : isDisputed ? "Disputed" : "Locked"}
                  </Badge>
                  <span className="ml-auto text-lg font-semibold text-gray-900 dark:text-white">
                    {formatXlmStroops(escrow.amount)}
                  </span>
                </div>
                {isDisputed && !isSettled && (
                  <div
                    data-testid="dispute-banner"
                    role="status"
                    aria-live="polite"
                    className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950/30 dark:text-amber-200"
                  >
                    <p className="font-semibold">Dispute in progress</p>
                    <p className="mt-1">
                      Funds are held until the designated arbiter resolves this escrow.
                      Claim, owner release, and early arbiter release are disabled.
                    </p>
                  </div>
                )}
                <dl className="grid gap-2 text-sm text-gray-600 dark:text-gray-400 sm:grid-cols-2">
                  <div><dt className="inline font-medium">Depositor: </dt><dd className="inline font-mono">{shortenAddress(escrow.depositor, 12)}</dd></div>
                  <div><dt className="inline font-medium">Beneficiary: </dt><dd className="inline font-mono">{shortenAddress(escrow.beneficiary, 12)}</dd></div>
                  <div><dt className="inline font-medium">Arbiter: </dt><dd className="inline font-mono">{escrow.arbiter ? shortenAddress(escrow.arbiter, 12) : "Not set"}</dd></div>
                  <div><dt className="inline font-medium">Claimable after: </dt><dd className="inline">{new Date(Number(escrow.deadline) * 1000).toLocaleString()}</dd></div>
                </dl>
                {escrow.metadata && <p className="text-sm text-gray-500">{escrow.metadata}</p>}
                {!isSettled && wallet.connected && (
                  <div className="flex flex-wrap gap-2">
                    {isDisputed && isArbiter && (
                      <>
                        <Button
                          data-testid="resolve-to-buyer"
                          size="sm"
                          variant="danger"
                          onClick={() => void handleResolveDispute(id, false)}
                          loading={submitting}
                        >
                          Resolve for buyer
                        </Button>
                        <Button
                          data-testid="resolve-to-seller"
                          size="sm"
                          variant="secondary"
                          onClick={() => void handleResolveDispute(id, true)}
                          loading={submitting}
                        >
                          Resolve for seller
                        </Button>
                      </>
                    )}
                    {isBeneficiary && deadlineReached && (
                      <Button
                        size="sm"
                        disabled={isDisputed}
                        onClick={() => void handleClaim(id)}
                        loading={submitting}
                      >
                        Claim escrow
                      </Button>
                    )}
                    {!isDisputed && isArbiter && (
                      <>
                        <Button size="sm" onClick={() => void handleArbiterRelease(id, true)} loading={submitting}>Release to beneficiary</Button>
                        <Button size="sm" variant="secondary" onClick={() => void handleArbiterRelease(id, false)} loading={submitting}>Return to depositor</Button>
                      </>
                    )}
                    {wallet.publicKey === contractOwner && (
                      <Button
                        size="sm"
                        disabled={isDisputed}
                        onClick={() => void handleOwnerRelease(id)}
                        loading={submitting}
                      >
                        Owner release
                      </Button>
                    )}
                    {!isDisputed && (isDepositor || isBeneficiary) && escrow.arbiter && (
                      <Button
                        data-testid="raise-dispute"
                        size="sm"
                        variant="danger"
                        onClick={() => void handleRaiseDispute(id)}
                        loading={submitting}
                      >
                        Raise dispute
                      </Button>
                    )}
                    {!isDisputed && isBeneficiary && !deadlineReached && (
                      <span className="self-center text-xs text-gray-500">Claim becomes available after the deadline.</span>
                    )}
                  </div>
                )}
              </Card>
              </div>
            );
          })}
        </div>
      )}

      <Modal
        open={selectedEscrow !== null}
        onClose={() => setSelectedEscrow(null)}
        title={selectedEscrow ? `Escrow #${selectedEscrow.id}` : "Escrow details"}
        description="Escrow details"
      >
        {selectedEscrow && (
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <div><dt className="font-medium text-gray-500">Amount</dt><dd className="mt-0.5">{formatXlmStroops(selectedEscrow.amount)}</dd></div>
            <div><dt className="font-medium text-gray-500">Status</dt><dd className="mt-0.5">{selectedEscrow.released || selectedEscrow.claimed ? "Settled" : "Locked"}</dd></div>
            <div><dt className="font-medium text-gray-500">Depositor</dt><dd className="mt-0.5 break-all font-mono text-xs">{selectedEscrow.depositor}</dd></div>
            <div><dt className="font-medium text-gray-500">Beneficiary</dt><dd className="mt-0.5 break-all font-mono text-xs">{selectedEscrow.beneficiary}</dd></div>
            <div><dt className="font-medium text-gray-500">Arbiter</dt><dd className="mt-0.5 break-all font-mono text-xs">{selectedEscrow.arbiter ?? "Not set"}</dd></div>
            <div><dt className="font-medium text-gray-500">Claimable after</dt><dd className="mt-0.5">{new Date(Number(selectedEscrow.deadline) * 1000).toLocaleString()}</dd></div>
            {selectedEscrow.metadata && (
              <div className="sm:col-span-2"><dt className="font-medium text-gray-500">Memo</dt><dd className="mt-0.5">{selectedEscrow.metadata}</dd></div>
            )}
          </dl>
        )}
      </Modal>

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
