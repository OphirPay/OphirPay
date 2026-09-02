"use client";
// SPDX-License-Identifier: MIT

import { useState, useEffect } from "react";
import { usePageTitle } from "@/hooks/usePageTitle";
import { PAGE_TITLES } from "@/lib/page-titles";
import { useQueryClient } from "@tanstack/react-query";
import { EmptyState } from "@/components/EmptyState";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { useToast } from "@/components/ui/Toast";
import { useWallet } from "@/hooks/useMultiWallet";
import { useApiQuery } from "@/hooks/useApiQuery";
import { grantRole, revokeRole, Role, type RoleValue } from "@/lib/contract-advanced";

interface RoleAssignment {
  address: string;
  role: RoleValue;
  roleName: string;
}

const ROLE_LABELS: Record<RoleValue, { label: string; color: "info" | "success" | "warning" }> = {
  [Role.Admin]: { label: "Admin", color: "success" },
  [Role.Operator]: { label: "Operator", color: "info" },
  [Role.Auditor]: { label: "Auditor", color: "warning" },
};

export default function RBACPage() {
  usePageTitle(PAGE_TITLES.RBAC);
  const toast = useToast();
  const { wallet } = useWallet();
  const queryClient = useQueryClient();
  const [showGrant, setShowGrant] = useState(false);
  const [showRevoke, setShowRevoke] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [grantAddress, setGrantAddress] = useState("");
  const [grantRoleVal, setGrantRoleVal] = useState<RoleValue>(Role.Operator);
  const [revokeAddress, setRevokeAddress] = useState("");

  // The contract has no role-enumeration function, so the API can only report
  // a single address's role (via ?addr=). We seed the list with the connected
  // wallet's own role and keep grant/revoke updates optimistically.
  const {
    data: ownRole,
    isLoading: loading,
  } = useApiQuery<{ address: string; role: RoleValue | null }>(
    ["rbac", wallet.publicKey ?? "none"],
    wallet.publicKey ? `/api/rbac?addr=${encodeURIComponent(wallet.publicKey)}` : undefined,
    { enabled: !!wallet.publicKey }
  );

  const [assignments, setAssignments] = useState<RoleAssignment[]>([]);

  // Seed the list with the connected wallet's own role assignment.
  useEffect(() => {
    if (!ownRole || ownRole.role === null || ownRole.role === undefined) return;
    const role = ownRole.role as RoleValue;
    setAssignments((prev) => {
      const exists = prev.some((a) => a.address === ownRole.address);
      if (exists) {
        return prev.map((a) =>
          a.address === ownRole.address ? { ...a, role, roleName: ROLE_LABELS[role]?.label ?? "Unknown" } : a
        );
      }
      return [...prev, { address: ownRole.address, role, roleName: ROLE_LABELS[role]?.label ?? "Unknown" }];
    });
  }, [ownRole]);

  const handleGrant = async () => {
    if (!wallet.publicKey) { toast.error("Connect your wallet first"); return; }
    if (!grantAddress.startsWith("G") || grantAddress.length !== 56) {
      toast.error("Invalid Stellar public key");
      return;
    }
    setSubmitting(true);
    try {
      const result = await grantRole(wallet.publicKey, grantAddress, grantRoleVal);
      if (result.success) {
        toast.success(`Role granted on-chain`);
        setShowGrant(false);
        setGrantAddress("");
        setAssignments((prev) => [
          ...prev.filter((a) => a.address !== grantAddress),
          { address: grantAddress, role: grantRoleVal, roleName: ROLE_LABELS[grantRoleVal].label },
        ]);
        queryClient.invalidateQueries({ queryKey: ["rbac"] });
      } else {
        toast.error(result.error || "Grant failed — are you an Admin?");
      }
    } catch {
      toast.error("Network error");
    } finally {
      setSubmitting(false);
    }
  };

  const handleRevoke = async () => {
    if (!wallet.publicKey) { toast.error("Connect your wallet first"); return; }
    if (!revokeAddress.startsWith("G") || revokeAddress.length !== 56) {
      toast.error("Invalid Stellar public key");
      return;
    }
    setSubmitting(true);
    try {
      const result = await revokeRole(wallet.publicKey, revokeAddress);
      if (result.success) {
        toast.success("Role revoked on-chain");
        setShowRevoke(false);
        setRevokeAddress("");
        setAssignments((prev) => prev.filter((a) => a.address !== revokeAddress));
        queryClient.invalidateQueries({ queryKey: ["rbac"] });
      } else {
        toast.error(result.error || "Revoke failed — are you an Admin?");
      }
    } catch {
      toast.error("Network error");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="animate-fade-in space-y-6">
        <div className="h-8 w-48 bg-gray-200 dark:bg-gray-700 rounded animate-pulse" />
        <div className="grid gap-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-16 bg-gray-100 dark:bg-gray-800 rounded animate-pulse" />
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
              Connect your wallet to manage role-based access on-chain.
            </p>
          </div>
        </div>
      )}

      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
            Role-Based Access Control
          </h1>
          <p className="text-gray-500 dark:text-gray-400 mt-1">
            Admin &gt; Operator &gt; Auditor — on-chain role management
          </p>
        </div>
        <div className="flex gap-2">
          <Button onClick={() => setShowGrant(true)} variant="primary">
            + Grant Role
          </Button>
          <Button onClick={() => setShowRevoke(true)} variant="secondary">
            − Revoke Role
          </Button>
        </div>
      </div>

      {/* Role Assignments */}
      {assignments.length === 0 ? (
        <EmptyState
          icon={
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-8 h-8 text-gray-400">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
            </svg>
          }
          title="No Roles Assigned"
          description="Grant a role to begin managing on-chain access control."
          actionLabel="Grant Role"
          onAction={() => setShowGrant(true)}
        />
      ) : (
        <div className="space-y-3">
          {assignments.map((a, i) => (
            <Card key={i} className="p-4 hover:shadow-md transition-shadow">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-gradient-to-br from-indigo-400 to-purple-500 flex items-center justify-center text-white text-xs font-bold">
                    {a.address.slice(0, 2)}
                  </div>
                  <div>
                    <code className="text-sm font-mono text-gray-700 dark:text-gray-300 truncate max-w-[280px] block">
                      {a.address.slice(0, 12)}...{a.address.slice(-8)}
                    </code>
                    <span className="text-xs text-gray-400">Stellar address</span>
                  </div>
                </div>
                <Badge variant={ROLE_LABELS[a.role]?.color ?? "info"}>
                  {ROLE_LABELS[a.role]?.label ?? "Unknown"}
                </Badge>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Grant Role Modal */}
      <Modal
        open={showGrant}
        onClose={() => setShowGrant(false)}
        title="Grant Role"
        description="Assign a role to a Stellar address. Requires Admin privileges."
      >
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Stellar Address
            </label>
            <input
              value={grantAddress}
              onChange={(e) => setGrantAddress(e.target.value)}
              className="w-full px-3 py-2 border rounded-lg dark:bg-gray-800 dark:border-gray-700 font-mono text-xs"
              placeholder="GABC..."
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Role
            </label>
            <div className="flex gap-2">
              {([Role.Admin, Role.Operator, Role.Auditor] as RoleValue[]).map((r) => (
                <button
                  key={r}
                  onClick={() => setGrantRoleVal(r)}
                  className={`flex-1 px-3 py-2 rounded-lg border text-sm font-medium transition-all ${
                    grantRoleVal === r
                      ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300"
                      : "border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:border-gray-300"
                  }`}
                >
                  {ROLE_LABELS[r].label}
                </button>
              ))}
            </div>
          </div>
          <Button onClick={handleGrant} loading={submitting} className="w-full">
            Grant Role On-Chain
          </Button>
        </div>
      </Modal>

      {/* Revoke Role Modal */}
      <Modal
        open={showRevoke}
        onClose={() => setShowRevoke(false)}
        title="Revoke Role"
        description="Remove all roles from a Stellar address. Requires Admin privileges."
      >
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Stellar Address
            </label>
            <input
              value={revokeAddress}
              onChange={(e) => setRevokeAddress(e.target.value)}
              className="w-full px-3 py-2 border rounded-lg dark:bg-gray-800 dark:border-gray-700 font-mono text-xs"
              placeholder="GABC..."
            />
          </div>
          {revokeAddress && assignments.some((a) => a.address === revokeAddress) && (
            <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded p-3 text-sm text-amber-800 dark:text-amber-200">
              This will remove the <strong>{ROLE_LABELS[assignments.find((a) => a.address === revokeAddress)!.role].label}</strong> role from this address.
            </div>
          )}
          <Button onClick={handleRevoke} loading={submitting} variant="danger" className="w-full">
            Revoke Role On-Chain
          </Button>
        </div>
      </Modal>
    </div>
  );
}
