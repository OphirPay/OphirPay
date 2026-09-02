"use client";
// SPDX-License-Identifier: MIT


import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { usePageTitle } from "@/hooks/usePageTitle";
import { PAGE_TITLES } from "@/lib/page-titles";
import { EmptyState } from "@/components/EmptyState";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Pagination } from "@/components/ui/Pagination";
import { useApiQuery } from "@/hooks/useApiQuery";
import { useDebounce } from "@/hooks/useDebounce";

interface AuditEntry {
  id: number;
  timestamp: number;
  action: string;
  actor: string;
  target_id: number;
  details: string;
}

interface AuditLogResponse {
  entries: AuditEntry[];
  total: number;
  page: number;
  limit: number;
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

const PAGE_SIZES = [10, 20, 50] as const;
const DEFAULT_PAGE_SIZE = 20;

/** Parse a unix-seconds timestamp from a URL param, or null when absent/invalid. */
function parseTimestamp(raw: string | null): number | null {
  if (!raw) return null;
  const ts = Number(raw);
  return Number.isFinite(ts) && ts > 0 ? Math.floor(ts) : null;
}

/** Format a unix timestamp as a yyyy-mm-dd value for <input type="date">. */
function toDateInputValue(ts: number | null): string {
  if (!ts) return "";
  const d = new Date(ts * 1000);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** yyyy-mm-dd → unix seconds at local midnight (start of the selected day). */
function dateToStartOfDay(dateStr: string): number {
  return new Date(`${dateStr}T00:00:00`).getTime() / 1000;
}

/** yyyy-mm-dd → unix seconds at 23:59:59 local (end of the selected day). */
function dateToEndOfDay(dateStr: string): number {
  return new Date(`${dateStr}T23:59:59`).getTime() / 1000;
}

/**
 * Fetch a page of the audit log from the API. Uses a plain fetch (instead of
 * the shared apiFetch wrapper) because the response meta — page/limit/total —
 * is needed to drive pagination.
 */
async function fetchAuditLog(filters: {
  actor: string;
  action: string;
  since: number | null;
  until: number | null;
  page: number;
  pageSize: number;
}): Promise<AuditLogResponse> {
  const params = new URLSearchParams();
  if (filters.actor) params.set("actor", filters.actor);
  if (filters.action) params.set("action", filters.action);
  if (filters.since !== null) params.set("since", String(filters.since));
  if (filters.until !== null) params.set("until", String(filters.until));
  params.set("page", String(filters.page));
  params.set("limit", String(filters.pageSize));

  const res = await fetch(`/api/audit-log?${params.toString()}`);
  if (!res.ok) throw new Error(`Request failed with status ${res.status}`);
  const json = (await res.json()) as {
    data?: AuditEntry[];
    meta?: { total?: number; page?: number; limit?: number };
  };
  return {
    entries: json.data ?? [],
    total: json.meta?.total ?? 0,
    page: json.meta?.page ?? filters.page,
    limit: json.meta?.limit ?? filters.pageSize,
  };
}

export default function AuditLogPage() {
  usePageTitle(PAGE_TITLES.AUDIT_LOG);
  const [filter, setFilter] = useState("");
  const [connected, setConnected] = useState(false);
  const [liveMode, setLiveMode] = useState(false);
  const [connected, setConnected] = useState(false);
  const [liveEntries, setLiveEntries] = useState<AuditEntry[]>([]);
  const sseRef = useRef<EventSource | null>(null);

  // Close the EventSource when the page unmounts — otherwise the stream keeps
  // polling and the connection leaks until the tab is closed.
  useEffect(() => {
    return () => {
      sseRef.current?.close();
    };
  }, []);

  const connectSSE = useCallback(() => {
    if (sseRef.current) sseRef.current.close();
    const es = new EventSource("/api/audit-log/sse");
    sseRef.current = es;
    es.addEventListener("connected", () => setConnected(true));
    es.addEventListener("audit:entry", (e) => {
      try {
        const data = JSON.parse(e.data) as AuditEntry;
        setLiveEntries((prev) => [data, ...prev].slice(0, 100));
      } catch {}
    });
    es.onerror = () => setConnected(false);
    return es;
  }, []);

  const toggleLive = () => {
    if (!liveMode) {
      connectSSE();
      setLiveMode(true);
    } else {
      sseRef.current?.close();
      setConnected(false);
      setLiveMode(false);
      setLiveEntries([]);
    }
  };

  // ── Data fetch keyed on filters + pagination ──
  const {
    data,
    isLoading: loading,
    error,
    refetch,
  } = useApiQuery<AuditLogResponse>(
    [
      "audit-log",
      JSON.stringify({ actor, action, since, until, page, pageSize }),
    ],
    undefined,
    { refetchOnWindowFocus: false },
    () => fetchAuditLog({ actor, action, since, until, page, pageSize })
  );

  const entries = useMemo(() => data?.entries ?? [], [data]);
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const currentPage = Math.min(page, totalPages);
  const hasFilters = Boolean(actor || action || since !== null || until !== null);

  // Live entries must satisfy the same predicate the API applies, so the
  // real-time tail matches the filtered view.
  const matchesFilters = useCallback(
    (e: AuditEntry) => {
      if (actor && !e.actor.toLowerCase().includes(actor.toLowerCase())) return false;
      if (action && e.action !== action) return false;
      if (since !== null && e.timestamp < since) return false;
      if (until !== null && e.timestamp > until) return false;
      return true;
    },
    [actor, action, since, until]
  );

  const visibleLive = useMemo(
    () => liveEntries.filter(matchesFilters).slice(0, pageSize),
    [liveEntries, matchesFilters, pageSize]
  );

  // Prepend matching live entries (deduped by id against the fetched page).
  const merged = useMemo(() => {
    const seen = new Set<number>();
    const out: AuditEntry[] = [];
    for (const e of [...visibleLive, ...entries]) {
      if (seen.has(e.id)) continue;
      seen.add(e.id);
      out.push(e);
    }
    return out;
  }, [visibleLive, entries]);

  const goToPage = (target: number) =>
    updateQuery({ page: target <= 1 ? null : String(target) });

  const changePageSize = (size: number) =>
    updateQuery({
      pageSize: size === DEFAULT_PAGE_SIZE ? null : String(size),
      page: null,
    });

  const formatTime = (ts: number) => new Date(ts * 1000).toLocaleString();

  const rangeStart = total > 0 ? (currentPage - 1) * pageSize + 1 : 0;
  const rangeEnd = Math.min((currentPage - 1) * pageSize + entries.length, total);

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

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
            📋 Audit Log
          </h1>
          <p className="text-gray-500 dark:text-gray-400 mt-1">
            Immutable on-chain trail of every contract state change
          </p>
        </div>
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
      </div>

      {/* Filters — persisted to URL params so views are shareable */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <label
            htmlFor="audit-actor"
            className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1"
          >
            Actor
          </label>
          <input
            id="audit-actor"
            type="text"
            value={actorDraft}
            onChange={(e) => setActorDraft(e.target.value)}
            placeholder="Filter by actor address..."
            className="w-full px-3 py-2 border rounded-lg dark:bg-gray-800 dark:border-gray-700 text-sm"
          />
        </div>
        <div>
          <label
            htmlFor="audit-action"
            className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1"
          >
            Action type
          </label>
          <select
            id="audit-action"
            value={action}
            onChange={(e) =>
              updateQuery({ action: e.target.value || null, page: null })
            }
            className="w-full px-3 py-2 border rounded-lg dark:bg-gray-800 dark:border-gray-700 text-sm"
          >
            <option value="">All actions</option>
            {Object.keys(ACTION_COLORS).map((a) => (
              <option key={a} value={a}>
                {a.replace(/_/g, " ")}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label
            htmlFor="audit-from"
            className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1"
          >
            From
          </label>
          <input
            id="audit-from"
            type="date"
            value={toDateInputValue(since)}
            onChange={(e) =>
              updateQuery({
                since: e.target.value
                  ? String(dateToStartOfDay(e.target.value))
                  : null,
                page: null,
              })
            }
            className="w-full px-3 py-2 border rounded-lg dark:bg-gray-800 dark:border-gray-700 text-sm"
          />
        </div>
        <div>
          <label
            htmlFor="audit-to"
            className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1"
          >
            To
          </label>
          <input
            id="audit-to"
            type="date"
            value={toDateInputValue(until)}
            onChange={(e) =>
              updateQuery({
                until: e.target.value
                  ? String(dateToEndOfDay(e.target.value))
                  : null,
                page: null,
              })
            }
            className="w-full px-3 py-2 border rounded-lg dark:bg-gray-800 dark:border-gray-700 text-sm"
          />
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="p-4 rounded-xl border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/30">
          <p className="text-sm text-red-700 dark:text-red-400">
            Failed to load the audit log: {error.message}
          </p>
          <button
            onClick={() => refetch()}
            className="mt-2 text-sm text-red-600 dark:text-red-400 underline hover:no-underline"
          >
            Try again
          </button>
        </div>
      )}

      {/* Entries */}
      {merged.length === 0 ? (
        <EmptyState
          icon={
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-8 h-8 text-gray-400">
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
            </svg>
          }
          title={hasFilters ? "No Matching Entries" : "No Audit Entries"}
          description={
            hasFilters
              ? "Try adjusting the actor, action, or date range filters."
              : "Contract activity will appear here as state changes occur."
          }
        />
      ) : (
        <div className="space-y-2">
          {merged.map((entry) => (
            <Card key={entry.id} className="p-3 flex items-center gap-3 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors">
              <Badge variant={ACTION_COLORS[entry.action] ?? "info"}>
                {entry.action.replace(/_/g, " ")}
              </Badge>
              <div className="flex-1 min-w-0">
                <p className="text-sm text-gray-700 dark:text-gray-300 truncate">{entry.details}</p>
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

      {/* Footer: count + pagination */}
      {total > 0 && (
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
          <p className="text-xs text-gray-400 text-center sm:text-left">
            Showing {rangeStart}–{rangeEnd} of {total} entries
            {hasFilters ? " (filtered)" : ""}
            {liveMode && visibleLive.length > 0 ? ` · ${visibleLive.length} live` : ""}
          </p>
          <div className="flex items-center gap-3">
            <select
              aria-label="Page size"
              value={pageSize}
              onChange={(e) => changePageSize(Number(e.target.value))}
              className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-2 py-1 text-sm text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-2 focus:ring-ophir-500"
            >
              {PAGE_SIZES.map((size) => (
                <option key={size} value={size}>
                  {size} / page
                </option>
              ))}
            </select>
            <Pagination
              page={currentPage}
              totalPages={totalPages}
              hasNext={currentPage < totalPages}
              hasPrev={currentPage > 1}
              onNext={() => goToPage(currentPage + 1)}
              onPrev={() => goToPage(currentPage - 1)}
              onPage={goToPage}
            />
          </div>
        </div>
      )}
    </div>
  );
}
