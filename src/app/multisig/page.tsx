"use client";
// SPDX-License-Identifier: MIT


import { useState, useEffect } from "react";
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
  setMultisigConfig,
  proposeMultisigPayment,
  approveMultisigPayment,
  executeApprovedPayment,
} from "@/lib/contract-advanced";
import { DEFAULT_CONTRACT_ID } from "@/lib/contracts";

interface MultisigConfig {
  threshold: number;
  signers: string[];
  enabled: boolean;
}

interface ApprovalRequest {
  id: number;
  proposer: string;
  payee: string;
  amount: string;
  threshold_met?: boolean;
  approvals_count?: number;
  executed: boolean;
}

export default function MultisigPage() {
  const toast = useToast();
  const { wallet } = useWallet();
  const queryClient = useQueryClient();
  const [showConfig, setShowConfig] = useState(false);
  const [showPropose, setShowPropose] = useState(false);

  const [formThreshold, setFormThreshold] = useState(2);
  const [formSigners, setFormSigners] = useState("");
  const [formEnabled, setFormEnabled] = useState(true);

  const [proposePayee, setProposePayee] = useState("");
  const [proposeAmount, setProposeAmount] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const {
    data: rawConfig,
    isLoading: loading,
  } = useApiQuery<MultisigConfig>(["multisig", "config"], "/api/multisig");
  const config =
    rawConfig && typeof rawConfig === "object" && "threshold" in rawConfig
      ? (rawConfig as MultisigConfig)
      : null;

  // The contract cannot enumerate approval requests, so the API returns an
  // empty list. The page tracks proposals optimistically as the user creates,
  // approves, and executes them; the query only seeds the list when the API
  // happens to return real data.
  const {
    data: rawRequests,
  } = useApiQuery<{ requests?: ApprovalRequest[] } | ApprovalRequest[]>(
    ["multisig", "requests"],
    "/api/multisig/requests"
  );
  const [requests, setRequests] = useState<ApprovalRequest[]>([]);

  // Seed from API when it returns an array of requests.
  useEffect(() => {
    const seed = Array.isArray(rawRequests)
      ? rawRequests
      : Array.isArray(rawRequests?.requests)
        ? rawRequests.requests
        : [];
    if (seed.length > 0) setRequests(seed);
  }, [rawRequests]);

  const handleConfigSubmit = async () => {
    if (!wallet.publicKey) { toast.error("Connect your wallet first"); return; }
    setSubmitting(true);
    try {
      const signers = formSigners.split(",").map((s) => s.trim()).filter(Boolean);
      const result = await setMultisigConfig(wallet.publicKey, formThreshold, signers, formEnabled);
      if (result.success) {
        toast.success("Multisig configuration updated on-chain");
        setShowConfig(false);
        queryClient.invalidateQueries({ queryKey: ["multisig"] });
      } else {
        toast.error(result.error || "Failed to update configuration");
      }
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Network error");
    } finally {
      setSubmitting(false);
    }
  };

  const handlePropose = async () => {
    if (!wallet.publicKey) { toast.error("Connect your wallet first"); return; }
    setSubmitting(true);
    try {
      const amountStroops = Math.round(parseFloat(proposeAmount) * 10_000_000);
      const txHash = `proposal-${Date.now()}`;
      const result = await proposeMultisigPayment(
        wallet.publicKey, proposePayee, amountStroops, DEFAULT_CONTRACT_ID, txHash,
      );
      if (result.success) {
        toast.success("Payment proposed for multisig approval");
        setShowPropose(false);
        setProposePayee("");
        setProposeAmount("");
        // Use the real on-chain request id returned by propose_payment so that
        // Approve/Execute later address the correct contract record.
        const onChainId = typeof result.data === "number" ? result.data : Date.now();
        setRequests((prev) => [...prev, {
          id: onChainId,
          proposer: wallet.publicKey!,
          payee: proposePayee,
          amount: proposeAmount,
          approvals_count: 0,
          executed: false,
        }]);
        queryClient.invalidateQueries({ queryKey: ["multisig"] });
      } else {
        toast.error(result.error || "Failed to propose payment");
      }
    } catch {
      toast.error("Network error");
    } finally {
      setSubmitting(false);
    }
  };

  const handleApprove = async (requestId: number) => {
    if (!wallet.publicKey) { toast.error("Connect your wallet first"); return; }
    try {
      const result = await approveMultisigPayment(wallet.publicKey, requestId);
      if (result.success) {
        toast.success("Approval submitted on-chain");
        setRequests((prev) => prev.map((r) => {
          if (r.id !== requestId) return r;
          const approvals_count = (r.approvals_count ?? 0) + 1;
          // Show Execute once the threshold is met.
          const threshold_met = approvals_count >= threshold;
          return { ...r, approvals_count, threshold_met };
        }));
        queryClient.invalidateQueries({ queryKey: ["multisig"] });
      } else {
        toast.error(result.error || "Approval failed");
      }
    } catch {
      toast.error("Network error");
    }
  };

  const handleExecute = async (requestId: number) => {
    if (!wallet.publicKey) { toast.error("Connect your wallet first"); return; }
    try {
      const result = await executeApprovedPayment(wallet.publicKey, requestId);
      if (result.success) {
        toast.success("Payment executed on-chain");
        setRequests((prev) => prev.map((r) =>
          r.id === requestId ? { ...r, executed: true } : r
        ));
        queryClient.invalidateQueries({ queryKey: ["multisig"] });
      } else {
        toast.error(result.error || "Execution failed — threshold may not be met");
      }
    } catch {
      toast.error("Network error");
    }
  };

  if (loading) {
    return (
      <div className="animate-fade-in space-y-6">
        <div className="h-8 w-48 bg-gray-200 dark:bg-gray-700 rounded animate-pulse" />
        <div className="grid gap-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-24 bg-gray-100 dark:bg-gray-800 rounded animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  const showConnectBanner = !wallet.connected;

  const threshold = config?.threshold ?? 0;
  const signerCount = config?.signers?.length ?? 0;

  return (
    <div className="space-y-6 animate-fade-in">
      {showConnectBanner && (
        <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-lg p-4 flex items-center gap-3 animate-fade-in">
          <span className="text-amber-500 text-lg">⚠️</span>
          <div>
            <p className="text-sm font-medium text-amber-800 dark:text-amber-200">Wallet not connected</p>
            <p className="text-xs text-amber-600 dark:text-amber-400">
              Connect your wallet to sign multisig transactions on-chain.
            </p>
          </div>
        </div>
      )}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
            Multisig Approvals
          </h1>
          <p className="text-gray-500 dark:text-gray-400 mt-1">
            N-of-M signer approval workflow for high-value payments
          </p>
        </div>
        <div className="flex gap-2">
          <Button onClick={() => setShowConfig(true)} variant="secondary">
            ⚙ Configure
          </Button>
          <Button onClick={() => setShowPropose(true)} disabled={!config?.enabled}>
            + Propose Payment
          </Button>
        </div>
      </div>

      {/* Config Summary */}
      <Card className="p-4">
        <div className="flex items-center justify-between">
          <div>
            <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
              {config?.enabled
                ? `${threshold}/${signerCount} threshold`
                : "Multisig not configured"}
            </span>
          </div>
          <Badge variant={config?.enabled ? "success" : "warning"}>
            {config?.enabled ? "Active" : "Inactive"}
          </Badge>
        </div>
        {config?.enabled && config.signers.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {config.signers.map((s, i) => (
              <code key={i} className="text-xs bg-gray-100 dark:bg-gray-700 px-2 py-0.5 rounded font-mono truncate max-w-[200px]">
                {s.slice(0, 8)}...{s.slice(-4)}
              </code>
            ))}
          </div>
        )}
      </Card>

      {/* Approval Requests */}
      {requests.length === 0 ? (
        <EmptyState
          icon={
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-8 h-8 text-gray-400">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
            </svg>
          }
          title="No Pending Approvals"
          description={
            config?.enabled
              ? "Propose a payment to begin the multisig approval workflow."
              : "Multisig is not configured yet — set a threshold and signers to enable the approval workflow."
          }
          actionLabel={config?.enabled ? "Propose Payment" : "Configure Multisig"}
          onAction={() => (config?.enabled ? setShowPropose(true) : setShowConfig(true))}
        />
      ) : (
        <div className="space-y-3">
          {requests.map((req) => (
            <Card key={req.id} className="p-4">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <Badge variant={req.executed ? "success" : "info"}>
                      {req.executed ? "Executed" : "Pending"}
                    </Badge>
                    <span className="text-sm font-mono text-gray-600 dark:text-gray-400">
                      ID: {req.id}
                    </span>
                  </div>
                  <p className="text-sm text-gray-600 dark:text-gray-400">
                    To: <code className="text-xs">{req.payee?.slice(0, 12)}...</code>
                  </p>
                  <p className="text-lg font-semibold text-gray-900 dark:text-white">
                    {req.amount} XLM
                  </p>
                  <div className="flex items-center gap-2">
                    <div className="h-2 bg-gray-200 dark:bg-gray-700 rounded-full flex-1 max-w-[200px]">
                      <div
                        className="h-2 bg-green-500 rounded-full transition-all"
                        style={{
                          width: `${((req.approvals_count ?? 0) / Math.max(threshold, 1)) * 100}%`,
                        }}
                      />
                    </div>
                    <span className="text-xs text-gray-500">
                      {req.approvals_count ?? 0}/{threshold}
                    </span>
                  </div>
                </div>
                <div className="flex gap-2">
                  {!req.executed && !req.threshold_met && (
                    <Button size="sm" onClick={() => handleApprove(req.id)}>
                      ✓ Approve
                    </Button>
                  )}
                  {!req.executed && req.threshold_met && (
                    <Button size="sm" variant="primary" onClick={() => handleExecute(req.id)}>
                      Execute
                    </Button>
                  )}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Config Modal */}
      <Modal
        open={showConfig}
        onClose={() => setShowConfig(false)}
        title="Configure Multisig"
        description="Set the threshold and authorized signers for multisig approvals."
      >
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Threshold (N of M)
            </label>
            <input
              type="number"
              min={1}
              value={formThreshold}
              onChange={(e) => setFormThreshold(Number(e.target.value))}
              className="w-full px-3 py-2 border rounded-lg dark:bg-gray-800 dark:border-gray-700"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Signer Addresses (comma-separated)
            </label>
            <textarea
              value={formSigners}
              onChange={(e) => setFormSigners(e.target.value)}
              rows={3}
              placeholder="GABC..., GDEF..., GHIJ..."
              className="w-full px-3 py-2 border rounded-lg dark:bg-gray-800 dark:border-gray-700 font-mono text-xs"
            />
          </div>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={formEnabled}
              onChange={(e) => setFormEnabled(e.target.checked)}
            />
            <span className="text-sm text-gray-700 dark:text-gray-300">Enable multisig</span>
          </label>
          <Button onClick={handleConfigSubmit} loading={submitting} className="w-full">
            Save Configuration
          </Button>
        </div>
      </Modal>

      {/* Propose Modal */}
      <Modal
        open={showPropose}
        onClose={() => setShowPropose(false)}
        title="Propose Payment"
        description="Create a payment that requires multisig approval."
      >
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Recipient Address
            </label>
            <input
              value={proposePayee}
              onChange={(e) => setProposePayee(e.target.value)}
              className="w-full px-3 py-2 border rounded-lg dark:bg-gray-800 dark:border-gray-700 font-mono text-xs"
              placeholder="GABC..."
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Amount (XLM)
            </label>
            <input
              type="number"
              value={proposeAmount}
              onChange={(e) => setProposeAmount(e.target.value)}
              className="w-full px-3 py-2 border rounded-lg dark:bg-gray-800 dark:border-gray-700"
              placeholder="100.00"
            />
          </div>
          <Button onClick={handlePropose} loading={submitting} className="w-full">
            Propose Payment
          </Button>
        </div>
      </Modal>
    </div>
  );
}
