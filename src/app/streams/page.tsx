"use client";
// SPDX-License-Identifier: MIT

import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Modal } from "@/components/ui/Modal";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { useToast } from "@/components/ui/Toast";
import { useApiQuery } from "@/hooks/useApiQuery";
import { useWallet } from "@/hooks/useMultiWallet";
import { usePageTitle } from "@/hooks/usePageTitle";
import { cancelStream, claimStream, createStream } from "@/lib/contract-advanced";
import { fetchRecentContractRecords } from "@/lib/on-chain-records";
import { formatXlmStroops, parseXlmAmount } from "@/lib/stellar-amount";
import { PAGE_TITLES } from "@/lib/page-titles";
import { isValidStellarAddress } from "@/lib/stellar";
import { shortenAddress } from "@/lib/utils";
import type { StreamData } from "@/types/contract-abi";

function computeVested(total: bigint, start: bigint, end: bigint, now: bigint): bigint {
  if (now <= start) return BigInt(0);
  if (now >= end) return total;
  return total * (now - start) / (end - start);
}

function progressPercent(vested: bigint, total: bigint): number {
  if (total <= BigInt(0)) return 0;
  return Number(vested * BigInt(10_000) / total) / 100;
}

function localDateTimeNow(): string {
  const now = new Date();
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
  return now.toISOString().slice(0, 16);
}

export default function StreamsPage() {
  usePageTitle(PAGE_TITLES.STREAMS);
  const { wallet } = useWallet();
  const toast = useToast();
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  const [showCreate, setShowCreate] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("");
  const [startTime, setStartTime] = useState(localDateTimeNow);
  const [endTime, setEndTime] = useState("");
  const [metadata, setMetadata] = useState("");
  const {
    data: streams = [],
    isLoading,
    isError,
    error,
    refetch,
  } = useApiQuery<StreamData[]>(
    ["streams"],
    undefined,
    undefined,
    () => fetchRecentContractRecords<StreamData>("streams"),
  );

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Math.floor(Date.now() / 1000)), 15_000);
    return () => window.clearInterval(timer);
  }, []);

  const submit = async (
    action: () => Promise<{ success: boolean; error?: string }>,
    success: string,
  ) => {
    setSubmitting(true);
    try {
      const result = await action();
      if (!result.success) throw new Error(result.error || "The stream transaction failed.");
      toast.success(success);
      setShowCreate(false);
      await refetch();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "The stream transaction failed.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleCreate = async () => {
    if (!wallet.publicKey) {
      toast.error("Connect the creator wallet first.");
      return;
    }
    const parsedAmount = parseXlmAmount(amount);
    const start = Math.floor(new Date(startTime).getTime() / 1000);
    const end = Math.floor(new Date(endTime).getTime() / 1000);
    if (!isValidStellarAddress(recipient.trim())) {
      toast.error("Enter a valid recipient Stellar address.");
      return;
    }
    if (parsedAmount === null || parsedAmount <= BigInt(0)) {
      toast.error("Enter a valid amount greater than zero (up to 7 decimal places).");
      return;
    }
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || end <= start) {
      toast.error("The end time must be later than the start time.");
      return;
    }
    await submit(
      () => createStream(
        wallet.publicKey!,
        recipient.trim(),
        parsedAmount,
        "native",
        start,
        end,
        metadata.trim(),
      ),
      "Payment stream created",
    );
    setRecipient("");
    setAmount("");
    setStartTime(localDateTimeNow());
    setEndTime("");
    setMetadata("");
  };

  const handleClaim = (id: number) => {
    if (!wallet.publicKey) return;
    return submit(() => claimStream(wallet.publicKey!, id), `Stream ${id} claimed`);
  };

  const handleCancel = (id: number) => {
    if (!wallet.publicKey) return;
    return submit(
      () => cancelStream(wallet.publicKey!, id),
      `Stream ${id} cancelled; vested tokens were paid to the recipient and the remainder returned.`,
    );
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Payment Streams</h1>
          <p className="mt-1 text-gray-500 dark:text-gray-400">
            Fund a stream once, then tokens vest linearly between its start and end times.
          </p>
        </div>
        <Button onClick={() => setShowCreate(true)} disabled={!wallet.connected}>
          + Create stream
        </Button>
      </div>

      {!wallet.connected && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
          Connect a wallet to create, claim, or cancel payment streams.
        </p>
      )}

      {isLoading ? (
        <p className="text-sm text-gray-500">Loading on-chain streams…</p>
      ) : isError ? (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/30 dark:text-red-300">
          {error?.message || "Unable to load payment streams from the Stellar network."}
        </div>
      ) : streams.length === 0 ? (
        <Card className="p-8 text-center">
          <h2 className="font-semibold text-gray-900 dark:text-white">No payment streams yet</h2>
          <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
            Create a stream to see its vesting progress and claimable balance here.
          </p>
        </Card>
      ) : (
        <div className="space-y-3">
          {streams.map((stream) => {
            const id = Number(stream.id);
            const total = BigInt(stream.total_amount);
            const claimed = BigInt(stream.claimed_amount);
            const start = BigInt(stream.start_time);
            const end = BigInt(stream.end_time);
            const vested = stream.cancelled
              ? claimed
              : computeVested(total, start, end, BigInt(now));
            const claimable = vested > claimed ? vested - claimed : BigInt(0);
            const percent = progressPercent(vested, total);
            const isCreator = wallet.publicKey === stream.creator;
            const isRecipient = wallet.publicKey === stream.recipient;
            return (
              <Card key={id} className="space-y-4 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="font-semibold text-gray-900 dark:text-white">Stream #{id}</h2>
                  <Badge variant={stream.cancelled ? "danger" : percent >= 100 ? "success" : "info"}>
                    {stream.cancelled ? "Cancelled" : percent >= 100 ? "Fully vested" : "Active"}
                  </Badge>
                  <span className="ml-auto text-lg font-semibold text-gray-900 dark:text-white">
                    {formatXlmStroops(total)}
                  </span>
                </div>
                <div className="space-y-1">
                  <div className="flex justify-between gap-3 text-sm text-gray-600 dark:text-gray-400">
                    <span>{stream.cancelled ? "Paid to recipient" : "Vested"}: {formatXlmStroops(vested)}</span>
                    <span>Claimed: {formatXlmStroops(claimed)}</span>
                  </div>
                  <ProgressBar value={percent} showLabel />
                  {isRecipient && claimable > BigInt(0) && !stream.cancelled && (
                    <p className="text-sm font-medium text-green-700 dark:text-green-400">
                      Claimable now: {formatXlmStroops(claimable)}
                    </p>
                  )}
                </div>
                <dl className="grid gap-2 text-sm text-gray-600 dark:text-gray-400 sm:grid-cols-2">
                  <div><dt className="inline font-medium">Creator: </dt><dd className="inline font-mono">{shortenAddress(stream.creator, 12)}</dd></div>
                  <div><dt className="inline font-medium">Recipient: </dt><dd className="inline font-mono">{shortenAddress(stream.recipient, 12)}</dd></div>
                  <div><dt className="inline font-medium">Starts: </dt><dd className="inline">{new Date(Number(start) * 1000).toLocaleString()}</dd></div>
                  <div><dt className="inline font-medium">Ends: </dt><dd className="inline">{new Date(Number(end) * 1000).toLocaleString()}</dd></div>
                </dl>
                {stream.metadata && <p className="text-sm text-gray-500 dark:text-gray-400">{stream.metadata}</p>}
                {wallet.connected && !stream.cancelled && (
                  <div className="flex flex-wrap gap-2">
                    {isRecipient && claimable > BigInt(0) && (
                      <Button size="sm" onClick={() => void handleClaim(id)} loading={submitting}>Claim vested tokens</Button>
                    )}
                    {isCreator && (
                      <Button size="sm" variant="secondary" onClick={() => void handleCancel(id)} loading={submitting}>Cancel stream</Button>
                    )}
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}

      <p className="text-xs text-gray-500 dark:text-gray-400">
        The dashboard currently creates XLM streams. Cancellation immediately pays any vested but unclaimed tokens to the recipient and returns the unvested balance to the creator.
      </p>

      <Modal open={showCreate} onClose={() => setShowCreate(false)} title="Create payment stream" description="Deposit XLM and choose a linear vesting period.">
        <div className="space-y-4">
          <label className="block text-sm">Recipient Stellar address
            <input value={recipient} onChange={(e) => setRecipient(e.target.value)} className="mt-1 w-full rounded-lg border px-3 py-2 font-mono text-xs dark:border-gray-700 dark:bg-gray-800" placeholder="G…" />
          </label>
          <label className="block text-sm">Total amount (XLM)
            <input type="number" min="0.0000001" step="0.0000001" value={amount} onChange={(e) => setAmount(e.target.value)} className="mt-1 w-full rounded-lg border px-3 py-2 dark:border-gray-700 dark:bg-gray-800" />
          </label>
          <label className="block text-sm">Start time
            <input type="datetime-local" value={startTime} onChange={(e) => setStartTime(e.target.value)} className="mt-1 w-full rounded-lg border px-3 py-2 dark:border-gray-700 dark:bg-gray-800" />
          </label>
          <label className="block text-sm">End time
            <input type="datetime-local" value={endTime} onChange={(e) => setEndTime(e.target.value)} className="mt-1 w-full rounded-lg border px-3 py-2 dark:border-gray-700 dark:bg-gray-800" />
          </label>
          <label className="block text-sm">Memo <span className="text-gray-500">(optional)</span>
            <input value={metadata} onChange={(e) => setMetadata(e.target.value)} maxLength={256} className="mt-1 w-full rounded-lg border px-3 py-2 dark:border-gray-700 dark:bg-gray-800" />
          </label>
          <Button className="w-full" loading={submitting} onClick={() => void handleCreate()}>Sign and create stream</Button>
        </div>
      </Modal>
    </div>
  );
}
