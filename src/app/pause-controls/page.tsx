"use client";
// SPDX-License-Identifier: MIT

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { useToast } from "@/components/ui/Toast";
import { useWallet } from "@/hooks/useMultiWallet";
import { useApiQuery } from "@/hooks/useApiQuery";
import {
  emergencyPauseAll,
  emergencyUnpauseAll,
  setScopePaused,
} from "@/lib/contract-advanced";
import { getStellarExplorerUrl } from "@/lib/stellar";
import { shortenAddress } from "@/lib/utils";
import Link from "next/link";

interface PauseStateData {
  paused: boolean | "unknown";
  available: boolean;
  scopes?: Record<string, boolean>;
  pausedScopes?: string[];
}

interface ScopeDefinition {
  id: string;
  name: string;
  description: string;
  endpoints: string;
}

const FEATURE_SCOPES: ScopeDefinition[] = [
  {
    id: "payments",
    name: "Payments & Transfers",
    description: "Direct payment recordings, atomic spends, multisig payments.",
    endpoints: "record_payment, atomic_spend, propose/approve/execute_payment",
  },
  {
    id: "escrows",
    name: "Escrows",
    description: "Timed and arbiter-assisted escrow deposits, releases, and claims.",
    endpoints: "create_escrow, release_escrow, release_by_arbiter, claim_escrow",
  },
  {
    id: "streams",
    name: "Payment Streams",
    description: "Continuous payment streaming creation, claiming, and cancellation.",
    endpoints: "create_stream, claim_stream, cancel_stream",
  },
  {
    id: "recurring",
    name: "Recurring Billing",
    description: "Scheduled recurring subscriptions and periodic payment executions.",
    endpoints: "create_recurring, execute_recurring",
  },
  {
    id: "refunds",
    name: "Refunds",
    description: "Customer refund requests, merchant approvals, rejections, and processing.",
    endpoints: "request_refund, approve_refund, reject_refund, process_refund",
  },
  {
    id: "governance",
    name: "Governance",
    description: "On-chain proposal creation and community voting.",
    endpoints: "create_proposal, vote_on_proposal",
  },
  {
    id: "hooks",
    name: "Notification Hooks",
    description: "Event-driven webhook subscriptions and real-time relayer notifications.",
    endpoints: "register_hook",
  },
  {
    id: "batches",
    name: "Batch Payments",
    description: "Mass payout batches to up to 100 recipients with partial-failure tolerance.",
    endpoints: "create_batch",
  },
];

interface PendingAction {
  type: "global_pause" | "global_unpause" | "scope_toggle";
  scopeId?: string;
  scopeName?: string;
  targetPaused?: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  variant: "danger" | "primary";
}

export default function PauseControlsPage() {
  const toast = useToast();
  const { wallet } = useWallet();
  const queryClient = useQueryClient();
  const [submitting, setSubmitting] = useState(false);
  const [lastTxHash, setLastTxHash] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);

  const {
    data: rawData,
    isLoading: loading,
  } = useApiQuery<PauseStateData>(
    ["pause-state"],
    "/api/pause-state",
  );
  const pauseState = rawData?.paused ?? "unknown";
  const isGlobalPaused = pauseState === true;
  const isUnknown = pauseState === "unknown";
  const contractAvailable = rawData?.available ?? false;
  const scopes = rawData?.scopes ?? {};

  const executeConfirmedAction = async () => {
    if (!pendingAction) return;
    if (!wallet.publicKey) {
      toast.error("Connect your wallet first");
      return;
    }

    setSubmitting(true);
    setLastTxHash(null);

    try {
      if (pendingAction.type === "global_pause") {
        const result = await emergencyPauseAll(wallet.publicKey);
        if (result.success) {
          toast.success("Emergency pause active: OphirPay and Emitter contracts paused");
          setLastTxHash(result.txHash ?? null);
          queryClient.invalidateQueries({ queryKey: ["pause-state"] });
        } else if (result.txHash) {
          setLastTxHash(result.txHash);
          toast.warning("Transaction submitted — confirmation taking longer than expected.");
          queryClient.invalidateQueries({ queryKey: ["pause-state"] });
        } else {
          toast.error(result.error || "Global pause failed — are you the contract owner?");
        }
      } else if (pendingAction.type === "global_unpause") {
        const result = await emergencyUnpauseAll(wallet.publicKey);
        if (result.success) {
          toast.success("Global unpause complete: contracts restored");
          setLastTxHash(result.txHash ?? null);
          queryClient.invalidateQueries({ queryKey: ["pause-state"] });
        } else if (result.txHash) {
          setLastTxHash(result.txHash);
          toast.warning("Transaction submitted — confirmation taking longer than expected.");
          queryClient.invalidateQueries({ queryKey: ["pause-state"] });
        } else {
          toast.error(result.error || "Global unpause failed — are you the contract owner?");
        }
      } else if (pendingAction.type === "scope_toggle" && pendingAction.scopeId) {
        const targetState = pendingAction.targetPaused ?? false;
        const result = await setScopePaused(
          wallet.publicKey,
          pendingAction.scopeId,
          targetState
        );
        if (result.success) {
          toast.success(
            targetState
              ? `Scope "${pendingAction.scopeName}" paused successfully`
              : `Scope "${pendingAction.scopeName}" resumed successfully`
          );
          setLastTxHash(result.txHash ?? null);
          queryClient.invalidateQueries({ queryKey: ["pause-state"] });
        } else if (result.txHash) {
          setLastTxHash(result.txHash);
          toast.warning("Transaction submitted — confirmation taking longer than expected.");
          queryClient.invalidateQueries({ queryKey: ["pause-state"] });
        } else {
          toast.error(result.error || `Scope update failed — are you the contract owner?`);
        }
      }
    } catch {
      toast.error("Network error during transaction execution");
    } finally {
      setSubmitting(false);
      setPendingAction(null);
    }
  };

  const requestGlobalPause = () => {
    setPendingAction({
      type: "global_pause",
      title: "Activate Emergency Global Pause",
      description:
        "This is an emergency circuit breaker. It will atomically freeze all write operations across BOTH OphirPay and the Emitter contracts. All scopes will be blocked immediately.",
      confirmLabel: "Pause All Contracts",
      variant: "danger",
    });
  };

  const requestGlobalUnpause = () => {
    setPendingAction({
      type: "global_unpause",
      title: "Deactivate Emergency Global Pause",
      description:
        "This will atomically unpause the global circuit breaker across OphirPay and Emitter. Scopes that are not individually paused will resume processing writes.",
      confirmLabel: "Unpause All Contracts",
      variant: "primary",
    });
  };

  const requestScopeToggle = (scope: ScopeDefinition, currentlyPaused: boolean) => {
    const targetPaused = !currentlyPaused;
    setPendingAction({
      type: "scope_toggle",
      scopeId: scope.id,
      scopeName: scope.name,
      targetPaused,
      title: targetPaused ? `Pause "${scope.name}" Scope` : `Unpause "${scope.name}" Scope`,
      description: targetPaused
        ? `This will halt mutating entrypoints for the "${scope.name}" feature (${scope.endpoints}). Other feature scopes and read getters will remain functional.`
        : `This will resume mutating entrypoints for the "${scope.name}" feature domain.`,
      confirmLabel: targetPaused ? `Pause ${scope.name}` : `Unpause ${scope.name}`,
      variant: targetPaused ? "danger" : "primary",
    });
  };

  if (loading) {
    return (
      <div className="animate-fade-in space-y-6">
        <div className="h-8 w-48 bg-gray-200 dark:bg-gray-700 rounded animate-pulse" />
        <div className="h-40 bg-gray-100 dark:bg-gray-800 rounded animate-pulse" />
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
              Connect the owner wallet to toggle scoped features or trigger the emergency circuit breaker.
            </p>
          </div>
        </div>
      )}

      <div>
        <Link href="/" className="text-sm text-gray-500 hover:text-gray-700 transition-colors">← Dashboard</Link>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white mt-2">Contract Circuit Breakers & Scopes</h1>
        <p className="text-gray-500 dark:text-gray-400 mt-1">
          Granular feature-level pause controls with global emergency override
        </p>
      </div>

      {/* Global State Card */}
      <Card className="p-6">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Emergency Circuit Breaker</h2>
              {isUnknown ? (
                <Badge variant="warning">❓ Unknown</Badge>
              ) : (
                <Badge variant={isGlobalPaused ? "danger" : "success"}>
                  {isGlobalPaused ? "⏸ Globally Paused" : "▶ Active"}
                </Badge>
              )}
            </div>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              {isGlobalPaused
                ? "EMERGENCY ACTIVE: All write operations across OphirPay and Emitter contracts are halted."
                : isUnknown
                  ? "Unable to determine contract state. Contract may be offline or unreachable."
                  : "Normal operation: Global breaker is active-ready. Individual scopes control feature availability."}
            </p>
          </div>
          <div>
            {isGlobalPaused ? (
              <Button
                onClick={requestGlobalUnpause}
                loading={submitting}
                disabled={!wallet.connected || !contractAvailable || isUnknown}
              >
                ▶ Resume All Contracts
              </Button>
            ) : (
              <Button
                onClick={requestGlobalPause}
                loading={submitting}
                disabled={!wallet.connected || !contractAvailable || isUnknown}
                variant="danger"
              >
                ⏸ Emergency Pause All
              </Button>
            )}
          </div>
        </div>
      </Card>

      {/* Global Emergency Warning Banner */}
      {isGlobalPaused && (
        <div className="bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-lg p-4 flex items-start gap-3">
          <svg className="w-5 h-5 text-red-500 mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
          </svg>
          <div>
            <p className="text-sm font-semibold text-red-800 dark:text-red-200">
              Global Pause Override in Effect
            </p>
            <p className="text-xs text-red-600 dark:text-red-400 mt-1">
              All feature scopes below are overridden and temporarily disabled until the global emergency breaker is cleared by the contract owner.
            </p>
          </div>
        </div>
      )}

      {/* Scoped Controls Section */}
      <div>
        <div className="mb-4">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Feature Scopes</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Halt isolated subsystems during maintenance or targeted incident response without freezing unaffected payments.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {FEATURE_SCOPES.map((scope) => {
            const isScopeHalted = Boolean(scopes[scope.id]);
            return (
              <Card key={scope.id} className="p-5 flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <h3 className="font-semibold text-gray-900 dark:text-white text-base">
                      {scope.name}
                    </h3>
                    <div className="flex items-center gap-1.5">
                      {isGlobalPaused ? (
                        <Badge variant="warning">Override Blocked</Badge>
                      ) : isScopeHalted ? (
                        <Badge variant="danger">⏸ Paused</Badge>
                      ) : (
                        <Badge variant="success">▶ Active</Badge>
                      )}
                    </div>
                  </div>
                  <p className="text-sm text-gray-600 dark:text-gray-300 mb-2">
                    {scope.description}
                  </p>
                  <p className="text-xs text-gray-400 font-mono mb-4 break-all">
                    Entrypoints: {scope.endpoints}
                  </p>
                </div>

                <div className="pt-2 border-t border-gray-100 dark:border-gray-800 flex items-center justify-between">
                  <span className="text-xs text-gray-400">
                    Scope ID: <code className="font-mono text-gray-600 dark:text-gray-300">{scope.id}</code>
                  </span>
                  <Button
                    size="sm"
                    variant={isScopeHalted ? "outline" : "danger"}
                    loading={submitting && pendingAction?.scopeId === scope.id}
                    disabled={!wallet.connected || !contractAvailable || isUnknown}
                    onClick={() => requestScopeToggle(scope, isScopeHalted)}
                  >
                    {isScopeHalted ? "▶ Unpause Scope" : "⏸ Pause Scope"}
                  </Button>
                </div>
              </Card>
            );
          })}
        </div>
      </div>

      {/* Transaction Result */}
      {lastTxHash && (
        <Card className="p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-green-600">Transaction submitted</p>
              <p className="text-xs text-gray-400 mt-1">{shortenAddress(lastTxHash, 12)}</p>
            </div>
            <a
              href={getStellarExplorerUrl(lastTxHash)}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-ophir-600 hover:underline"
            >
              View on Explorer →
            </a>
          </div>
        </Card>
      )}

      {/* Architecture Explanations */}
      <Card className="p-6">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-3">Scoped Isolation Architecture</h2>
        <div className="space-y-3 text-sm text-gray-600 dark:text-gray-400">
          <div className="flex items-start gap-3">
            <span className="text-ophir-500 font-bold">1</span>
            <div>
              <p className="font-medium text-gray-700 dark:text-gray-300">Granular blast radius</p>
              <p>Pausing escrows or refunds stops malicious exploitation in that module while standard peer-to-peer transfers continue unaffected.</p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <span className="text-red-500 font-bold">2</span>
            <div>
              <p className="font-medium text-gray-700 dark:text-gray-300">Global emergency precedence</p>
              <p>If contract-wide safety is compromised, the emergency pause unconditionally overrides all scope settings and freezes both OphirPay and Emitter contracts.</p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <span className="text-green-500 font-bold">3</span>
            <div>
              <p className="font-medium text-gray-700 dark:text-gray-300">Owner-only security & audit trail</p>
              <p>Every scope state mutation requires multisig/owner authorization and is logged permanently into the Soroban on-chain audit trail.</p>
            </div>
          </div>
        </div>
      </Card>

      {/* Confirmation Dialog Modal */}
      <ConfirmDialog
        open={Boolean(pendingAction)}
        onClose={() => setPendingAction(null)}
        onConfirm={executeConfirmedAction}
        title={pendingAction?.title || "Confirm Action"}
        description={pendingAction?.description || ""}
        confirmLabel={pendingAction?.confirmLabel || "Confirm"}
        variant={pendingAction?.variant || "danger"}
      />
    </div>
  );
}
