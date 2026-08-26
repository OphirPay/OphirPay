"use client";
// SPDX-License-Identifier: MIT

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { EmptyState } from "@/components/EmptyState";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { useToast } from "@/components/ui/Toast";
import { useWallet } from "@/hooks/useMultiWallet";
import { useApiQuery } from "@/hooks/useApiQuery";
import {
  proposeTimelockedAction,
  executeTimelockedAction,
  cancelTimelockedAction,
} from "@/lib/contract-advanced";

interface TimelockAction {
  id: number;
  action_type: string;
  target: string;
  data: string;
  proposed_by: string;
  proposed_at: number;
  unlocks_at: number;
  executed: boolean;
}

const ACTION_TYPES = [
  "set_fee_config",
  "set_fee_collector",
  "set_multisig_config",
  "pause_contract",
  "unpause_contract",
  "upgrade_contract",
] as const;

export default function TimelockPage() {
  const toast = useToast();
  const { wallet } = useWallet();
  const queryClient = useQueryClient();
  const [showPropose, setShowPropose] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [formActionType, setFormActionType] = useState<string>(ACTION_TYPES[0]);
  const [formTarget, setFormTarget] = useState("");
  const [formData, setFormData] = useState("");

  const {
    data: rawActions,
    isLoading: loading,
  } = useApiQuery<TimelockAction[]>(["timelock"], "/api/timelock");
  const actions = Array.isArray(rawActions) ? rawActions : [];

  const handlePropose = async () => {
    if (!wallet.publicKey) { toast.error("Connect your wallet first"); return; }
    setSubmitting(true);
    try {
      const result = await proposeTimelockedAction(
        wallet.publicKey, formActionType, formTarget, formData,
      );
      if (result.success) {
        toast.success("Timelocked action proposed (24h delay)");
        setShowPropose(false);
        setFormTarget("");
        setFormData("");
        queryClient.invalidateQueries({ queryKey: ["timelock"] });
      } else {
        toast.error(result.error || "Proposal failed — owner only");
      }
    } catch {
      toast.error("Network error");
    } finally {
      setSubmitting(false);
    }
  };

  const handleExecute = async (actionId: number) => {
    if (!wallet.publicKey) { toast.error("Connect your wallet first"); return; }
    try {
      const result = await executeTimelockedAction(wallet.publicKey || "", actionId);
      if (result.success) {
        toast.success("Timelocked action executed on-chain");
        queryClient.invalidateQueries({ queryKey: ["timelock"] });
      } else {
        toast.error(result.error || "Execution failed — still locked or already executed");
      }
    } catch {
      toast.error("Network error");
    }
  };

  const handleCancel = async (actionId: number) => {
    if (!wallet.publicKey) { toast.error("Connect your wallet first"); return; }
    try {
      const result = await cancelTimelockedAction(wallet.publicKey, actionId);
      if (result.success) {
        toast.success("Action cancelled on-chain");
        queryClient.invalidateQueries({ queryKey: ["timelock"] });
      } else {
        toast.error(result.error || "Cancel failed — owner only");
      }
    } catch {
      toast.error("Network error");
    }
  };

  const now = Math.floor(Date.now() / 1000);
  const formatTime = (ts: number) => new Date(ts * 1000).toLocaleString();
  const timeRemaining = (unlocksAt: number) => {
    const diff = unlocksAt - now;
    if (diff <= 0) return "Ready";
    const h = Math.floor(diff / 3600);
    const m = Math.floor((diff % 3600) / 60);
    return `${h}h ${m}m remaining`;
  };

  if (loading) {
    return (
      <div className="animate-fade-in space-y-6">
        <div className="h-8 w-48 bg-gray-200 dark:bg-gray-700 rounded animate-pulse" />
        <div className="grid gap-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-28 bg-gray-100 dark:bg-gray-800 rounded animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      {!wallet.connected && (
        <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-lg p-4 flex items-center gap-3 animate-fade-in">
          <span className="text-amber-500 text-lg">⚠️</span>
          <div>
            <p className="text-sm font-medium text-amber-800 dark:text-amber-200">Wallet not connected</p>
            <p className="text-xs text-amber-600 dark:text-amber-400">
              Connect your wallet to propose timelocked admin actions on-chain.
            </p>
          </div>
        </div>
      )}

      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
            Timelocked Actions
          </h1>
          <p className="text-gray-500 dark:text-gray-400 mt-1">
            24-hour delay on sensitive admin operations — transparency by design
          </p>
        </div>
        <Button onClick={() => setShowPropose(true)} variant="primary">
          + Propose Action
        </Button>
      </div>

      {actions.length === 0 ? (
        <EmptyState
          icon={
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-8 h-8 text-gray-400">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          }
          title="No Timelocked Actions"
          description="Propose an admin action with a 24-hour delay for community review."
          actionLabel="Propose Action"
          onAction={() => setShowPropose(true)}
        />
      ) : (
        <div className="space-y-3">
          {actions.map((action) => {
            const isReady = now >= action.unlocks_at;
            return (
              <Card key={action.id} className={`p-4 transition-all ${action.executed ? "opacity-60" : "hover:shadow-md"}`}>
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                  <div className="space-y-2 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                    <Badge variant={action.executed ? "success" : isReady ? "warning" : "info"}>
                      {action.executed ? "Executed" : isReady ? "Ready" : "Locked"}
                    </Badge>
                    <Badge variant="default">{action.action_type}</Badge>
                      <span className="text-sm font-mono text-gray-500">#{action.id}</span>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-1 text-sm">
                      <p className="text-gray-600 dark:text-gray-400">
                        Target: <code className="text-xs bg-gray-100 dark:bg-gray-700 px-1 rounded">{action.target || "(none)"}</code>
                      </p>
                      {action.data && (
                        <p className="text-gray-600 dark:text-gray-400 truncate">
                          Data: <code className="text-xs">{action.data.slice(0, 40)}{action.data.length > 40 ? "..." : ""}</code>
                        </p>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-3 text-xs text-gray-500">
                      <span>Proposed: {formatTime(action.proposed_at)}</span>
                      {!action.executed && (
                        <span className={isReady ? "text-green-600 font-medium" : "text-amber-600 font-medium"}>
                          {timeRemaining(action.unlocks_at)}
                        </span>
                      )}
                    </div>
                  </div>
                  {!action.executed && (
                    <div className="flex gap-2">
                      <Button size="sm" onClick={() => handleExecute(action.id)} disabled={!isReady}>
                        {isReady ? "✓ Execute" : "⏳ Waiting"}
                      </Button>
                      <Button size="sm" variant="danger" onClick={() => handleCancel(action.id)}>
                        Cancel
                      </Button>
                    </div>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* Propose Modal */}
      <Modal
        open={showPropose}
        onClose={() => setShowPropose(false)}
        title="Propose Timelocked Action"
        description="Owner only. Action will be executable after a 24-hour delay."
      >
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Action Type
            </label>
            <div className="grid grid-cols-2 gap-2">
              {ACTION_TYPES.map((t) => (
                <button
                  key={t}
                  onClick={() => setFormActionType(t)}
                  className={`px-3 py-2 rounded-lg border text-sm font-medium transition-all ${
                    formActionType === t
                      ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300"
                      : "border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:border-gray-300"
                  }`}
                >
                  {t.replace(/_/g, " ")}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Target (optional)
            </label>
            <input
              value={formTarget}
              onChange={(e) => setFormTarget(e.target.value)}
              className="w-full px-3 py-2 border rounded-lg dark:bg-gray-800 dark:border-gray-700 font-mono text-xs"
              placeholder="Contract address or parameter..."
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Data (JSON or hex, optional)
            </label>
            <textarea
              value={formData}
              onChange={(e) => setFormData(e.target.value)}
              rows={3}
              className="w-full px-3 py-2 border rounded-lg dark:bg-gray-800 dark:border-gray-700 font-mono text-xs"
              placeholder='{"payment_fee_bps": 10, ...}'
            />
          </div>
          <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3 text-sm text-gray-600 dark:text-gray-400">
            <p>⏳ <strong>24-hour delay</strong> before this action can be executed.</p>
            <p className="mt-1 text-xs">This gives the community time to review and react.</p>
          </div>
          <Button onClick={handlePropose} loading={submitting} className="w-full">
            Propose with 24h Timelock
          </Button>
        </div>
      </Modal>
    </div>
  );
}
