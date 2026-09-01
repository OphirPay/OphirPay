"use client";
import { useState, useMemo, useEffect, useCallback, useRef } from "react";
import { useApiQuery } from "@/hooks/useApiQuery";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { usePageTitle, PAGE_TITLES } from "@/hooks/usePageTitle";

interface AuditEntry {
  id: number;
  timestamp: number;
  action: string;
  actor: string;
  target_id: number;
  details: string;
}

const ACTION_COLORS: Record<string, "info" | "success" | "warning" | "danger" | "default"> = {
  payment_sent: "success",
  payment_received: "success",
  batch_executed: "info",
  refund_issued: "warning",
  contract_upgraded: "danger",
  timelock_created: "info",
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

  const [page, setPage] = useState(1);
  const [actorFilter, setActorFilter] = useState("");
  const [actionFilter, setActionFilter] = useState("");
  const [dateSince, setDateSince] = useState("");
  const [dateUntil, setDateUntil] = useState("");

  const limit = 20;

  // Build query params
  const queryParams = new URLSearchParams({
    page: page.toString(),
    limit: limit.toString(),
  });
  if (actorFilter) queryParams.set("actor", actorFilter);
  if (actionFilter) queryParams.set("action", actionFilter);
  if (dateSince) queryParams.set("since", Math.floor(new Date(dateSince).getTime() / 1000).toString());
  if (dateUntil) queryParams.set("until", Math.floor(new Date(dateUntil).getTime() / 1000).toString());

  const { data: rawData, isLoading } = useApiQuery<any>(
    ["audit-log", page.toString(), actorFilter, actionFilter, dateSince, dateUntil],
    `/api/audit-log?${queryParams.toString()}`
  );

  const entries: AuditEntry[] = rawData?.data || rawData || [];
  const total = rawData?.meta?.total || 0;
  const hasMore = page * limit < total;

  const handleExportCSV = async () => {
    // Export honors the active filters
    const exportParams = new URLSearchParams(queryParams);
    exportParams.delete("page");
    exportParams.set("limit", "1000"); // Fetch a lot for CSV
    
    try {
      const res = await fetch(`/api/audit-log?${exportParams.toString()}`);
      const json = await res.json();
      const exportData: AuditEntry[] = json.data || [];
      
      if (exportData.length === 0) return;
      
      const headers = ["ID", "Timestamp", "Date", "Action", "Actor", "Target ID", "Details"];
      const csvRows = [headers.join(",")];
      
      for (const row of exportData) {
        const d = new Date(row.timestamp * 1000).toLocaleString().replace(/,/g, "");
        const escapedDetails = row.details ? `"${row.details.replace(/"/g, '""')}"` : "";
        csvRows.push(`${row.id},${row.timestamp},${d},${row.action},${row.actor},${row.target_id},${escapedDetails}`);
      }
      
      const blob = new Blob([csvRows.join("\\n")], { type: "text/csv" });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.setAttribute("href", url);
      a.setAttribute("download", "audit_log.csv");
      a.click();
    } catch (e) {
      console.error("Export failed", e);
    }
  };

  const formatTime = (ts: number) => new Date(ts * 1000).toLocaleString();

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">📋 Audit Log</h1>
          <p className="text-gray-500 dark:text-gray-400 mt-1">Immutable on-chain trail of every contract state change</p>
        </div>
        <Button onClick={handleExportCSV} variant="secondary">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4 mr-2"><path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" /></svg>
          Export CSV
        </Button>
      </div>

      <div className="flex flex-wrap gap-4 items-end bg-white dark:bg-gray-900 p-4 rounded-xl border border-gray-200 dark:border-gray-800">
        <label className="text-sm">
          <span className="block text-gray-500 mb-1">Actor</span>
          <input type="text" value={actorFilter} onChange={(e) => { setActorFilter(e.target.value); setPage(1); }} placeholder="Address..." className="border p-2 rounded dark:bg-gray-800 dark:border-gray-700" />
        </label>
        <label className="text-sm">
          <span className="block text-gray-500 mb-1">Action</span>
          <input type="text" value={actionFilter} onChange={(e) => { setActionFilter(e.target.value); setPage(1); }} placeholder="Action..." className="border p-2 rounded dark:bg-gray-800 dark:border-gray-700" />
        </label>
        <label className="text-sm">
          <span className="block text-gray-500 mb-1">Since</span>
          <input type="date" value={dateSince} onChange={(e) => { setDateSince(e.target.value); setPage(1); }} className="border p-2 rounded dark:bg-gray-800 dark:border-gray-700" />
        </label>
        <label className="text-sm">
          <span className="block text-gray-500 mb-1">Until</span>
          <input type="date" value={dateUntil} onChange={(e) => { setDateUntil(e.target.value); setPage(1); }} className="border p-2 rounded dark:bg-gray-800 dark:border-gray-700" />
        </label>
        <Button onClick={() => { setActorFilter(""); setActionFilter(""); setDateSince(""); setDateUntil(""); setPage(1); }} variant="outline">Clear</Button>
      </div>

      {isLoading ? (
        <div className="space-y-4">
          {[1, 2, 3].map((i) => <div key={i} className="h-16 bg-gray-100 dark:bg-gray-800 animate-pulse rounded" />)}
        </div>
      ) : entries.length === 0 ? (
        <EmptyState title="No Audit Entries" description="No matching events found." />
      ) : (
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-gray-50 dark:bg-gray-800/50 border-b border-gray-200 dark:border-gray-700 text-xs text-gray-500 uppercase tracking-wider">
                  <th className="p-4 font-medium">Action</th>
                  <th className="p-4 font-medium">Actor</th>
                  <th className="p-4 font-medium">Details</th>
                  <th className="p-4 font-medium">Time</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-800">
                {entries.map(entry => (
                  <tr key={entry.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/50">
                    <td className="p-4"><Badge variant={ACTION_COLORS[entry.action] ?? "default"}>{entry.action}</Badge></td>
                    <td className="p-4 font-mono text-xs">{entry.actor}</td>
                    <td className="p-4 text-sm">{entry.details}</td>
                    <td className="p-4 text-sm whitespace-nowrap text-gray-500">{formatTime(entry.timestamp)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="p-4 border-t border-gray-200 dark:border-gray-700 flex justify-between items-center text-sm">
            <span>Showing {entries.length} {total ? `of ${total}` : ""} entries</span>
            <div className="flex gap-2">
              <Button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} size="sm" variant="outline">Previous</Button>
              <Button onClick={() => setPage(p => p + 1)} disabled={!hasMore} size="sm" variant="outline">Next</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
