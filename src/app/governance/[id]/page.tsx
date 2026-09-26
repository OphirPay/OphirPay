"use client";
// SPDX-License-Identifier: MIT

import Link from "next/link";
import { useParams } from "next/navigation";
import { usePageTitle } from "@/hooks/usePageTitle";
import { PAGE_TITLES } from "@/lib/page-titles";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { LoadingSkeleton } from "@/components/LoadingSkeleton";
import { EmptyState } from "@/components/EmptyState";
import { useToast } from "@/components/ui/Toast";
import { useWallet } from "@/hooks/useMultiWallet";
import { useApiQuery, useApiMutation, type ApiError } from "@/hooks/useApiQuery";
import {
  deriveProposalState,
  canExecuteProposal,
  votingSecondsLeft,
  type ProposalState,
} from "@/lib/governance-state";

interface ProposalDetail {
  id: number;
  title: string;
  description: string;
  action_type: string;
  proposer: string;
  yes_votes: number;
  no_votes: number;
  voting_ends_at: number | null;
  executed: boolean;
  deposit_asset?: string | null;
  deposit_amount?: number | string | null;
}

interface GovernanceConfig {
  min_proposal_deposit?: number | string;
  voting_period?: number;
  quorum_bps?: number;
  enabled?: boolean;
}

const STATE_BADGE: Record<ProposalState, { variant: "success" | "danger" | "info" | "warning"; label: string }> = {
  executed: { variant: "success", label: "Executed" },
  passed: { variant: "success", label: "Passed" },
  active: { variant: "info", label: "Voting" },
  pending: { variant: "warning", label: "Pending" },
  failed: { variant: "danger", label: "Defeated" },
};

function formatCountdown(totalSeconds: number): string {
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h left`;
  if (hours > 0) return `${hours}h ${minutes}m left`;
  return `${minutes}m left`;
}

export default function GovernanceProposalPage() {
  usePageTitle(PAGE_TITLES.GOVERNANCE);
  const params = useParams<{ id: string }>();
  const id = Array.isArray(params?.id) ? params.id[0] : (params?.id ?? "");
  const toast = useToast();
  const { wallet } = useWallet();

  const {
    data,
    isLoading: loading,
    isError,
    refetch,
  } = useApiQuery<{ proposal: ProposalDetail; config: GovernanceConfig | null }>(
    ["governance", "proposal", id],
    `/api/governance/proposals/${id}`,
  );

  const voteMutation = useApiMutation<
    { voter: string; proposalId: number; support: boolean },
    { voted: boolean }
  >("/api/governance/vote", { invalidateKeys: [["governance"]] });
  const executeMutation = useApiMutation<{ proposalId: number }, { executed: boolean }>(
    "/api/governance/execute",
    { invalidateKeys: [["governance"]] },
  );

  if (loading) {
    return (
      <div className="space-y-6 animate-fade-in">
        <LoadingSkeleton lines={3} variant="card" />
      </div>
    );
  }

  if (isError || !data?.proposal) {
    return (
      <div className="space-y-6 animate-fade-in">
        <EmptyState
          icon={<span className="text-2xl">🏛</span>}
          title="Proposal not found"
          description="This proposal does not exist or could not be read on-chain."
          actionLabel="Back to Governance"
          onAction={() => (window.location.href = "/governance")}
        />
      </div>
    );
  }

  const proposal = data.proposal;
  const config = data.config;
  const state = deriveProposalState(proposal);
  const badge = STATE_BADGE[state];
  const total = proposal.yes_votes + proposal.no_votes;
  const yesPct = total === 0 ? 0 : Math.round((proposal.yes_votes / total) * 100);
  const secondsLeft = votingSecondsLeft(proposal);
  const executable = canExecuteProposal(proposal);

  const handleVote = async (support: boolean) => {
    if (!wallet.publicKey) {
      toast.error("Connect your wallet first");
      return;
    }
    try {
      await voteMutation.mutateAsync({ voter: wallet.publicKey, proposalId: proposal.id, support });
      toast.success(support ? "Voted YES on-chain" : "Voted NO on-chain");
      refetch();
    } catch (e) {
      const apiErr = e as ApiError;
      toast.error(apiErr.message || "Vote failed");
    }
  };

  const handleExecute = async () => {
    try {
      await executeMutation.mutateAsync({ proposalId: proposal.id });
      toast.success("Proposal executed on-chain");
      refetch();
    } catch (e) {
      const apiErr = e as ApiError;
      toast.error(apiErr.message || "Execution failed");
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <Link
        href="/governance"
        className="text-sm text-gray-500 dark:text-gray-400 hover:text-ophir-600 dark:hover:text-ophir-400 transition-colors"
      >
        ← All proposals
      </Link>

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
              {proposal.title}
            </h1>
            <Badge variant={badge.variant}>{badge.label}</Badge>
          </div>
          <p className="text-gray-500 dark:text-gray-400 mt-1 text-sm">
            Proposal #{proposal.id} · {proposal.action_type}
          </p>
        </div>
        <div className="flex gap-2">
          {state === "active" && (
            <>
              <Button size="sm" onClick={() => handleVote(true)}>
                Vote Yes
              </Button>
              <Button size="sm" variant="secondary" onClick={() => handleVote(false)}>
                Vote No
              </Button>
            </>
          )}
          {executable && (
            <Button size="sm" variant="primary" onClick={handleExecute}>
              Execute
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        <Card className="lg:col-span-3 p-6">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-white mb-2">
            Description
          </h2>
          <p className="text-sm text-gray-600 dark:text-gray-400 whitespace-pre-wrap">
            {proposal.description || "—"}
          </p>
          <dl className="mt-4 divide-y divide-gray-100 dark:divide-gray-800">
            <div className="flex justify-between py-2 text-sm">
              <dt className="text-gray-500 dark:text-gray-400">Proposer</dt>
              <dd className="font-mono text-xs text-gray-900 dark:text-white break-all">
                {proposal.proposer}
              </dd>
            </div>
            <div className="flex justify-between py-2 text-sm">
              <dt className="text-gray-500 dark:text-gray-400">Deposit</dt>
              <dd className="text-gray-900 dark:text-white">
                {proposal.deposit_amount ?? "—"}
                {proposal.deposit_asset ? ` ${proposal.deposit_asset}` : ""}
              </dd>
            </div>
            <div className="flex justify-between py-2 text-sm">
              <dt className="text-gray-500 dark:text-gray-400">Quorum</dt>
              <dd className="text-gray-900 dark:text-white">
                {config?.quorum_bps !== undefined && config?.quorum_bps !== null
                  ? `${(Number(config.quorum_bps) / 100).toFixed(2)}% of supply`
                  : "—"}
              </dd>
            </div>
            <div className="flex justify-between py-2 text-sm">
              <dt className="text-gray-500 dark:text-gray-400">Voting window</dt>
              <dd className="text-gray-900 dark:text-white">
                {state === "active" ? formatCountdown(secondsLeft) : state === "pending" ? "Not scheduled" : "Closed"}
              </dd>
            </div>
          </dl>
        </Card>

        <Card className="lg:col-span-2 p-6">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-white mb-4">
            Tally
          </h2>
          <div className="flex justify-between text-xs text-gray-500 mb-1">
            <span>Yes: {proposal.yes_votes}</span>
            <span>No: {proposal.no_votes}</span>
          </div>
          <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden flex">
            <div className="h-full bg-green-500 transition-all" style={{ width: `${yesPct}%` }} />
            <div className="h-full bg-red-500 transition-all" style={{ width: `${100 - yesPct}%` }} />
          </div>
          <p className="mt-3 text-xs text-gray-500 dark:text-gray-400">
            Majority of votes cast decides passage; quorum (
            {config?.quorum_bps !== undefined && config?.quorum_bps !== null
              ? `${(Number(config.quorum_bps) / 100).toFixed(2)}% of supply`
              : "unknown"}
            ) is shown for reference.
          </p>
        </Card>
      </div>
    </div>
  );
}
