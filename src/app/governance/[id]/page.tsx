"use client";
// SPDX-License-Identifier: MIT

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/EmptyState";
import { LoadingSkeleton } from "@/components/LoadingSkeleton";
import { useToast } from "@/components/ui/Toast";
import { useWallet } from "@/hooks/useMultiWallet";
import { useApiMutation, useApiQuery, type ApiError } from "@/hooks/useApiQuery";
import { usePageTitle } from "@/hooks/usePageTitle";
import { getGovernanceProposalState } from "@/lib/governance-state";

interface Proposal {
  id: number;
  title: string;
  description: string;
  action_type: string;
  target: string;
  data: string;
  yes_votes: number;
  no_votes: number;
  voting_ends_at: number;
  created_at: number;
  executed: boolean;
  proposer: string;
  deposit_amount: number;
  deposit_asset: string;
}

interface GovernanceConfig {
  min_proposal_deposit: number;
  voting_period: number;
  quorum_bps: number;
  enabled: boolean;
}

interface ProposalDetail {
  proposal: Proposal;
  config: GovernanceConfig | null;
  voteHistory: Array<{
    voter: string | null;
    support: boolean | null;
    transactionHash: string | null;
    recordedAt: string;
  }>;
}

function countdown(seconds: number): string {
  if (seconds <= 0) return "Voting period ended";
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return days > 0 ? `${days}d ${hours}h remaining` : `${hours}h ${minutes}m remaining`;
}

export default function GovernanceProposalDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const { wallet } = useWallet();
  const toast = useToast();
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  usePageTitle(`Proposal #${id}`);

  useEffect(() => {
    const interval = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 30_000);
    return () => clearInterval(interval);
  }, []);

  const { data, isLoading, isError, refetch } = useApiQuery<ProposalDetail>(
    ["governance", "proposal", id],
    `/api/governance/proposals/${encodeURIComponent(id)}`,
    { enabled: /^\d+$/.test(id) },
  );
  const voteMutation = useApiMutation<{ voter: string; proposalId: number; support: boolean }, { voted: boolean }>(
    "/api/governance/vote",
    { invalidateKeys: [["governance"]] },
  );
  const executeMutation = useApiMutation<{ proposalId: number }, { executed: boolean }>(
    "/api/governance/execute",
    { invalidateKeys: [["governance"]] },
  );

  const proposal = data?.proposal;
  const state = proposal ? getGovernanceProposalState(proposal, now) : null;
  const totalVotes = proposal ? proposal.yes_votes + proposal.no_votes : 0;
  const yesPercent = totalVotes ? Math.round((proposal!.yes_votes / totalVotes) * 100) : 0;
  const canExecute = Boolean(proposal && !proposal.executed && now > proposal.voting_ends_at);

  const vote = async (support: boolean) => {
    if (!wallet.publicKey || !proposal) {
      toast.error("Connect your wallet first");
      return;
    }
    try {
      await voteMutation.mutateAsync({ voter: wallet.publicKey, proposalId: proposal.id, support });
      toast.success(support ? "Voted YES on-chain" : "Voted NO on-chain");
      await refetch();
    } catch (error) {
      toast.error((error as ApiError).message || "Vote failed");
    }
  };

  const execute = async () => {
    if (!proposal) return;
    try {
      await executeMutation.mutateAsync({ proposalId: proposal.id });
      toast.success("Proposal executed on-chain");
      await refetch();
    } catch (error) {
      toast.error((error as ApiError).message || "Execution failed");
    }
  };

  if (isLoading) return <div className="space-y-5"><LoadingSkeleton lines={4} variant="card" /></div>;
  if (isError || !proposal || !state) {
    return (
      <EmptyState
        icon={
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-8 h-8 text-gray-400">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
          </svg>
        }
        title="Proposal unavailable"
        description="Could not load this on-chain proposal."
        actionLabel="Retry"
        onAction={() => refetch()}
      />
    );
  }

  const labels = {
    pending: "Pending",
    active: "Active",
    passed: "Passed — ready to execute",
    failed: "Failed",
    executed: "Executed",
    cancelled: "Cancelled",
  };
  const badgeVariant = state === "active" || state === "pending" ? "info" : state === "passed" || (state === "executed" && proposal.yes_votes > proposal.no_votes) ? "success" : "warning";

  return (
    <main className="space-y-6 animate-fade-in">
      <Link href="/governance" className="text-sm text-ophir-700 dark:text-ophir-300 hover:underline">← Back to governance</Link>
      <Card className="p-6 space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs text-gray-500">Proposal #{proposal.id}</p>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white mt-1">{proposal.title}</h1>
          </div>
          <Badge variant={badgeVariant}>{labels[state]}</Badge>
        </div>
        <p className="whitespace-pre-wrap text-sm text-gray-700 dark:text-gray-300">{proposal.description}</p>
        <dl className="grid gap-4 sm:grid-cols-2">
          <div><dt className="text-xs text-gray-500">Proposer</dt><dd className="mt-1 font-mono text-xs break-all">{proposal.proposer}</dd></div>
          <div><dt className="text-xs text-gray-500">Action</dt><dd className="mt-1 text-sm">{proposal.action_type}{proposal.target ? ` · ${proposal.target}` : ""}</dd></div>
          <div><dt className="text-xs text-gray-500">Deposit</dt><dd className="mt-1 text-sm">{(proposal.deposit_amount / 10_000_000).toLocaleString()} {proposal.deposit_asset ? "asset units" : "XLM"}</dd></div>
          <div><dt className="text-xs text-gray-500">Created</dt><dd className="mt-1 text-sm">{new Date(proposal.created_at * 1000).toLocaleString()}</dd></div>
          <div><dt className="text-xs text-gray-500">Voting window</dt><dd className="mt-1 text-sm">{countdown(proposal.voting_ends_at - now)} · ends {new Date(proposal.voting_ends_at * 1000).toLocaleString()}</dd></div>
          <div><dt className="text-xs text-gray-500">Configured quorum</dt><dd className="mt-1 text-sm">{data.config ? `${(data.config.quorum_bps / 100).toFixed(2)}%` : "Configuration unavailable"}</dd></div>
        </dl>
        <section aria-label="Vote tally" className="space-y-2">
          <div className="flex justify-between text-sm"><span>Yes: {proposal.yes_votes}</span><span>No: {proposal.no_votes}</span></div>
          <div className="h-3 rounded-full bg-red-200 dark:bg-red-950 overflow-hidden"><div className="h-full bg-green-500" style={{ width: `${yesPercent}%` }} /></div>
          <p className="text-xs text-gray-500">The contract accepts execution after voting ends when yes votes exceed no votes. Quorum is shown from the governance configuration; this proposal’s contract execution rule is majority-based.</p>
          <div className="space-y-2">
            <h2 className="text-sm font-semibold text-gray-800 dark:text-gray-200">Vote history</h2>
            {data.voteHistory.length === 0 ? (
              <p className="text-xs text-gray-500">No app-recorded votes yet. Votes cast directly through other contract clients are not indexed in this history.</p>
            ) : (
              <ul className="divide-y divide-gray-200 dark:divide-gray-700">
                {data.voteHistory.map((vote, index) => (
                  <li key={`${vote.transactionHash ?? vote.recordedAt}-${index}`} className="flex flex-wrap items-center justify-between gap-2 py-2 text-xs">
                    <span className="font-mono break-all">{vote.voter ?? "Unknown voter"}</span>
                    <span className={vote.support ? "text-green-600" : "text-red-600"}>{vote.support === null ? "Unknown" : vote.support ? "Yes" : "No"}</span>
                    <span className="text-gray-500">{new Date(vote.recordedAt).toLocaleString()}</span>
                    {vote.transactionHash && <a className="text-ophir-700 dark:text-ophir-300 hover:underline" href={`https://stellar.expert/explorer/${process.env.NEXT_PUBLIC_STELLAR_NETWORK === "PUBLIC" ? "public" : "testnet"}/tx/${encodeURIComponent(vote.transactionHash)}`} target="_blank" rel="noreferrer">Transaction</a>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
        <div className="flex flex-wrap gap-2">
          {state === "active" && <><Button size="sm" onClick={() => vote(true)} loading={voteMutation.isPending}>👍 Yes</Button><Button size="sm" variant="secondary" onClick={() => vote(false)} loading={voteMutation.isPending}>👎 No</Button></>}
          {canExecute && <Button size="sm" onClick={execute} loading={executeMutation.isPending}>Execute proposal</Button>}
          {state === "executed" && <p className="text-sm text-gray-600 dark:text-gray-300">Outcome: {proposal.yes_votes > proposal.no_votes ? "passed" : "defeated"}.</p>}
        </div>
      </Card>
    </main>
  );
}