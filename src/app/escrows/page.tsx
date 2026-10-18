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
import { formatXlmStroops, parseXlmAmount } from "@/lib/stellar-amount";
import type { EscrowData } from "@/types/contract-abi";
import { shortenAddress, cn } from "@/lib/utils";
import { useTableKeyboardNavigation } from "@/hooks/useTableKeyboardNavigation";

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

  const [selectedEscrow, setSelectedEscrow] = useState<EscrowData | null>(null);

  const { activeIndex, getRowProps, onRowsKeyDown, tbodyRef } =
    useTableKeyboardNavigation(escrows.length, {
      onRowSelect: (index) => {
        if (escrows[index]) {
          setSelectedEscrow(escrows[index]);
        }
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
        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900 shadow-sm">
          <table className="w-full text-left text-sm" aria-label="On-chain escrows">
            <thead className="bg-gray-50/75 dark:bg-gray-800/50 text-xs uppercase text-gray-500 border-b border-gray-200 dark:border-gray-800">
              <tr>
                <th scope="col" className="py-3 px-4 font-medium">Escrow ID</th>
                <th scope="col" className="py-3 px-4 font-medium">Status</th>
                <th scope="col" className="py-3 px-4 font-medium">Amount</th>
                <th scope="col" className="py-3 px-4 font-medium">Depositor</th>
                <th scope="col" className="py-3 px-4 font-medium">Beneficiary</th>
                <th scope="col" className="py-3 px-4 font-medium">Arbiter</th>
                <th scope="col" className="py-3 px-4 font-medium">Claimable After</th>
                <th scope="col" className="py-3 px-4 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody ref={tbodyRef} onKeyDown={onRowsKeyDown}>
              {escrows.map((escrow, index) => {
                const id = Number(escrow.id);
                const isSettled = escrow.released || escrow.claimed;
                const deadlineReached = Math.floor(Date.now() / 1000) >= Number(escrow.deadline);
                const isBeneficiary = wallet.publicKey === escrow.beneficiary;
                const isArbiter = Boolean(escrow.arbiter && wallet.publicKey === escrow.arbiter);
                return (
                  <tr
                    key={id}
                    data-row-index={index}
                    {...getRowProps(index)}
                    aria-rowindex={index + 2}
                    onClick={() => setSelectedEscrow(escrow)}
                    className={cn(
                      "border-b border-gray-100 dark:border-gray-800/50 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ophir-500 focus-visible:ring-inset cursor-pointer",
                      index === activeIndex
                        ? "bg-ophir-50/70 dark:bg-ophir-950/40 hover:bg-ophir-100/70 dark:hover:bg-ophir-900/40"
                        : "hover:bg-gray-50 dark:hover:bg-gray-800/30"
                    )}
                  >
                    <td className="py-3 px-4">
                      <h2 className="text-sm font-semibold text-gray-900 dark:text-white">
                        Escrow #{id}
                      </h2>
                      {escrow.metadata && (
                        <p className="text-xs text-gray-500 dark:text-gray-400 truncate max-w-[180px]">
                          {escrow.metadata}
                        </p>
                      )}
                    </td>
                    <td className="py-3 px-4">
                      <Badge variant={isSettled ? "success" : "info"}>
                        {isSettled ? "Settled" : "Locked"}
                      </Badge>
                    </td>
                    <td className="py-3 px-4 font-semibold font-mono text-gray-900 dark:text-white">
                      {formatXlmStroops(escrow.amount)}
                    </td>
                    <td className="py-3 px-4 font-mono text-xs text-gray-600 dark:text-gray-400">
                      {shortenAddress(escrow.depositor, 8)}
                    </td>
                    <td className="py-3 px-4 font-mono text-xs text-gray-600 dark:text-gray-400">
                      {shortenAddress(escrow.beneficiary, 8)}
                    </td>
                    <td className="py-3 px-4 font-mono text-xs text-gray-600 dark:text-gray-400">
                      {escrow.arbiter ? shortenAddress(escrow.arbiter, 8) : "—"}
                    </td>
                    <td className="py-3 px-4 text-xs text-gray-600 dark:text-gray-400">
                      {new Date(Number(escrow.deadline) * 1000).toLocaleString()}
                    </td>
                    <td className="py-3 px-4 text-right">
                      <div
                        className="flex items-center justify-end gap-1.5"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {!isSettled && wallet.connected ? (
                          <>
                            {isBeneficiary && deadlineReached && (
                              <Button
                                size="sm"
                                onClick={() => void handleClaim(id)}
                                loading={submitting}
                              >
                                Claim escrow
                              </Button>
                            )}
                            {isArbiter && (
                              <>
                                <Button
                                  size="sm"
                                  onClick={() => void handleArbiterRelease(id, true)}
                                  loading={submitting}
                                >
                                  Release to beneficiary
                                </Button>
                                <Button
                                  size="sm"
                                  variant="secondary"
                                  onClick={() => void handleArbiterRelease(id, false)}
                                  loading={submitting}
                                >
                                  Return to depositor
                                </Button>
                              </>
                            )}
                            {wallet.publicKey === contractOwner && (
                              <Button
                                size="sm"
                                onClick={() => void handleOwnerRelease(id)}
                                loading={submitting}
                              >
                                Owner release
                              </Button>
                            )}
                            {isBeneficiary && !deadlineReached && (
                              <span className="text-xs text-gray-400">Locked</span>
                            )}
                          </>
                        ) : (
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => setSelectedEscrow(escrow)}
                          >
                            Details
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <Modal
        open={Boolean(selectedEscrow)}
        onClose={() => setSelectedEscrow(null)}
        title={selectedEscrow ? `Escrow #${selectedEscrow.id} Details` : "Escrow Details"}
        description="On-chain escrow terms, participant addresses, and settlement state."
      >
        {selectedEscrow && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <Badge variant={selectedEscrow.released || selectedEscrow.claimed ? "success" : "info"}>
                {selectedEscrow.released || selectedEscrow.claimed ? "Settled" : "Locked"}
              </Badge>
              <span className="text-lg font-bold text-gray-900 dark:text-white">
                {formatXlmStroops(selectedEscrow.amount)}
              </span>
            </div>
            <dl className="grid gap-3 text-sm text-gray-600 dark:text-gray-400 sm:grid-cols-2">
              <div>
                <dt className="font-medium text-gray-900 dark:text-gray-200">Depositor</dt>
                <dd className="font-mono text-xs break-all">{selectedEscrow.depositor}</dd>
              </div>
              <div>
                <dt className="font-medium text-gray-900 dark:text-gray-200">Beneficiary</dt>
                <dd className="font-mono text-xs break-all">{selectedEscrow.beneficiary}</dd>
              </div>
              <div>
                <dt className="font-medium text-gray-900 dark:text-gray-200">Arbiter</dt>
                <dd className="font-mono text-xs break-all">{selectedEscrow.arbiter || "None"}</dd>
              </div>
              <div>
                <dt className="font-medium text-gray-900 dark:text-gray-200">Claim Deadline</dt>
                <dd className="text-xs">
                  {new Date(Number(selectedEscrow.deadline) * 1000).toLocaleString()}
                </dd>
              </div>
            </dl>
            {selectedEscrow.metadata && (
              <div>
                <dt className="font-medium text-gray-900 dark:text-gray-200 text-sm">Memo</dt>
                <dd className="text-sm text-gray-600 dark:text-gray-400 mt-1 p-2 rounded bg-gray-50 dark:bg-gray-800">
                  {selectedEscrow.metadata}
                </dd>
              </div>
            )}
            <div className="pt-2 flex justify-end">
              <Button variant="secondary" onClick={() => setSelectedEscrow(null)}>
                Close
              </Button>
            </div>
          </div>
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
