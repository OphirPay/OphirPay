"use client";
// SPDX-License-Identifier: MIT

import { useState, use } from "react";
import Link from "next/link";
import { Breadcrumb } from "@/components/Breadcrumb";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { CopyButton } from "@/components/ui/CopyButton";
import { LoadingSkeleton } from "@/components/LoadingSkeleton";
import { EmptyState } from "@/components/EmptyState";
import { useToast } from "@/components/ui/Toast";
import { useWallet } from "@/hooks/useMultiWallet";
import { useApiQuery, useApiMutation, type ApiError } from "@/hooks/useApiQuery";
import { shortenAddress } from "@/lib/utils";
import { getAccountExplorerUrl } from "@/lib/stellar";
import { formatDuration, type ProposalDetail } from "@/lib/governance";

interface ProposalDetailPageProps {
  params: Promise<{ id: string }>;
}

export default function ProposalDetailPage({ params }: ProposalDetailPageProps) {
  const resolvedParams = use(params);
  const proposalId = parseInt(resolvedParams.id, 10);

  const { wallet } = useWallet();
  const toast = useToast();
  const [executionError, setExecutionError] = useState<string | null>(null);

  // Fetch proposal details
  const {
    data: proposal,
    isLoading,
    isError,
    refetch,
  } = useApiQuery<ProposalDetail>(
    ["governance", "proposal", proposalId],
    `/api/governance/proposals/${proposalId}`
  );

  // Vote mutation
  const voteMutation = useApiMutation<
    { voter: string; proposalId: number; support: boolean },
    { voted: boolean }
  >("/api/governance/vote", {
    invalidateKeys: [
      ["governance", "proposal", proposalId],
      ["governance", "proposals"],
    ],
  });

  // Execute mutation
  const executeMutation = useApiMutation<
    { proposalId: number },
    { executed: boolean }
  >("/api/governance/execute", {
    invalidateKeys: [
      ["governance", "proposal", proposalId],
      ["governance", "proposals"],
    ],
  });

  const handleVote = async (support: boolean) => {
    if (!wallet.publicKey) {
      toast.error("Connect your wallet first to vote");
      return;
    }
    try {
      await voteMutation.mutateAsync({
        voter: wallet.publicKey,
        proposalId,
        support,
      });
      toast.success(support ? "Voted YES on-chain" : "Voted NO on-chain");
      refetch();
    } catch (err) {
      const apiErr = err as ApiError;
      toast.error(apiErr.message || "Failed to submit vote");
    }
  };

  const handleExecute = async () => {
    setExecutionError(null);
    try {
      await executeMutation.mutateAsync({ proposalId });
      toast.success("Proposal successfully executed on-chain");
      refetch();
    } catch (err) {
      const apiErr = err as ApiError;
      const errorMsg =
        apiErr.message ||
        "Smart contract execution failed. Ensure voting has concluded and conditions are met.";
      setExecutionError(errorMsg);
      toast.error(errorMsg);
    }
  };

  if (isNaN(proposalId) || proposalId <= 0) {
    return (
      <div className="space-y-6 animate-fade-in">
        <Breadcrumb items={[{ label: "Governance", href: "/governance" }, { label: "Invalid Proposal" }]} />
        <EmptyState
          icon={<span className="text-3xl">⚠️</span>}
          title="Invalid Proposal ID"
          description="The proposal ID specified in the URL is not valid."
          actionLabel="Back to Governance"
          onAction={() => window.location.assign("/governance")}
        />
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="space-y-6 animate-fade-in">
        <Breadcrumb items={[{ label: "Governance", href: "/governance" }, { label: `Proposal #${proposalId}` }]} />
        <LoadingSkeleton lines={6} variant="card" />
      </div>
    );
  }

  if (isError || !proposal) {
    return (
      <div className="space-y-6 animate-fade-in">
        <Breadcrumb items={[{ label: "Governance", href: "/governance" }, { label: `Proposal #${proposalId}` }]} />
        <EmptyState
          icon={<span className="text-3xl">🏛</span>}
          title="Proposal Not Found"
          description={`Unable to load governance proposal #${proposalId} from the Stellar network.`}
          actionLabel="Retry"
          onAction={() => refetch()}
        />
      </div>
    );
  }

  const totalVotes = proposal.yes_votes + proposal.no_votes;
  const yesPercent = totalVotes > 0 ? Math.round((proposal.yes_votes / totalVotes) * 100) : 0;
  const noPercent = totalVotes > 0 ? Math.round((proposal.no_votes / totalVotes) * 100) : 0;
  const quorumPercent = (proposal.config.quorum_bps ?? 5100) / 100;

  // Visual status badge
  const getBadgeVariant = (status: string) => {
    switch (status) {
      case "active":
        return "info";
      case "passed":
        return "success";
      case "executed":
        return "default";
      case "failed":
        return "danger";
      case "pending":
      case "cancelled":
      default:
        return "warning";
    }
  };

  const getStatusLabel = (status: string) => {
    switch (status) {
      case "active":
        return "Voting Active";
      case "passed":
        return "Passed";
      case "executed":
        return "Executed";
      case "failed":
        return "Defeated";
      case "pending":
        return "Pending";
      case "cancelled":
        return "Cancelled";
      default:
        return status;
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <Breadcrumb
        items={[
          { label: "Governance", href: "/governance" },
          { label: `Proposal #${proposal.id}` },
        ]}
      />

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1.5">
            <Link
              href="/governance"
              className="text-xs text-gray-500 hover:text-ophir-600 dark:hover:text-ophir-400 font-medium transition-colors"
            >
              ← Back to Proposals
            </Link>
            <span className="text-xs text-gray-300 dark:text-gray-600">|</span>
            <span className="text-xs font-mono text-gray-400">ID #{proposal.id}</span>
          </div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
            {proposal.title}
          </h1>
        </div>

        <div className="flex items-center gap-2">
          <Badge variant={getBadgeVariant(proposal.status)} size="lg">
            {getStatusLabel(proposal.status)}
          </Badge>
          <Badge variant="outline" size="lg">
            {proposal.action_type}
          </Badge>
        </div>
      </div>

      {/* Visual Timeline / Stage Indicators */}
      <Card className="p-4 sm:p-5">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-3">
          Proposal Lifecycle Timeline
        </h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
          {/* Stage 1: Proposed */}
          <div className="p-3 rounded-lg border border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-900/50">
            <span className="w-5 h-5 rounded-full bg-emerald-100 dark:bg-emerald-900/50 text-emerald-600 dark:text-emerald-400 text-xs font-bold inline-flex items-center justify-center mb-1">
              ✓
            </span>
            <p className="text-xs font-medium text-gray-900 dark:text-white">1. Proposed</p>
            <p className="text-[11px] text-gray-400 mt-0.5">
              {proposal.created_at
                ? new Date(proposal.created_at * 1000).toLocaleDateString()
                : "Created"}
            </p>
          </div>

          {/* Stage 2: Voting */}
          <div
            className={`p-3 rounded-lg border ${
              proposal.status === "active"
                ? "border-ophir-400 dark:border-ophir-600 bg-ophir-50/50 dark:bg-ophir-950/20"
                : proposal.votingTiming.isOpen
                  ? "border-emerald-200 dark:border-emerald-800 bg-emerald-50/30"
                  : "border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-900/50"
            }`}
          >
            <span
              className={`w-5 h-5 rounded-full text-xs font-bold inline-flex items-center justify-center mb-1 ${
                proposal.status === "active"
                  ? "bg-ophir-600 text-white animate-pulse"
                  : "bg-emerald-100 dark:bg-emerald-900/50 text-emerald-600 dark:text-emerald-400"
              }`}
            >
              {proposal.status === "active" ? "•" : "✓"}
            </span>
            <p className="text-xs font-medium text-gray-900 dark:text-white">2. Voting Window</p>
            <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">
              {proposal.status === "active"
                ? `${proposal.votingTiming.formattedRemaining} left`
                : "Concluded"}
            </p>
          </div>

          {/* Stage 3: Outcome */}
          <div
            className={`p-3 rounded-lg border ${
              proposal.status === "passed" || (proposal.status === "executed" && proposal.yes_votes > proposal.no_votes)
                ? "border-emerald-300 dark:border-emerald-700 bg-emerald-50 dark:bg-emerald-950/30"
                : proposal.status === "failed"
                  ? "border-rose-300 dark:border-rose-700 bg-rose-50 dark:bg-rose-950/30"
                  : "border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-900/50"
            }`}
          >
            <span className="w-5 h-5 rounded-full bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 text-xs font-bold inline-flex items-center justify-center mb-1">
              {proposal.status === "passed" || (proposal.status === "executed" && proposal.yes_votes > proposal.no_votes)
                ? "✓"
                : proposal.status === "failed"
                  ? "✕"
                  : "3"}
            </span>
            <p className="text-xs font-medium text-gray-900 dark:text-white">3. Outcome</p>
            <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">
              {proposal.status === "passed" || (proposal.status === "executed" && proposal.yes_votes > proposal.no_votes)
                ? "Passed"
                : proposal.status === "failed"
                  ? "Defeated"
                  : "Pending Tally"}
            </p>
          </div>

          {/* Stage 4: Execution */}
          <div
            className={`p-3 rounded-lg border ${
              proposal.executed
                ? "border-purple-300 dark:border-purple-700 bg-purple-50 dark:bg-purple-950/30"
                : proposal.canExecute
                  ? "border-amber-300 dark:border-amber-700 bg-amber-50/50 dark:bg-amber-950/20"
                  : "border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-900/50"
            }`}
          >
            <span
              className={`w-5 h-5 rounded-full text-xs font-bold inline-flex items-center justify-center mb-1 ${
                proposal.executed
                  ? "bg-purple-600 text-white"
                  : proposal.canExecute
                    ? "bg-amber-500 text-white animate-pulse"
                    : "bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300"
              }`}
            >
              {proposal.executed ? "✓" : "4"}
            </span>
            <p className="text-xs font-medium text-gray-900 dark:text-white">4. Execution</p>
            <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">
              {proposal.executed
                ? "Executed on-chain"
                : proposal.canExecute
                  ? "Ready to Execute"
                  : "Locked"}
            </p>
          </div>
        </div>
      </Card>

      {/* Execution Rejection Error Banner */}
      {executionError && (
        <div
          role="alert"
          data-testid="execution-error-banner"
          className="p-4 rounded-xl border border-rose-300 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/40 text-rose-900 dark:text-rose-200 flex items-start gap-3"
        >
          <svg
            className="w-5 h-5 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          <div className="space-y-1">
            <p className="text-sm font-semibold text-rose-800 dark:text-rose-300">
              Execution Rejected by Contract
            </p>
            <p className="text-xs text-rose-700 dark:text-rose-400 leading-relaxed">
              {executionError}
            </p>
          </div>
        </div>
      )}

      {/* 2-Column Main Section */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column (2 spans): Description, Tally/Quorum, Vote History */}
        <div className="lg:col-span-2 space-y-6">
          {/* Description & Action details */}
          <Card className="p-6 space-y-4">
            <div>
              <h2 className="text-sm font-semibold text-gray-900 dark:text-white">
                Description
              </h2>
              <p className="text-sm text-gray-600 dark:text-gray-300 mt-2 leading-relaxed whitespace-pre-line">
                {proposal.description || "No description provided."}
              </p>
            </div>

            {/* Target and payload parameters */}
            <div className="pt-4 border-t border-gray-100 dark:border-gray-800 space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
                On-Chain Action Payload
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                <div className="p-3 rounded-lg bg-gray-50 dark:bg-gray-900 border border-gray-100 dark:border-gray-800">
                  <span className="text-gray-400 block text-[11px] mb-0.5">Target Function</span>
                  <span className="font-mono text-gray-800 dark:text-gray-200 break-all">
                    {proposal.target || "N/A"}
                  </span>
                </div>
                <div className="p-3 rounded-lg bg-gray-50 dark:bg-gray-900 border border-gray-100 dark:border-gray-800">
                  <span className="text-gray-400 block text-[11px] mb-0.5">Action Type</span>
                  <span className="font-mono text-gray-800 dark:text-gray-200">
                    {proposal.action_type}
                  </span>
                </div>
              </div>
              {proposal.data && (
                <div className="p-3 rounded-lg bg-gray-50 dark:bg-gray-900 border border-gray-100 dark:border-gray-800">
                  <span className="text-gray-400 block text-[11px] mb-0.5">Serialized Data</span>
                  <span className="font-mono text-xs text-gray-800 dark:text-gray-200 break-all">
                    {proposal.data}
                  </span>
                </div>
              )}
            </div>
          </Card>

          {/* Tally, Quorum & Threshold */}
          <Card className="p-6 space-y-5" data-testid="tally-quorum-card">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold text-gray-900 dark:text-white">
                  Vote Tally & Quorum
                </h2>
                <p className="text-xs text-gray-400 mt-0.5">
                  1-address-1-vote on-chain democratic consensus
                </p>
              </div>
              <div className="text-right">
                <span className="text-xs font-semibold text-gray-700 dark:text-gray-300">
                  Total Votes: {totalVotes}
                </span>
              </div>
            </div>

            {/* Voting Bar */}
            <div>
              <div className="flex justify-between text-xs text-gray-600 dark:text-gray-400 mb-1.5 font-medium">
                <span className="text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                  👍 Yes: {proposal.yes_votes} ({yesPercent}%)
                </span>
                <span className="text-rose-600 dark:text-rose-400 flex items-center gap-1">
                  👎 No: {proposal.no_votes} ({noPercent}%)
                </span>
              </div>
              <div className="h-3.5 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden flex">
                <div
                  className="h-full bg-emerald-500 transition-all"
                  style={{ width: `${yesPercent}%` }}
                />
                <div
                  className="h-full bg-rose-500 transition-all"
                  style={{ width: `${noPercent}%` }}
                />
              </div>
            </div>

            {/* Quorum and Threshold indicators */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-4 border-t border-gray-100 dark:border-gray-800">
              <div className="p-3.5 rounded-xl border border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-900/50">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-gray-500 dark:text-gray-400">Majority Threshold</span>
                  <span className="text-xs font-semibold text-gray-800 dark:text-gray-200">
                    &gt; 50%
                  </span>
                </div>
                <p className="text-sm font-bold text-gray-900 dark:text-white mt-1">
                  {proposal.yes_votes > proposal.no_votes ? (
                    <span className="text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                      ✓ Threshold Met ({yesPercent}% Yes)
                    </span>
                  ) : (
                    <span className="text-rose-500 flex items-center gap-1">
                      ✕ Threshold Not Met
                    </span>
                  )}
                </p>
                <p className="text-[11px] text-gray-400 mt-1">
                  Contract requires simple majority (yes &gt; no).
                </p>
              </div>

              <div className="p-3.5 rounded-xl border border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-900/50">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-gray-500 dark:text-gray-400">Configured Quorum</span>
                  <span className="text-xs font-mono text-gray-800 dark:text-gray-200">
                    {proposal.config.quorum_bps} bps ({quorumPercent}%)
                  </span>
                </div>
                <p className="text-sm font-bold text-gray-900 dark:text-white mt-1">
                  {proposal.config.enabled ? "Active" : "Disabled"}
                </p>
                <p className="text-[11px] text-gray-400 mt-1">
                  Read from on-chain get_governance_config.
                </p>
              </div>
            </div>
          </Card>

          {/* Individual Vote History */}
          <Card className="p-6 space-y-4" data-testid="vote-history-card">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold text-gray-900 dark:text-white">
                  Vote History
                </h2>
                <p className="text-xs text-gray-400 mt-0.5">
                  Individual address vote logs for Proposal #{proposal.id}
                </p>
              </div>
              <Badge variant="outline">
                {proposal.votes?.length ?? 0} {proposal.votes?.length === 1 ? "voter" : "voters"}
              </Badge>
            </div>

            {(!proposal.votes || proposal.votes.length === 0) ? (
              <div className="p-8 text-center border border-dashed border-gray-200 dark:border-gray-700 rounded-xl text-gray-400 text-xs">
                No votes have been recorded for this proposal yet.
              </div>
            ) : (
              <div className="divide-y divide-gray-100 dark:divide-gray-800">
                {proposal.votes.map((v, idx) => (
                  <div
                    key={`${v.voter}-${idx}`}
                    className="py-3 flex items-center justify-between gap-3 text-xs"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span
                        className={`w-6 h-6 rounded-full flex items-center justify-center font-bold text-xs shrink-0 ${
                          v.support
                            ? "bg-emerald-100 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400"
                            : "bg-rose-100 dark:bg-rose-950/60 text-rose-600 dark:text-rose-400"
                        }`}
                      >
                        {v.support ? "👍" : "👎"}
                      </span>
                      <div className="min-w-0">
                        <p className="font-mono text-gray-900 dark:text-white truncate">
                          {v.voter}
                        </p>
                        <p className="text-[11px] text-gray-400 mt-0.5">
                          {new Date(v.timestamp * 1000).toLocaleString()}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <Badge variant={v.support ? "success" : "danger"} size="sm">
                        {v.support ? "Voted Yes" : "Voted No"}
                      </Badge>
                      <CopyButton value={v.voter} label="Voter Address" />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>

        {/* Right Column (1 span): Timing, Proposer/Deposit & Actions */}
        <div className="space-y-6">
          {/* Actions Card */}
          <Card className="p-6 space-y-4" data-testid="governance-actions-card">
            <h2 className="text-sm font-semibold text-gray-900 dark:text-white">
              Governance Actions
            </h2>

            {/* Voting buttons: Active proposals only */}
            {proposal.status === "active" && !proposal.executed && (
              <div className="space-y-3">
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  Cast your vote on-chain. Each connected wallet has 1 vote.
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <Button
                    variant="primary"
                    onClick={() => handleVote(true)}
                    loading={voteMutation.isPending}
                    className="w-full bg-emerald-600 hover:bg-emerald-700"
                  >
                    👍 Vote Yes
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={() => handleVote(false)}
                    loading={voteMutation.isPending}
                    className="w-full border-rose-300 text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/30"
                  >
                    👎 Vote No
                  </Button>
                </div>
              </div>
            )}

            {/* Execute button: ONLY when contract conditions are met */}
            {proposal.canExecute && !proposal.executed && (
              <div className="space-y-3 pt-2">
                <div className="p-3 rounded-lg bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 text-xs text-emerald-800 dark:text-emerald-300">
                  Voting has concluded and this proposal passed. Anyone can trigger execution.
                </div>
                <Button
                  variant="primary"
                  onClick={handleExecute}
                  loading={executeMutation.isPending}
                  className="w-full bg-purple-600 hover:bg-purple-700"
                  data-testid="execute-proposal-button"
                >
                  ⚡ Execute Proposal On-Chain
                </Button>
              </div>
            )}

            {/* Non-executable notice */}
            {!proposal.canExecute && !proposal.executed && proposal.status !== "active" && (
              <div className="p-3 rounded-lg bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-xs text-gray-600 dark:text-gray-400">
                <p className="font-semibold text-gray-700 dark:text-gray-300 mb-0.5">
                  Execution Ineligible
                </p>
                <p>{proposal.reasonNotExecutable || "Conditions for execution have not been satisfied."}</p>
              </div>
            )}

            {proposal.executed && (
              <div className="p-3 rounded-lg bg-purple-50 dark:bg-purple-950/30 border border-purple-200 dark:border-purple-800 text-xs text-purple-800 dark:text-purple-300">
                ✓ This proposal has already been executed on the Stellar network.
              </div>
            )}
          </Card>

          {/* Timing Card */}
          <Card className="p-6 space-y-4" data-testid="timing-card">
            <h2 className="text-sm font-semibold text-gray-900 dark:text-white">
              Windows & Timing
            </h2>

            <div className="space-y-3 text-xs">
              <div className="p-3 rounded-lg bg-gray-50 dark:bg-gray-900 border border-gray-100 dark:border-gray-800 space-y-1">
                <div className="flex items-center justify-between text-gray-400">
                  <span>Voting Window</span>
                  <Badge variant={proposal.status === "active" ? "info" : "outline"} size="sm">
                    {proposal.status === "active" ? "Open" : "Closed"}
                  </Badge>
                </div>
                <p className="font-semibold text-gray-900 dark:text-white">
                  {proposal.status === "active"
                    ? `${proposal.votingTiming.formattedRemaining} remaining`
                    : "Voting period closed"}
                </p>
                <p className="text-[11px] text-gray-400">
                  Ends:{" "}
                  {proposal.voting_ends_at
                    ? new Date(proposal.voting_ends_at * 1000).toLocaleString()
                    : "N/A"}
                </p>
              </div>

              <div className="p-3 rounded-lg bg-gray-50 dark:bg-gray-900 border border-gray-100 dark:border-gray-800 space-y-1">
                <div className="flex items-center justify-between text-gray-400">
                  <span>Execution Window</span>
                  <Badge variant={proposal.executed ? "default" : proposal.canExecute ? "success" : "warning"} size="sm">
                    {proposal.executed ? "Executed" : proposal.canExecute ? "Executable" : "Locked"}
                  </Badge>
                </div>
                <p className="font-semibold text-gray-900 dark:text-white">
                  {proposal.executed
                    ? "Completed"
                    : proposal.canExecute
                      ? "Execution window open"
                      : "Opens after voting concludes"}
                </p>
                <p className="text-[11px] text-gray-400">
                  Opens:{" "}
                  {proposal.voting_ends_at
                    ? new Date(proposal.voting_ends_at * 1000).toLocaleString()
                    : "N/A"}
                </p>
              </div>
            </div>
          </Card>

          {/* Proposer & Deposit */}
          <Card className="p-6 space-y-4" data-testid="proposer-deposit-card">
            <h2 className="text-sm font-semibold text-gray-900 dark:text-white">
              Proposer & Deposit
            </h2>

            <div className="space-y-3 text-xs">
              <div>
                <span className="text-gray-400 block text-[11px] mb-1">Proposer Address</span>
                <div className="flex items-center justify-between p-2.5 rounded-lg bg-gray-50 dark:bg-gray-900 border border-gray-100 dark:border-gray-800">
                  <span className="font-mono text-gray-900 dark:text-white">
                    {shortenAddress(proposal.proposer, 8)}
                  </span>
                  <div className="flex items-center gap-1">
                    <CopyButton value={proposal.proposer} label="Proposer Address" />
                    <a
                      href={getAccountExplorerUrl(proposal.proposer)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-ophir-600 dark:text-ophir-400 hover:underline text-[11px]"
                    >
                      Explorer
                    </a>
                  </div>
                </div>
              </div>

              <div>
                <span className="text-gray-400 block text-[11px] mb-1">Locked Deposit</span>
                <div className="p-2.5 rounded-lg bg-gray-50 dark:bg-gray-900 border border-gray-100 dark:border-gray-800 space-y-1">
                  <p className="font-semibold text-gray-900 dark:text-white">
                    {proposal.deposit_amount ? `${Number(proposal.deposit_amount) / 10_000_000} XLM` : "0 XLM"}
                  </p>
                  <p className="text-[11px] text-gray-400">
                    Deposit is locked on-chain to prevent spam proposals and refunded upon execution.
                  </p>
                </div>
              </div>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
