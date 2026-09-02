"use client";
// SPDX-License-Identifier: MIT

import { useState } from "react";
import { Breadcrumb } from "@/components/Breadcrumb";
import { Card } from "@/components/ui/Card";
import { LoadingSkeleton } from "@/components/LoadingSkeleton";
import { useApiQuery } from "@/hooks/useApiQuery";

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

function formatDate(value: string | null) {
  if (!value) return "Never";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

export default function ApiKeysPage() {
  const [window, setWindow] = useState("30d");
  const { data, isLoading, error } = useApiQuery<KeyStatsResponse>(["api-keys", "stats", window], `/api/keys/stats?window=${window}`);

  return (
    <div className="space-y-6 animate-fade-in">
      <Breadcrumb items={[{ label: "API Keys" }]} />
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">API Keys</h1>
          <p className="mt-1 text-gray-500 dark:text-gray-400">Request volume and activity by credential</p>
        </div>
        <label className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
          Window
          <select value={window} onChange={(event) => setWindow(event.target.value)} className="rounded-lg border border-gray-200 bg-white px-3 py-2 dark:border-gray-700 dark:bg-gray-900">
            <option value="24h">Last 24 hours</option>
            <option value="7d">Last 7 days</option>
            <option value="30d">Last 30 days</option>
          </select>
        </label>
      </div>

      <Card padding="none">
        {isLoading ? <LoadingSkeleton variant="table" /> : error ? (
          <div className="p-6 text-sm text-red-600 dark:text-red-400">Failed to load API key usage: {error.message}</div>
        ) : data?.keys.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-gray-200 bg-gray-50 text-xs uppercase tracking-wide text-gray-500 dark:border-gray-800 dark:bg-gray-900/50 dark:text-gray-400">
                <tr><th className="px-6 py-3 font-medium">Key</th><th className="px-6 py-3 font-medium">Requests ({data.window})</th><th className="px-6 py-3 font-medium">All time</th><th className="px-6 py-3 font-medium">Last used</th></tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {data.keys.map((key) => <tr key={key.id} className="text-gray-700 dark:text-gray-300">
                  <td className="px-6 py-4"><div className="font-medium text-gray-900 dark:text-white">{key.name}</div><div className="font-mono text-xs text-gray-500">{key.prefix}...</div></td>
                  <td className="px-6 py-4 font-semibold text-ophir-700 dark:text-ophir-400">{key.window.toLocaleString()}</td>
                  <td className="px-6 py-4">{key.total.toLocaleString()}</td>
                  <td className="px-6 py-4 whitespace-nowrap">{formatDate(key.lastUsed)}</td>
                </tr>)}
              </tbody>
            </table>
          </div>
        ) : <div className="p-10 text-center text-sm text-gray-500 dark:text-gray-400">No API keys yet.</div>}
      </Card>
    </div>
  );
}
import { useState, useEffect, useCallback } from "react";
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
}

const SCOPE_DESCRIPTIONS: Record<ApiScope, string> = {
  "read:payments": "View payments and payment history",
  "write:payments": "Create and submit payments",
  "read:analytics": "Read analytics and reporting data",
  admin: "Full access to all API capabilities",
};

export default function ApiKeysPage() {
  const toast = useToast();
  const [keys, setKeys] = useState<ApiKeyRecord[]>([]);
  const [loading, setLoading] = useState(true);

  // Create form
  const [name, setName] = useState("");
  const [selectedScopes, setSelectedScopes] = useState<ApiScope[]>([]);
  const [creating, setCreating] = useState(false);
  const [newRawKey, setNewRawKey] = useState<string | null>(null);

  // Edit panel
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editScopes, setEditScopes] = useState<ApiScope[]>([]);

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

  const openEdit = (key: ApiKeyRecord) => {
    setEditingId(key.id);
    setEditScopes(key.scopes as ApiScope[]);
  };

  return (
    <div className="max-w-4xl mx-auto mt-8 animate-fade-in px-4">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
          API Keys
        </h1>
        <p className="text-gray-500 dark:text-gray-400 mt-1">
          Create keys with scoped permissions. Each key only grants the scopes
          you select.
        </p>
      </div>

      {/* Create card */}
      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5 mb-6 space-y-4">
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
          <div className="p-3 rounded-lg bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800">
            <p className="text-sm text-green-700 dark:text-green-400 font-medium mb-2">
              Key created — copy it now:
            </p>
            <div className="flex items-center gap-2">
              <code className="flex-1 break-all text-xs font-mono text-gray-800 dark:text-gray-200 bg-white dark:bg-gray-900 p-2 rounded">
                {newRawKey}
              </code>
              <CopyButton value={newRawKey} label="Key" />
            </div>
          </div>
        )}
      </div>

      {/* List */}
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
          <ul className="space-y-3">
            {keys.map((key) => (
              <li
                key={key.id}
                className="rounded-lg border border-gray-200 dark:border-gray-800 p-4"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="font-medium text-gray-900 dark:text-white">
                      {key.name}
                    </p>
                    <p className="text-xs font-mono text-gray-500 dark:text-gray-400">
                      {key.prefix}… · created{" "}
                      {new Date(key.createdAt).toLocaleDateString()}
                      {key.lastUsed
                        ? ` · last used ${new Date(key.lastUsed).toLocaleDateString()}`
                        : ""}
                    </p>
                    <div className="flex flex-wrap gap-1.5 mt-2">
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
                  <div className="flex gap-2 shrink-0">
                    <button
                      onClick={() => openEdit(key)}
                      className="px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 text-xs font-medium hover:bg-gray-50 dark:hover:bg-gray-800"
                    >
                      Edit scopes
                    </button>
                    <button
                      onClick={() => handleDelete(key.id)}
                      className="px-3 py-1.5 rounded-lg border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 text-xs font-medium hover:bg-red-50 dark:hover:bg-red-950/30"
                    >
                      Revoke
                    </button>
                  </div>
                </div>

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
                        className="px-4 py-2 rounded-lg bg-ophir-600 text-white text-xs font-medium hover:bg-ophir-700"
                      >
                        Save scopes
                      </button>
                      <button
                        onClick={() => setEditingId(null)}
                        className="px-4 py-2 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 text-xs font-medium"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
