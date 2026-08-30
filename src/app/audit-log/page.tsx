"use client";
// SPDX-License-Identifier: MIT


import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { usePageTitle } from "@/hooks/usePageTitle";
import { PAGE_TITLES } from "@/lib/page-titles";
import { EmptyState } from "@/components/EmptyState";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { useApiQuery } from "@/hooks/useApiQuery";

interface AuditEntry {
  id: number | string;
  timestamp: number;
  action: string;
  actor: string;
  target_id: number | string;
  details: string | null;
}

const ACTION_COLORS: Record<string, "success" | "danger" | "warning" | "info"> = {
  payment_recorded: "success",
  payment_cancelled: "danger",
  escrow_created: "info",
  escrow_released_owner: "success",
  escrow_released_arbiter: "warning",
  escrow_claimed: "success",
  stream_created: "info",
  stream_claimed: "success",
  stream_cancelled: "danger",
  batch_created: "info",
  contract_paused: "danger",
  contract_unpaused: "success",
  role_granted: "info",
  role_revoked: "warning",
  multisig_configured: "info",
  multisig_proposed: "info",
  multisig_executed: "success",
  fee_config_set: "info",
  upgrade_proposed: "warning",
  upgrade_executed: "success",
  upgrade_cancelled: "danger",
  emergency_withdraw: "danger",
  ownership_transferred: "warning",
  timelock_proposed: "info",
  timelock_executed: "success",
  timelock_cancelled: "danger",
  proposal_created: "info",
  proposal_passed: "success",
  proposal_defeated: "danger",
  recurring_created: "info",
  recurring_executed: "success",
  recurring_cancelled: "danger",
  spending_limit_set: "info",
  escalation_configured: "info",
  governance_configured: "info",
};

export default function AuditLogPage() {
  usePageTitle(PAGE_TITLES.AUDIT_LOG);
  const [filter, setFilter] = useState("");
  const [connected, setConnected] = useState(false);
  const [liveMode, setLiveMode] = useState(false);
  const [page, setPage] = useState(1);
  const [limit] = useState(50);
  const [actionFilter, setActionFilter] = useState("");
  const [actorFilter, setActorFilter] = useState("");
  const [since, setSince] = useState("");
  const [until, setUntil] = useState("");
  
  // Live SSE entries are kept OUT of the query cache so window-focus refetches
  // (React Query default) don't wipe entries that streamed in after the last
  // fetch. They're merged with the fetched list at render time, deduped by id.
  const [liveEntries, setLiveEntries] = useState<AuditEntry[]>([]);
  const sseRef = useRef<EventSource | null>(null);

  const buildQuery = () => {
    const params = new URLSearchParams();
    params.set("page", page.toString());
    params.set("limit", limit.toString());
    if (filter) params.set("action", filter); // keep backward compat with text filter
    if (actionFilter) params.set("action", actionFilter);
    if (actorFilter) params.set("actor", actorFilter);
    if (since) params.set("since", since);
    if (until) params.set("until", until);
    params.set("source", "all");
    return params.toString();
  };

  const {
    data: rawEntries,
    isLoading: loading,
    refetch,
  } = useApiQuery<AuditEntry[]>(["audit-log", page, filter, actionFilter, actorFilter, since, until], `/api/audit-log?${buildQuery()}`);

  // Close the EventSource when the page unmounts — otherwise the stream keeps
  // polling and the connection leaks until the tab is closed.
  useEffect(() => {
    return () => {
      sseRef.current?.close();
    };
  }, []);

  const entries = useMemo(() => {
    const fetchedEntries = Array.isArray(rawEntries) ? rawEntries : [];
    const seen = new Set<number | string>();
    const merged: AuditEntry[] = [];
    for (const e of [...liveEntries, ...fetchedEntries]) {
      if (seen.has(e.id)) continue;
      seen.add(e.id);
      merged.push(e);
    }
    return merged.slice(0, 100);
  }, [liveEntries, rawEntries]);

  // SSE live streaming — prepend incoming entries into local state (survives refetches)
  const connectSSE = useCallback(() => {
    if (sseRef.current) sseRef.current.close();
    const es = new EventSource("/api/audit-log/sse");
    sseRef.current = es;
    es.addEventListener("connected", () => setConnected(true));
    es.addEventListener("audit:entry", (e) => {
      try {
        const data = JSON.parse(e.data);
        setLiveEntries((prev) => [data, ...prev].slice(0, 100));
      } catch {}
    });
    es.onerror = () => setConnected(false);
    return es;
  }, []);

  const toggleLive = () => {
    if (!liveMode) {
      connectSSE(); // stored in sseRef internally
      setLiveMode(true);
    } else {
      sseRef.current?.close();
      setConnected(false);
      setLiveMode(false);
      setLiveEntries([]);
    }
  };

  const filtered = filter
    ? entries.filter((e) => e.action.includes(filter) || (e.details ?? "").toLowerCase().includes(filter.toLowerCase()))
    : entries;

  const formatTime = (ts: number) => {
    const d = new Date(ts * 1000);
    return d.toLocaleString();
  };

  const handleExport = () => {
    const params = new URLSearchParams();
    params.set("page", "1");
    params.set("limit", "1000");
    if (actionFilter) params.set("action", actionFilter);
    if (actorFilter) params.set("actor", actorFilter);
    if (since) params.set("since", since);
    if (until) params.set("until", until);
    params.set("source", "all");
    params.set("format", "csv");
    window.open(`/api/audit-log?${params.toString()}`, "_blank");
  };

  const handlePageChange = (newPage: number) => {
    setPage(newPage);
    // Scroll to top of table
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  if (loading) {
    return (
      <div className="animate-fade-in space-y-6">
        <div className="h-8 w-48 bg-gray-200 dark:bg-gray-700 rounded animate-pulse" />
        <div className="space-y-3">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-16 bg-gray-100 dark:bg-gray-800 rounded animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  // Calculate pagination
  const totalPages = Math.ceil((rawEntries?.length ?? 0) / limit) || 1;

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
            📋 Audit Log
          </h1>
          <p className="text-gray-500 dark:text-gray-400 mt-1">
            Immutable on-chain trail of every contract state change
          </p>
        </div>
        <div className="flex gap-2 items-center flex-wrap">
          <Button
            size="sm"
            variant={liveMode ? "primary" : "secondary"}
            onClick={toggleLive}
          >
            {liveMode ? (
              <span className="flex items-center gap-1">
                <span className={`h-2 w-2 rounded-full ${connected ? "bg-green-500" : "bg-red-500"} animate-pulse`} />
                Live {connected ? "●" : "✕"}
              </span>
            ) : (
              "▶ Live"
            )}
          </Button>
          <Button size="sm" variant="secondary" onClick={handleExport}>
            📥 Export CSV
          </Button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3 flex-wrap">
        <Input
          type="text"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter by action or details..."
          className="w-full sm:w-64"
        />
        <Input
          type="text"
          value={actionFilter}
          onChange={(e) => { setActionFilter(e.target.value); setPage(1); }}
          placeholder="Filter by action (exact)..."
          className="w-full sm:w-48"
        />
        <Input
          type="text"
          value={actorFilter}
          onChange={(e) => { setActorFilter(e.target.value); setPage(1); }}
          placeholder="Filter by actor..."
          className="w-full sm:w-48"
        />
        <Input
          type="datetime-local"
          value={since}
          onChange={(e) => { 
            const val = e.target.value;
            setSince(val ? Math.floor(new Date(val).getTime() / 1000).toString() : "");
            setPage(1);
          }}
          className="w-full sm:w-56"
        />
        <Input
          type="datetime-local"
          value={until}
          onChange={(e) => { 
            const val = e.target.value;
            setUntil(val ? Math.floor(new Date(val).getTime() / 1000).toString() : "");
            setPage(1);
          }}
          className="w-full sm:w-56"
        />
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-8 h-8 text-gray-400">
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
            </svg>
          }
          title={filter ? "No Matching Entries" : "No Audit Entries"}
          description={filter ? "Try a different filter term." : "Contract activity will appear here as state changes occur."}
        />
      ) : (
        <div className="space-y-2">
          {filtered.map((entry) => (
            <Card key={entry.id} className="p-3 flex items-center gap-3 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors">
              <Badge variant={ACTION_COLORS[entry.action] ?? "info"}>
                {entry.action.replace(/_/g, " ")}
              </Badge>
              <div className="flex-1 min-w-0">
                <p className="text-sm text-gray-700 dark:text-gray-300 truncate">{entry.details ?? ""}</p>
                <p className="text-xs text-gray-400 truncate">
                  Actor: {entry.actor?.slice?.(0, 8)}...{entry.actor?.slice?.(-4)}
                  {entry.target_id > 0 ? ` · Target ID: ${entry.target_id}` : ""}
                </p>
              </div>
              <span className="text-xs text-gray-400 whitespace-nowrap">{formatTime(entry.timestamp)}</span>
            </Card>
          ))}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <Button
            size="sm"
            variant="secondary"
            onClick={() => handlePageChange(page - 1)}
            disabled={page <= 1}
          >
            ← Prev
          </Button>
          <span className="text-sm text-gray-600 dark:text-gray-400">
            Page {page} of {totalPages}
          </span>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => handlePageChange(page + 1)}
            disabled={page >= totalPages}
          >
            Next →
          </Button>
        </div>
      )}

      <p className="text-xs text-gray-400 text-center">
        Showing {filtered.length} of {entries.length} entries · All entries are stored immutably on-chain
      </p>
    </div>
  );
}