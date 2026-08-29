"use client";
// SPDX-License-Identifier: MIT

import { useState, useCallback, useEffect, useMemo, useRef, Suspense } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { usePageTitle } from "@/hooks/usePageTitle";
import { PAGE_TITLES } from "@/lib/page-titles";
import { Breadcrumb } from "@/components/Breadcrumb";
import { EmptyState } from "@/components/EmptyState";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { CopyButton } from "@/components/ui/CopyButton";
import { Pagination } from "@/components/ui/Pagination";
import { LoadingSkeleton } from "@/components/LoadingSkeleton";
import { useApiQuery } from "@/hooks/useApiQuery";
import { shortenAddress } from "@/lib/utils";

export interface AuditEntry {
  id: number;
  timestamp: number;
  action: string;
  actor: string;
  target_id: number;
  details: string;
}

export const ACTION_COLORS: Record<string, "success" | "danger" | "warning" | "info"> = {
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

export const ALL_ACTIONS = Object.keys(ACTION_COLORS).sort();

const ALLOWED_PAGE_SIZES = [5, 10, 20, 50, 100] as const;
const DEFAULT_PAGE_SIZE = 20;

export default function AuditLogPage() {
  usePageTitle(PAGE_TITLES.AUDIT_LOG);

  return (
    <Suspense fallback={<AuditLogFallback />}>
      <AuditLogClient />
    </Suspense>
  );
}

function AuditLogFallback() {
  return (
    <div className="space-y-6 animate-fade-in">
      <Breadcrumb items={[{ label: "Audit Log" }]} />
      <LoadingSkeleton variant="table" lines={5} />
    </div>
  );
}

function parseDateBoundary(dateStr: string, boundary: "start" | "end"): number | null {
  if (!dateStr) return null;
  const num = Number(dateStr);
  if (!isNaN(num) && num > 0) {
    return num > 1e11 ? Math.floor(num / 1000) : num;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    const timeStr = boundary === "start" ? "T00:00:00.000Z" : "T23:59:59.999Z";
    const ts = Date.parse(`${dateStr}${timeStr}`);
    return isNaN(ts) ? null : Math.floor(ts / 1000);
  }
  const parsed = Date.parse(dateStr);
  return isNaN(parsed) ? null : Math.floor(parsed / 1000);
}

function AuditLogClient() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  // Read URL search params
  const actorParam = searchParams.get("actor") ?? "";
  const actionParam = searchParams.get("action") ?? "";
  const dateFromParam = searchParams.get("dateFrom") ?? searchParams.get("from") ?? "";
  const dateToParam = searchParams.get("dateTo") ?? searchParams.get("to") ?? "";
  const searchParam = searchParams.get("search") ?? "";

  const pageParam = parseInt(searchParams.get("page") ?? "", 10);
  const page = Number.isFinite(pageParam) && pageParam >= 1 ? pageParam : 1;

  const pageSizeParam = parseInt(searchParams.get("pageSize") ?? "", 10);
  const pageSize = (ALLOWED_PAGE_SIZES as readonly number[]).includes(pageSizeParam)
    ? pageSizeParam
    : DEFAULT_PAGE_SIZE;

  // Local inputs synced with URL
  const [actorInput, setActorInput] = useState(actorParam);
  const [actionInput, setActionInput] = useState(actionParam);
  const [dateFromInput, setDateFromInput] = useState(dateFromParam);
  const [dateToInput, setDateToInput] = useState(dateToParam);
  const [searchInput, setSearchInput] = useState(searchParam);

  useEffect(() => {
    setActorInput(actorParam);
  }, [actorParam]);

  useEffect(() => {
    setActionInput(actionParam);
  }, [actionParam]);

  useEffect(() => {
    setDateFromInput(dateFromParam);
  }, [dateFromParam]);

  useEffect(() => {
    setDateToInput(dateToParam);
  }, [dateToParam]);

  useEffect(() => {
    setSearchInput(searchParam);
  }, [searchParam]);

  const [connected, setConnected] = useState(false);
  const [liveMode, setLiveMode] = useState(false);
  const [liveEntries, setLiveEntries] = useState<AuditEntry[]>([]);
  const sseRef = useRef<EventSource | null>(null);

  const {
    data: rawEntries,
    isLoading: loading,
    error: fetchError,
    refetch: refetchEntries,
  } = useApiQuery<AuditEntry[]>(["audit-log"], "/api/audit-log");

  // Close SSE connection on unmount
  useEffect(() => {
    return () => {
      sseRef.current?.close();
    };
  }, []);

  // Merge live SSE entries with fetched entries (deduped by id)
  const entries = useMemo(() => {
    const fetchedEntries = Array.isArray(rawEntries) ? rawEntries : [];
    const seen = new Set<number>();
    const merged: AuditEntry[] = [];
    for (const e of [...liveEntries, ...fetchedEntries]) {
      if (!e || typeof e.id !== "number") continue;
      if (seen.has(e.id)) continue;
      seen.add(e.id);
      merged.push(e);
    }
    return merged.sort((a, b) => b.timestamp - a.timestamp || b.id - a.id);
  }, [liveEntries, rawEntries]);

  // SSE live streaming
  const connectSSE = useCallback(() => {
    if (sseRef.current) sseRef.current.close();
    const es = new EventSource("/api/audit-log/sse");
    sseRef.current = es;
    es.addEventListener("connected", () => setConnected(true));
    es.addEventListener("audit:entry", (e) => {
      try {
        const data = JSON.parse(e.data);
        setLiveEntries((prev) => [data, ...prev].slice(0, 200));
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

  // Helper to update URL params
  const updateQuery = useCallback(
    (updates: Record<string, string | null>) => {
      const params = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(updates)) {
        if (value === null || value === "" || (key === "page" && value === "1")) {
          params.delete(key);
        } else {
          params.set(key, value);
        }
      }
      const query = params.toString();
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    },
    [pathname, router, searchParams]
  );

  const handleActorChange = (value: string) => {
    setActorInput(value);
    updateQuery({ actor: value || null, page: null });
  };

  const handleActionChange = (value: string) => {
    setActionInput(value);
    updateQuery({ action: value || null, page: null });
  };

  const handleDateFromChange = (value: string) => {
    setDateFromInput(value);
    updateQuery({ dateFrom: value || null, from: null, page: null });
  };

  const handleDateToChange = (value: string) => {
    setDateToInput(value);
    updateQuery({ dateTo: value || null, to: null, page: null });
  };

  const handleSearchChange = (value: string) => {
    setSearchInput(value);
    updateQuery({ search: value || null, page: null });
  };

  const handleClearFilters = () => {
    setActorInput("");
    setActionInput("");
    setDateFromInput("");
    setDateToInput("");
    setSearchInput("");
    updateQuery({
      actor: null,
      action: null,
      dateFrom: null,
      dateTo: null,
      from: null,
      to: null,
      search: null,
      page: null,
    });
  };

  const goToPage = (target: number) => {
    updateQuery({ page: target <= 1 ? null : String(target) });
  };

  const changePageSize = (size: number) => {
    updateQuery({
      pageSize: size === DEFAULT_PAGE_SIZE ? null : String(size),
      page: null,
    });
  };

  // Filtered dataset
  const filtered = useMemo(() => {
    const fromTs = parseDateBoundary(dateFromParam, "start");
    const toTs = parseDateBoundary(dateToParam, "end");
    const qActor = actorParam.trim().toLowerCase();
    const qAction = actionParam.trim().toLowerCase();
    const qSearch = searchParam.trim().toLowerCase();

    return entries.filter((entry) => {
      const entryTs = entry.timestamp > 1e11 ? Math.floor(entry.timestamp / 1000) : entry.timestamp;

      if (qActor && !entry.actor?.toLowerCase().includes(qActor)) {
        return false;
      }

      if (qAction && entry.action?.toLowerCase() !== qAction && !entry.action?.toLowerCase().includes(qAction)) {
        return false;
      }

      if (fromTs !== null && entryTs < fromTs) {
        return false;
      }

      if (toTs !== null && entryTs > toTs) {
        return false;
      }

      if (qSearch) {
        const matchesDetails = entry.details?.toLowerCase().includes(qSearch);
        const matchesActor = entry.actor?.toLowerCase().includes(qSearch);
        const matchesAction = entry.action?.toLowerCase().includes(qSearch);
        const matchesId = String(entry.id).includes(qSearch) || String(entry.target_id).includes(qSearch);
        if (!matchesDetails && !matchesActor && !matchesAction && !matchesId) {
          return false;
        }
      }

      return true;
    });
  }, [entries, actorParam, actionParam, dateFromParam, dateToParam, searchParam]);

  // Pagination calculation
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(Math.max(1, page), totalPages);
  const startIndex = (currentPage - 1) * pageSize;
  const paginated = filtered.slice(startIndex, startIndex + pageSize);

  const hasActiveFilters = Boolean(
    actorParam || actionParam || dateFromParam || dateToParam || searchParam
  );

  const formatTime = (ts: number) => {
    const ms = ts > 1e11 ? ts : ts * 1000;
    const d = new Date(ms);
    return isNaN(d.getTime()) ? "—" : d.toLocaleString();
  };

  if (loading) {
    return (
      <div className="space-y-6 animate-fade-in">
        <Breadcrumb items={[{ label: "Audit Log" }]} />
        <div className="h-8 w-48 bg-gray-200 dark:bg-gray-700 rounded animate-pulse" />
        <LoadingSkeleton variant="table" lines={5} />
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Breadcrumb */}
      <Breadcrumb items={[{ label: "Audit Log" }]} />

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
        <div className="flex gap-2 items-center flex-wrap">
          <Button
            size="sm"
            variant="secondary"
            onClick={() => refetchEntries()}
            disabled={loading}
            data-testid="refresh-audit-log-btn"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={1.5}
              stroke="currentColor"
              className={`w-4 h-4 mr-1.5 ${loading ? "animate-spin" : ""}`}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182M2.985 19.644l3.181-3.182"
              />
            </svg>
            Refresh
          </Button>
          <Button
            size="sm"
            variant={liveMode ? "primary" : "secondary"}
            onClick={toggleLive}
            data-testid="live-toggle-btn"
          >
            {liveMode ? (
              <span className="flex items-center gap-1.5">
                <span
                  className={`h-2 w-2 rounded-full ${
                    connected ? "bg-green-500" : "bg-red-500"
                  } animate-pulse`}
                />
                Live {connected ? "●" : "✕"}
              </span>
            ) : (
              "▶ Live"
            )}
          </Button>
        </div>
      </div>

      {/* Filter Controls Card */}
      <Card className="p-4 space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {/* Actor Filter */}
          <div>
            <label
              htmlFor="filter-actor"
              className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1"
            >
              Actor
            </label>
            <input
              id="filter-actor"
              type="text"
              value={actorInput}
              onChange={(e) => handleActorChange(e.target.value)}
              placeholder="Filter by Stellar address..."
              data-testid="filter-actor"
              className="w-full px-3 py-2 border rounded-lg dark:bg-gray-800 dark:border-gray-700 text-sm focus:outline-none focus:ring-2 focus:ring-ophir-500 dark:text-white"
            />
          </div>

          {/* Action Type Filter */}
          <div>
            <label
              htmlFor="filter-action"
              className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1"
            >
              Action Type
            </label>
            <select
              id="filter-action"
              value={actionInput}
              onChange={(e) => handleActionChange(e.target.value)}
              data-testid="filter-action"
              className="w-full px-3 py-2 border rounded-lg dark:bg-gray-800 dark:border-gray-700 text-sm focus:outline-none focus:ring-2 focus:ring-ophir-500 dark:text-white"
            >
              <option value="">All Actions</option>
              {ALL_ACTIONS.map((act) => (
                <option key={act} value={act}>
                  {act.replace(/_/g, " ")}
                </option>
              ))}
            </select>
          </div>

          {/* Date From Filter */}
          <div>
            <label
              htmlFor="filter-date-from"
              className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1"
            >
              Date From
            </label>
            <input
              id="filter-date-from"
              type="date"
              value={dateFromInput}
              onChange={(e) => handleDateFromChange(e.target.value)}
              data-testid="filter-date-from"
              className="w-full px-3 py-2 border rounded-lg dark:bg-gray-800 dark:border-gray-700 text-sm focus:outline-none focus:ring-2 focus:ring-ophir-500 dark:text-white"
            />
          </div>

          {/* Date To Filter */}
          <div>
            <label
              htmlFor="filter-date-to"
              className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1"
            >
              Date To
            </label>
            <input
              id="filter-date-to"
              type="date"
              value={dateToInput}
              onChange={(e) => handleDateToChange(e.target.value)}
              data-testid="filter-date-to"
              className="w-full px-3 py-2 border rounded-lg dark:bg-gray-800 dark:border-gray-700 text-sm focus:outline-none focus:ring-2 focus:ring-ophir-500 dark:text-white"
            />
          </div>
        </div>

        {/* Search & Reset Row */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 pt-1 border-t border-gray-100 dark:border-gray-800">
          <div className="relative flex-1 max-w-md">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={1.5}
              stroke="currentColor"
              className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z"
              />
            </svg>
            <input
              type="text"
              value={searchInput}
              onChange={(e) => handleSearchChange(e.target.value)}
              placeholder="Search details or ID..."
              data-testid="filter-search"
              className="w-full pl-9 pr-3 py-1.5 border rounded-lg dark:bg-gray-800 dark:border-gray-700 text-sm focus:outline-none focus:ring-2 focus:ring-ophir-500 dark:text-white placeholder-gray-400"
            />
          </div>

          <div className="flex items-center gap-2 self-end sm:self-auto">
            {hasActiveFilters && (
              <Button
                size="sm"
                variant="outline"
                onClick={handleClearFilters}
                data-testid="filter-clear"
              >
                Clear Filters
              </Button>
            )}
          </div>
        </div>
      </Card>

      {/* Record count summary badge */}
      <div className="flex items-center gap-2">
        <span data-testid="total-count-badge" className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 text-xs font-medium text-blue-700 dark:text-blue-400">
          <span className="h-1.5 w-1.5 rounded-full bg-blue-500" />
          {entries.length} total on-chain {entries.length === 1 ? "entry" : "entries"}
        </span>
        {hasActiveFilters && (
          <span data-testid="filtered-count-badge" className="text-xs text-gray-400 dark:text-gray-500">
            filtered: {filtered.length} of {entries.length}
          </span>
        )}
      </div>

      {/* Error state */}
      {fetchError && (
        <div className="p-4 rounded-xl border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/30">
          <p className="text-sm text-red-700 dark:text-red-400">
            Failed to load audit entries: {fetchError.message}
          </p>
          <button
            onClick={() => refetchEntries()}
            className="mt-2 text-sm text-red-600 dark:text-red-400 underline hover:no-underline"
          >
            Try again
          </button>
        </div>
      )}

      {/* Entry List or Empty State */}
      {filtered.length === 0 ? (
        <EmptyState
          icon={
            <svg
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={1.5}
              stroke="currentColor"
              className="w-8 h-8 text-gray-400"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z"
              />
            </svg>
          }
          title={hasActiveFilters ? "No Matching Entries" : "No Audit Entries"}
          description={
            hasActiveFilters
              ? "No entries match your selected filter criteria. Try adjusting or clearing your filters."
              : "Contract activity will appear here as state changes occur."
          }
          actionLabel={hasActiveFilters ? "Clear all filters" : undefined}
          onAction={hasActiveFilters ? handleClearFilters : undefined}
        />
      ) : (
        <div className="space-y-2">
          {paginated.map((entry) => (
            <Card
              key={entry.id}
              className="p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors"
            >
              <div className="flex items-start sm:items-center gap-3 min-w-0">
                <Badge variant={ACTION_COLORS[entry.action] ?? "info"} className="shrink-0">
                  {entry.action.replace(/_/g, " ")}
                </Badge>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-gray-800 dark:text-gray-200 break-words">
                    {entry.details}
                  </p>
                  <div className="flex items-center gap-2 mt-0.5 text-xs text-gray-400">
                    <span>
                      Actor:{" "}
                      <span className="font-mono" title={entry.actor}>
                        {shortenAddress(entry.actor, 6)}
                      </span>
                    </span>
                    {entry.actor && <CopyButton value={entry.actor} label="Actor" />}
                    {entry.target_id > 0 && <span>· Target ID: #{entry.target_id}</span>}
                    <span>· Entry #{entry.id}</span>
                  </div>
                </div>
              </div>
              <span className="text-xs text-gray-400 whitespace-nowrap shrink-0 self-end sm:self-center">
                {formatTime(entry.timestamp)}
              </span>
            </Card>
          ))}
        </div>
      )}

      {/* Pagination Footer */}
      {filtered.length > 0 && (
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pt-2">
          <div className="flex items-center gap-3">
            <p data-testid="pagination-summary" className="text-xs sm:text-sm text-gray-500 dark:text-gray-400">
              Showing{" "}
              <span className="font-medium">
                {startIndex + 1}–{Math.min(startIndex + pageSize, filtered.length)}
              </span>{" "}
              of <span className="font-medium">{filtered.length}</span> entries
              {hasActiveFilters && ` (filtered from ${entries.length})`}
            </p>
            <select
              aria-label="Page size"
              value={pageSize}
              onChange={(e) => changePageSize(Number(e.target.value))}
              className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-2 py-1 text-xs sm:text-sm text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-2 focus:ring-ophir-500"
            >
              {ALLOWED_PAGE_SIZES.map((size) => (
                <option key={size} value={size}>
                  {size} / page
                </option>
              ))}
            </select>
          </div>

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
      )}
    </div>
  );
}
