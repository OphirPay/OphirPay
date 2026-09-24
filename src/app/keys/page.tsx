"use client";
// SPDX-License-Identifier: MIT

import { useState, useEffect, useCallback } from "react";
import { Breadcrumb } from "@/components/Breadcrumb";
import { Card } from "@/components/ui/Card";
import { LoadingSkeleton } from "@/components/LoadingSkeleton";
import { Badge } from "@/components/ui/Badge";
import { Modal } from "@/components/ui/Modal";
import { useApiQuery } from "@/hooks/useApiQuery";
import {
  API_SCOPES,
  type ApiScope,
} from "@/lib/api-scopes";
import { useToast } from "@/components/ui/Toast";
import { CopyButton } from "@/components/ui/CopyButton";

interface ApiKeyRecord {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  lastUsed: string | null;
  createdAt: string;
  expiresAt: string | null;
  supersededById?: string | null;
  rotationExpiresAt?: string | null;
  revokedAt?: string | null;
  supersededBy?: {
    id: string;
    name: string;
    prefix: string;
  } | null;
}

interface KeyUsage {
  id: string;
  name: string;
  prefix: string;
  lastUsed: string | null;
  createdAt: string;
  expiresAt: string | null;
  total: number;
  window: number;
}

interface KeyStatsResponse {
  window: string;
  keys: KeyUsage[];
}

const SCOPE_DESCRIPTIONS: Record<ApiScope, string> = {
  "read:payments": "View payments and payment history",
  "write:payments": "Create and submit payments",
  "read:analytics": "Read analytics and reporting data",
  admin: "Full access to all API capabilities",
};

const OVERLAP_WINDOW_OPTIONS = [
  { label: "1 hour", seconds: 3600 },
  { label: "24 hours (Recommended)", seconds: 86400 },
  { label: "7 days", seconds: 604800 },
  { label: "30 days", seconds: 2592000 },
];

function formatDate(value: string | null) {
  if (!value) return "Never";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function formatRemaining(expiresAt: string) {
  const diffMs = new Date(expiresAt).getTime() - Date.now();
  if (diffMs <= 0) return "Expired";
  const hours = Math.floor(diffMs / (1000 * 60 * 60));
  const days = Math.floor(hours / 24);
  if (days > 0) return `${days}d ${hours % 24}h remaining`;
  const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
  return `${hours}h ${minutes}m remaining`;
}

export default function ApiKeysPage() {
  const toast = useToast();
  const [keys, setKeys] = useState<ApiKeyRecord[]>([]);
  const [loading, setLoading] = useState(true);

  // Create form
  const [name, setName] = useState("");
  const [selectedScopes, setSelectedScopes] = useState<ApiScope[]>([]);
  const [creating, setCreating] = useState(false);
  const [newRawKey, setNewRawKey] = useState<string | null>(null);

  // Edit scopes panel
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editScopes, setEditScopes] = useState<ApiScope[]>([]);

  // Rotation modal & state
  const [rotateTarget, setRotateTarget] = useState<ApiKeyRecord | null>(null);
  const [rotateName, setRotateName] = useState("");
  const [rotateOverlapSeconds, setRotateOverlapSeconds] = useState(86400);
  const [rotating, setRotating] = useState(false);
  const [rotatedKeyData, setRotatedKeyData] = useState<{
    newKey: { id: string; name: string; prefix: string; key: string };
    oldKey: { id: string; name: string; prefix: string };
    overlapExpiresAt: string;
  } | null>(null);

  // Action states
  const [retiringId, setRetiringId] = useState<string | null>(null);
  const [cancellingId, setCancellingId] = useState<string | null>(null);

  // Usage-stats window
  const [window, setWindow] = useState("30d");

  const { data: usage, isLoading: usageLoading, error: usageError } = useApiQuery<KeyStatsResponse>(
    ["api-keys", "stats", window],
    `/api/keys/stats?window=${window}`
  );

  const loadKeys = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/keys", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load keys");
      const data = await res.json();
      setKeys(data.data ?? []);
    } catch {
      toast.error("Could not load API keys", "Please try again.");
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    loadKeys();
  }, [loadKeys]);

  const toggleScope = (
    scope: ApiScope,
    current: ApiScope[],
    set: (s: ApiScope[]) => void
  ) => {
    set(
      current.includes(scope)
        ? current.filter((s) => s !== scope)
        : [...current, scope]
    );
  };

  const handleCreate = async () => {
    if (!name.trim()) {
      toast.error("Name required", "Please name your API key.");
      return;
    }
    setCreating(true);
    try {
      const res = await fetch("/api/keys", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), scopes: selectedScopes }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error?.message ?? "Failed to create key");
      }
      setNewRawKey(data.data.key);
      setName("");
      setSelectedScopes([]);
      toast.success("API key created", "Copy it now — it won't be shown again.");
      loadKeys();
    } catch (err) {
      toast.error(
        "Creation failed",
        err instanceof Error ? err.message : "Unknown error"
      );
    } finally {
      setCreating(false);
    }
  };

  const handleSaveScopes = async (id: string) => {
    try {
      const res = await fetch("/api/keys", {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, scopes: editScopes }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error?.message ?? "Failed to update scopes");
      }
      toast.success("Scopes updated", "The key's permissions were saved.");
      setEditingId(null);
      loadKeys();
    } catch (err) {
      toast.error(
        "Update failed",
        err instanceof Error ? err.message : "Unknown error"
      );
    }
  };

  const handleDelete = async (id: string) => {
    try {
      const res = await fetch(`/api/keys?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to delete key");
      toast.success("Key revoked", "The API key can no longer be used.");
      loadKeys();
    } catch {
      toast.error("Delete failed", "Please try again.");
    }
  };

  const openRotate = (key: ApiKeyRecord) => {
    setRotateTarget(key);
    setRotateName(`${key.name} (rotated)`);
    setRotateOverlapSeconds(86400);
  };

  const handleExecuteRotate = async () => {
    if (!rotateTarget) return;
    setRotating(true);
    try {
      const res = await fetch(`/api/keys/${rotateTarget.id}/rotate`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: rotateName.trim() || undefined,
          overlapWindowSeconds: rotateOverlapSeconds,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error?.message ?? "Failed to rotate API key");
      }
      setRotatedKeyData({
        newKey: data.data.newKey,
        oldKey: data.data.oldKey,
        overlapExpiresAt: data.data.overlapExpiresAt,
      });
      setRotateTarget(null);
      toast.success("Key rotated successfully", "Replacement key generated with identical scopes.");
      loadKeys();
    } catch (err) {
      toast.error(
        "Rotation failed",
        err instanceof Error ? err.message : "Unknown error"
      );
    } finally {
      setRotating(false);
    }
  };

  const handleRetireEarly = async (id: string) => {
    setRetiringId(id);
    try {
      const res = await fetch(`/api/keys/${id}/retire`, {
        method: "POST",
        credentials: "include",
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error?.message ?? "Failed to retire key overlap");
      }
      toast.success("Key retired immediately", "Overlap window closed. The old key can no longer authenticate.");
      loadKeys();
    } catch (err) {
      toast.error("Retirement failed", err instanceof Error ? err.message : "Unknown error");
    } finally {
      setRetiringId(null);
    }
  };

  const handleCancelRotation = async (id: string) => {
    setCancellingId(id);
    try {
      const res = await fetch(`/api/keys/${id}/cancel-rotation`, {
        method: "POST",
        credentials: "include",
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error?.message ?? "Failed to cancel rotation");
      }
      toast.success("Rotation cancelled", "The original key remains active and the replacement key was removed.");
      loadKeys();
    } catch (err) {
      toast.error("Cancellation failed", err instanceof Error ? err.message : "Unknown error");
    } finally {
      setCancellingId(null);
    }
  };

  const openEdit = (key: ApiKeyRecord) => {
    setEditingId(key.id);
    setEditScopes(key.scopes as ApiScope[]);
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <Breadcrumb items={[{ label: "API Keys" }]} />
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">API Keys</h1>
          <p className="mt-1 text-gray-500 dark:text-gray-400">
            Create keys with scoped permissions, execute zero-downtime rotation, and monitor usage
          </p>
        </div>
        <label className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
          Window
          <select
            value={window}
            onChange={(event) => setWindow(event.target.value)}
            className="rounded-lg border border-gray-200 bg-white px-3 py-2 dark:border-gray-700 dark:bg-gray-900"
          >
            <option value="24h">Last 24 hours</option>
            <option value="7d">Last 7 days</option>
            <option value="30d">Last 30 days</option>
          </select>
        </label>
      </div>

      {/* Request usage */}
      <Card padding="none">
        {usageLoading ? (
          <LoadingSkeleton variant="table" />
        ) : usageError ? (
          <div className="p-6 text-sm text-red-600 dark:text-red-400">
            Failed to load API key usage: {usageError.message}
          </div>
        ) : usage?.keys.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-gray-200 bg-gray-50 text-xs uppercase tracking-wide text-gray-500 dark:border-gray-800 dark:bg-gray-900/50 dark:text-gray-400">
                <tr>
                  <th className="px-6 py-3 font-medium">Key</th>
                  <th className="px-6 py-3 font-medium">Requests ({usage.window})</th>
                  <th className="px-6 py-3 font-medium">All time</th>
                  <th className="px-6 py-3 font-medium">Last used</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {usage.keys.map((key) => (
                  <tr key={key.id} className="text-gray-700 dark:text-gray-300">
                    <td className="px-6 py-4">
                      <div className="font-medium text-gray-900 dark:text-white">
                        {key.name}
                      </div>
                      <div className="font-mono text-xs text-gray-500">
                        {key.prefix}...
                      </div>
                    </td>
                    <td className="px-6 py-4 font-semibold text-ophir-700 dark:text-ophir-400">
                      {key.window.toLocaleString()}
                    </td>
                    <td className="px-6 py-4">{key.total.toLocaleString()}</td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      {formatDate(key.lastUsed)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="p-10 text-center text-sm text-gray-500 dark:text-gray-400">
            No API keys yet.
          </div>
        )}
      </Card>

      {/* Create card */}
      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5 space-y-4">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
          Create a new API key
        </h2>

        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
            Name
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Production server"
            className="w-full px-4 py-2.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-400 text-sm focus:outline-none focus:ring-2 focus:ring-ophir-500"
          />
        </div>

        <div>
          <p className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            Scopes
          </p>
          <div className="grid sm:grid-cols-2 gap-2">
            {API_SCOPES.map((scope) => {
              const checked = selectedScopes.includes(scope);
              return (
                <label
                  key={scope}
                  className="flex items-start gap-2.5 p-3 rounded-lg border border-gray-200 dark:border-gray-700 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800"
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() =>
                      toggleScope(scope, selectedScopes, setSelectedScopes)
                    }
                    className="mt-0.5 h-4 w-4 rounded border-gray-300 text-ophir-600 focus:ring-ophir-500"
                  />
                  <span className="text-sm">
                    <span className="font-mono font-medium text-gray-800 dark:text-gray-200">
                      {scope}
                    </span>
                    <span className="block text-gray-500 dark:text-gray-400">
                      {SCOPE_DESCRIPTIONS[scope]}
                    </span>
                  </span>
                </label>
              );
            })}
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
            No scopes selected means the key cannot call any scoped endpoint.
            The <span className="font-mono">admin</span> scope grants everything.
          </p>
        </div>

        <button
          onClick={handleCreate}
          disabled={creating}
          className="px-5 py-2.5 rounded-lg bg-ophir-600 text-white text-sm font-medium hover:bg-ophir-700 transition-colors disabled:opacity-50"
        >
          {creating ? "Creating..." : "Create API key"}
        </button>

        {newRawKey && (
          <div className="p-4 rounded-lg bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800 space-y-2">
            <p className="text-sm text-green-700 dark:text-green-400 font-medium">
              Key created — copy it now (it won't be shown again):
            </p>
            <div className="flex items-center gap-2">
              <code className="flex-1 break-all text-xs font-mono text-gray-800 dark:text-gray-200 bg-white dark:bg-gray-900 p-2.5 rounded border border-gray-200 dark:border-gray-700">
                {newRawKey}
              </code>
              <CopyButton value={newRawKey} label="Key" />
            </div>
          </div>
        )}
      </div>

      {/* Keys List */}
      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
          Your API keys
        </h2>

        {loading ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">Loading…</p>
        ) : keys.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">
            You have no API keys yet.
          </p>
        ) : (
          <ul className="space-y-4">
            {keys.map((key) => {
              const isRevoked = !!key.revokedAt;
              const isOverlapping =
                !isRevoked &&
                !!key.supersededById &&
                !!key.rotationExpiresAt &&
                new Date(key.rotationExpiresAt) > new Date();
              const isRotatedExpired =
                !isRevoked &&
                !!key.supersededById &&
                !!key.rotationExpiresAt &&
                new Date(key.rotationExpiresAt) <= new Date();

              return (
                <li
                  key={key.id}
                  className={`rounded-xl border p-4 space-y-3 transition-colors ${
                    isOverlapping
                      ? "border-amber-300 dark:border-amber-800/80 bg-amber-50/20 dark:bg-amber-950/10"
                      : isRotatedExpired
                      ? "border-gray-200 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-900/30 opacity-75"
                      : isRevoked
                      ? "border-red-200 dark:border-red-900/40 bg-red-50/20 dark:bg-red-950/10 opacity-60"
                      : "border-gray-200 dark:border-gray-800"
                  }`}
                >
                  <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                    <div className="min-w-0 space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-gray-900 dark:text-white">
                          {key.name}
                        </span>

                        {isOverlapping && (
                          <Badge variant="warning" dot>
                            ROTATING &bull; OVERLAP ACTIVE
                          </Badge>
                        )}
                        {isRotatedExpired && (
                          <Badge variant="default">
                            EXPIRED (ROTATED OUT)
                          </Badge>
                        )}
                        {isRevoked && (
                          <Badge variant="danger">
                            REVOKED
                          </Badge>
                        )}
                        {!isOverlapping && !isRotatedExpired && !isRevoked && (
                          <Badge variant="success">
                            ACTIVE
                          </Badge>
                        )}
                      </div>

                      <p className="text-xs font-mono text-gray-500 dark:text-gray-400">
                        {key.prefix}… · created{" "}
                        {new Date(key.createdAt).toLocaleDateString()}
                        {key.lastUsed
                          ? ` · last used ${new Date(key.lastUsed).toLocaleDateString()}`
                          : " · never used"}
                      </p>

                      <div className="flex flex-wrap gap-1.5 pt-1">
                        {key.scopes.length === 0 ? (
                          <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400">
                            no scopes
                          </span>
                        ) : (
                          key.scopes.map((s) => (
                            <span
                              key={s}
                              className="px-2 py-0.5 rounded-full text-xs font-medium bg-ophir-100 text-ophir-700 dark:bg-ophir-950/50 dark:text-ophir-300"
                            >
                              {s}
                            </span>
                          ))
                        )}
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-2 shrink-0">
                      {/* Active, unrotated key actions */}
                      {!isOverlapping && !isRotatedExpired && !isRevoked && (
                        <>
                          <button
                            onClick={() => openRotate(key)}
                            className="px-3 py-1.5 rounded-lg border border-amber-300 dark:border-amber-700 text-amber-700 dark:text-amber-300 text-xs font-medium hover:bg-amber-50 dark:hover:bg-amber-950/30 transition-colors"
                          >
                            Rotate key
                          </button>
                          <button
                            onClick={() => openEdit(key)}
                            className="px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 text-xs font-medium hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                          >
                            Edit scopes
                          </button>
                          <button
                            onClick={() => handleDelete(key.id)}
                            className="px-3 py-1.5 rounded-lg border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 text-xs font-medium hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors"
                          >
                            Revoke
                          </button>
                        </>
                      )}

                      {/* Active rotation overlap actions */}
                      {isOverlapping && (
                        <>
                          <button
                            onClick={() => handleRetireEarly(key.id)}
                            disabled={retiringId === key.id}
                            className="px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-xs font-medium transition-colors disabled:opacity-50"
                          >
                            {retiringId === key.id ? "Retiring..." : "Retire old key now"}
                          </button>
                          <button
                            onClick={() => handleCancelRotation(key.id)}
                            disabled={cancellingId === key.id}
                            className="px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300 text-xs font-medium hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors disabled:opacity-50"
                          >
                            {cancellingId === key.id ? "Cancelling..." : "Cancel rotation"}
                          </button>
                        </>
                      )}

                      {/* Expired or revoked actions */}
                      {(isRotatedExpired || isRevoked) && (
                        <button
                          onClick={() => handleDelete(key.id)}
                          className="px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 text-xs font-medium hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                        >
                          Remove
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Overlap Status Callout */}
                  {isOverlapping && key.rotationExpiresAt && (
                    <div className="mt-2 p-3 rounded-lg bg-amber-100/60 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/60 text-xs text-amber-900 dark:text-amber-200 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold">Dual-Key Overlap Active:</span>
                        <span>
                          Both this key and replacement key authenticate until{" "}
                          <span className="font-medium underline">
                            {formatDate(key.rotationExpiresAt)}
                          </span>{" "}
                          ({formatRemaining(key.rotationExpiresAt)}).
                        </span>
                      </div>
                      <span className="text-[11px] text-amber-700 dark:text-amber-400 font-mono">
                        Deploy replacement key before expiry
                      </span>
                    </div>
                  )}

                  {/* Expired Rotation Callout */}
                  {isRotatedExpired && key.rotationExpiresAt && (
                    <div className="mt-2 p-2.5 rounded-lg bg-gray-100 dark:bg-gray-800/60 text-xs text-gray-600 dark:text-gray-400 flex items-center justify-between">
                      <span>
                        Overlap window closed on {formatDate(key.rotationExpiresAt)}. Requests using this key will be rejected.
                      </span>
                      <span className="font-mono text-[11px] text-red-500">
                        REJECTED (ROTATION_EXPIRED)
                      </span>
                    </div>
                  )}

                  {/* Edit Scopes Drawer */}
                  {editingId === key.id && (
                    <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-800 space-y-3">
                      <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
                        Effective scopes for “{key.name}”
                      </p>
                      <div className="grid sm:grid-cols-2 gap-2">
                        {API_SCOPES.map((scope) => {
                          const checked = editScopes.includes(scope);
                          return (
                            <label
                              key={scope}
                              className="flex items-start gap-2.5 p-2.5 rounded-lg border border-gray-200 dark:border-gray-700 cursor-pointer"
                            >
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() =>
                                  toggleScope(scope, editScopes, setEditScopes)
                                }
                                className="mt-0.5 h-4 w-4 rounded border-gray-300 text-ophir-600 focus:ring-ophir-500"
                              />
                              <span className="text-sm font-mono text-gray-800 dark:text-gray-200">
                                {scope}
                              </span>
                            </label>
                          );
                        })}
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleSaveScopes(key.id)}
                          className="px-4 py-2 rounded-lg bg-ophir-600 text-white text-xs font-medium hover:bg-ophir-700 transition-colors"
                        >
                          Save scopes
                        </button>
                        <button
                          onClick={() => setEditingId(null)}
                          className="px-4 py-2 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 text-xs font-medium transition-colors"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Rotate Key Modal */}
      {rotateTarget && (
        <Modal
          open={!!rotateTarget}
          onClose={() => setRotateTarget(null)}
          title={`Rotate API Key: ${rotateTarget.name}`}
          description="Issue a replacement key with identical scopes while maintaining zero downtime."
        >
          <div className="space-y-4">
            <p className="text-xs text-gray-600 dark:text-gray-300">
              During the overlap window, <strong>both</strong> the current key and the replacement key will authenticate requests. Once the window closes, the old key will automatically stop working.
            </p>

            <div>
              <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                Replacement Key Name
              </label>
              <input
                type="text"
                value={rotateName}
                onChange={(e) => setRotateName(e.target.value)}
                placeholder={`${rotateTarget.name} (rotated)`}
                className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm focus:outline-none focus:ring-2 focus:ring-ophir-500"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                Dual-Key Overlap Window
              </label>
              <select
                value={rotateOverlapSeconds}
                onChange={(e) => setRotateOverlapSeconds(Number(e.target.value))}
                className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm focus:outline-none focus:ring-2 focus:ring-ophir-500"
              >
                {OVERLAP_WINDOW_OPTIONS.map((opt) => (
                  <option key={opt.seconds} value={opt.seconds}>
                    {opt.label}
                  </option>
                ))}
              </select>
              <p className="text-[11px] text-gray-400 mt-1">
                Old key expires automatically at the end of this window. You can also retire it early from the dashboard once deployment finishes.
              </p>
            </div>

            <div>
              <span className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                Inherited Scopes
              </span>
              <div className="flex flex-wrap gap-1.5">
                {rotateTarget.scopes.length > 0 ? (
                  rotateTarget.scopes.map((s) => (
                    <Badge key={s} variant="info">
                      {s}
                    </Badge>
                  ))
                ) : (
                  <span className="text-xs text-gray-400">(no scopes)</span>
                )}
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-gray-100 dark:border-gray-800">
              <button
                type="button"
                onClick={() => setRotateTarget(null)}
                className="px-4 py-2 rounded-lg border border-gray-200 dark:border-gray-700 text-xs font-medium text-gray-700 dark:text-gray-300"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleExecuteRotate}
                disabled={rotating}
                className="px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-xs font-medium transition-colors disabled:opacity-50"
              >
                {rotating ? "Rotating..." : "Start Rotation"}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Post-Rotation Plain Text Key Modal */}
      {rotatedKeyData && (
        <Modal
          open={!!rotatedKeyData}
          onClose={() => setRotatedKeyData(null)}
          title="Replacement API Key Generated"
          description="Save your replacement key now — it will never be displayed again."
        >
          <div className="space-y-4">
            <div className="p-3 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg text-xs text-amber-800 dark:text-amber-300">
              Dual-key overlap is now active. Your previous key ({rotatedKeyData.oldKey.name}) will remain valid until{" "}
              <strong>{formatDate(rotatedKeyData.overlapExpiresAt)}</strong>.
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                New API Key
              </label>
              <div className="flex items-center gap-2">
                <code className="flex-1 break-all text-xs font-mono bg-gray-100 dark:bg-gray-800 p-2.5 rounded border border-gray-200 dark:border-gray-700 text-gray-900 dark:text-white">
                  {rotatedKeyData.newKey.key}
                </code>
                <CopyButton value={rotatedKeyData.newKey.key} label="New Key" />
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <button
                type="button"
                onClick={() => setRotatedKeyData(null)}
                className="px-4 py-2 rounded-lg bg-ophir-600 hover:bg-ophir-700 text-white text-xs font-medium transition-colors"
              >
                Done
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
