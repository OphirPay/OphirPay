"use client";
// SPDX-License-Identifier: MIT

import { useState } from "react";
import { EmptyState } from "@/components/EmptyState";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { LoadingSkeleton } from "@/components/LoadingSkeleton";
import { useToast } from "@/components/ui/Toast";
import { useWallet } from "@/hooks/useMultiWallet";
import { useApiQuery, useApiMutation } from "@/hooks/useApiQuery";
import type { ApiError } from "@/hooks/useApiQuery";

interface Proposal {
  id: number;
  title: string;
  description: string;
  action_type: string;
  yes_votes: number;
  no_votes: number;
  voting_ends_at: number | null;
  executed: boolean;
  proposer: string;
}

interface ProposalsResponse {
  items: Proposal[];
  total: number;
  /** True when the chain holds more proposals than the API enumerates. */
  truncated: boolean;
}

export default function GovernancePage() {
  const { wallet } = useWallet();
  const toast = useToast();
  const [showCreate, setShowCreate] = useState(false);

  // ── Form state ──────────────────────────────────────────
  const [formTitle, setFormTitle] = useState("");
  const [formDesc, setFormDesc] = useState("");
  const [formAction, setFormAction] = useState("upgrade");
  const [formTarget, setFormTarget] = useState("");
  const [formData, setFormData] = useState("");
  const [formDepositAmount, setFormDepositAmount] = useState("");
  const [formDepositAsset, setFormDepositAsset] = useState("");

  // ── React Query: fetch proposals ────────────────────────
  const {
    data: proposals,
    isLoading,
    isError,
    refetch,
  } = useApiQuery<ProposalsResponse>(
    ["governance", "proposals"],
    "/api/governance/proposals",
    // Enumerating proposals is an N+1 contract read — skip focus refetches.
    { refetchOnWindowFocus: false }
  );

  // ── React Query: create proposal mutation ────────────────
  // Invalidation is scoped to governance so unrelated (and expensive,
  // e.g. on-chain enumeration) queries are not refetched on every vote.
  const createMutation = useApiMutation<Record<string, unknown>, { txHash?: string }>(
    "/api/governance/proposals",
    { invalidateKeys: [["governance"]] }
  );

  // ── React Query: vote mutation ───────────────────────────
  const voteMutation = useApiMutation<
    { voter: string; proposalId: number; support: boolean },
    { voted: boolean }
  >("/api/governance/vote", { invalidateKeys: [["governance"]] });

  // ── React Query: execute mutation ────────────────────────
  const executeMutation = useApiMutation<{ proposalId: number }, { executed: boolean }>(
    "/api/governance/execute",
    { invalidateKeys: [["governance"]] }
  );

  const handleCreate = async () => {
    if (!wallet.publicKey) {
      toast.error("Connect your wallet first");
      return;
    }
    if (!formTitle || !formDesc) {
      toast.error("Title and description are required");
      return;
    }
    try {
      // Deposit is denominated in XLM and converted to stroops (1 XLM = 10^7).
      // An empty deposit asset resolves to native XLM's SAC address.
      const depositStroops = Math.round((parseFloat(formDepositAmount) || 0) * 10_000_000);
      await createMutation.mutateAsync({
        proposer: wallet.publicKey,
        title: formTitle,
        description: formDesc,
        actionType: formAction,
        target: formTarget,
        data: formData,
        depositAsset: formDepositAsset.trim(),
        depositAmount: depositStroops,
      });
      toast.success("Proposal created on-chain");
      setShowCreate(false);
      setFormTitle("");
      setFormDesc("");
      setFormTarget("");
      setFormData("");
      setFormDepositAmount("");
      setFormDepositAsset("");
      refetch();
    } catch (err) {
      const apiErr = err as ApiError;
      toast.error(apiErr.message || "Failed to create proposal");
    }
  };

  const handleVote = async (proposalId: number, support: boolean) => {
    if (!wallet.publicKey) {
      toast.error("Connect your wallet first");
      return;
    }
    try {
      await voteMutation.mutateAsync({ voter: wallet.publicKey, proposalId, support });
      toast.success(support ? "Voted YES on-chain" : "Voted NO on-chain");
      refetch();
    } catch (err) {
      const apiErr = err as ApiError;
      toast.error(apiErr.message || "Vote failed");
    }
  };

  const handleExecute = async (proposalId: number) => {
    try {
      await executeMutation.mutateAsync({ proposalId });
      toast.success("Proposal executed on-chain");
      refetch();
    } catch (err) {
      const apiErr = err as ApiError;
      toast.error(apiErr.message || "Execution failed");
    }
  };

  const isVotingOpen = (p: Proposal) => {
    if (!p.voting_ends_at || p.executed) return false;
    return Date.now() / 1000 < (p.voting_ends_at as number);
  };

  const voteProgress = (p: Proposal) => {
    const total = p.yes_votes + p.no_votes;
    if (total === 0) return { yes: 0, no: 0 };
    return {
      yes: Math.round((p.yes_votes / total) * 100),
      no: Math.round((p.no_votes / total) * 100),
    };
  };

  const showConnectBanner = !wallet.connected;
  const list = proposals?.items ?? [];
  const truncated = proposals?.truncated ?? false;

  return (
    <div className="space-y-6 animate-fade-in">
      {showConnectBanner && (
        <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-lg p-4 flex items-center gap-3">
          <span className="text-amber-500 text-lg">⚠️</span>
          <div>
            <p className="text-sm font-medium text-amber-800 dark:text-amber-200">
              Wallet not connected
            </p>
            <p className="text-xs text-amber-600 dark:text-amber-400">
              Connect your wallet to create and vote on governance proposals.
            </p>
          </div>
        </div>
      )}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">🏛 Governance</h1>
          <p className="text-gray-500 dark:text-gray-400 mt-1">
            DAO-ready proposal → vote → execute workflow
          </p>
        </div>
        <Button onClick={() => setShowCreate(true)}>+ New Proposal</Button>
      </div>

      {isLoading ? (
        <LoadingSkeleton lines={3} variant="card" />
      ) : isError ? (
        <EmptyState
          icon={<span className="text-2xl">⚠️</span>}
          title="Failed to load proposals"
          description="Could not fetch governance data. Check your connection."
          actionLabel="Retry"
          onAction={() => refetch()}
        />
      ) : (
        <>
          {truncated && list.length > 0 && (
            <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-lg p-3 text-sm text-amber-800 dark:text-amber-200">
              Showing the {list.length} most recent of {proposals?.total} proposals — older
              proposals are not listed to bound the on-chain enumeration cost.
            </div>
          )}

          {list.length === 0 ? (
            <EmptyState
              icon={<span className="text-2xl">🏛</span>}
              title="No Governance Proposals"
              description="Create a proposal to upgrade the contract, change fees, or modify multisig configuration."
              actionLabel="Create Proposal"
              onAction={() => setShowCreate(true)}
            />
          ) : (
            <div className="space-y-3">
              {list.map((p) => {
                const progress = voteProgress(p);
                return (
                  <Card key={p.id} className="p-4">
                    <div className="space-y-3">
                      <div className="flex items-start justify-between">
                        <div>
                          <div className="flex items-center gap-2">
                            <h3 className="font-semibold text-gray-900 dark:text-white">
                              {p.title}
                            </h3>
                            <Badge
                              variant={
                                p.executed
                                  ? p.yes_votes > p.no_votes
                                    ? "success"
                                    : "danger"
                                  : isVotingOpen(p)
                                    ? "info"
                                    : "warning"
                              }
                            >
                              {p.executed
                                ? p.yes_votes > p.no_votes
                                  ? "Passed"
                                  : "Defeated"
                                : isVotingOpen(p)
                                  ? "Voting"
                                  : "Closed"}
                            </Badge>
                          </div>
                          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                            {p.description}
                          </p>
                          <span className="text-xs text-gray-400 mt-1 block">
                            Action: {p.action_type} · By: {p.proposer?.slice?.(0, 8)}...
                          </span>
                        </div>
                      </div>

                      <div>
                        <div className="flex justify-between text-xs text-gray-500 mb-1">
                          <span>Yes: {p.yes_votes}</span>
                          <span>No: {p.no_votes}</span>
                        </div>
                        <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden flex">
                          <div
                            className="h-full bg-green-500 transition-all"
                            style={{ width: `${progress.yes}%` }}
                          />
                          <div
                            className="h-full bg-red-500 transition-all"
                            style={{ width: `${progress.no}%` }}
                          />
                        </div>
                      </div>

                      <div className="flex gap-2">
                        {isVotingOpen(p) && !p.executed && (
                          <>
                            <Button
                              size="sm"
                              variant="primary"
                              onClick={() => handleVote(p.id, true)}
                              loading={voteMutation.isPending}
                            >
                              👍 Yes
                            </Button>
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() => handleVote(p.id, false)}
                              loading={voteMutation.isPending}
                            >
                              👎 No
                            </Button>
                          </>
                        )}
                        {!isVotingOpen(p) && !p.executed && (
                          <Button
                            size="sm"
                            onClick={() => handleExecute(p.id)}
                            loading={executeMutation.isPending}
                          >
                            Execute
                          </Button>
                        )}
                      </div>
                    </div>
                  </Card>
                );
              })}
            </div>
          )}
        </>
      )}

      <Modal
        open={showCreate}
        onClose={() => setShowCreate(false)}
        title="Create Governance Proposal"
      >
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Title
            </label>
            <input
              value={formTitle}
              onChange={(e) => setFormTitle(e.target.value)}
              className="w-full px-3 py-2 border rounded-lg dark:bg-gray-800 dark:border-gray-700"
              placeholder="Upgrade contract to v3"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Description
            </label>
            <textarea
              value={formDesc}
              onChange={(e) => setFormDesc(e.target.value)}
              rows={3}
              className="w-full px-3 py-2 border rounded-lg dark:bg-gray-800 dark:border-gray-700"
              placeholder="This proposal upgrades the OphirPay contract..."
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Action Type
            </label>
            <select
              value={formAction}
              onChange={(e) => setFormAction(e.target.value)}
              className="w-full px-3 py-2 border rounded-lg dark:bg-gray-800 dark:border-gray-700"
            >
              <option value="upgrade">Contract Upgrade</option>
              <option value="set_fee_config">Fee Configuration</option>
              <option value="set_multisig_config">Multisig Configuration</option>
              <option value="transfer_ownership">Transfer Ownership</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Deposit (XLM)
            </label>
            <input
              value={formDepositAmount}
              onChange={(e) => setFormDepositAmount(e.target.value)}
              type="number"
              min="0"
              step="any"
              className="w-full px-3 py-2 border rounded-lg dark:bg-gray-800 dark:border-gray-700"
              placeholder="0.00 (native XLM)"
            />
            <p className="text-xs text-gray-400 mt-1">
              Locks funds until the proposal is executed. Some governance configs require a minimum
              deposit.
            </p>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Deposit Asset (optional)
            </label>
            <input
              value={formDepositAsset}
              onChange={(e) => setFormDepositAsset(e.target.value)}
              className="w-full px-3 py-2 border rounded-lg dark:bg-gray-800 dark:border-gray-700 font-mono text-sm"
              placeholder="Leave empty for native XLM"
            />
          </div>
          <Button onClick={handleCreate} loading={createMutation.isPending} className="w-full">
            Create Proposal
          </Button>
        </div>
      </Modal>
    </div>
  );
}
