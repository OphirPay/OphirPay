// SPDX-License-Identifier: MIT

// Client-side filtering for the Audit Log page. Server-side filtering and
// CSV export live in /api/audit-log and /api/audit-log/export; the free-text
// search stays client-side because the audit API has no text-search param.

export interface AuditEntry {
  id: number;
  timestamp: number; // unix seconds
  action: string;
  actor: string;
  target_id: number;
  details: string;
}

export interface AuditFilters {
  text: string; // matches action or details (case-insensitive)
  action: string; // exact action match, "" = any
  from?: string; // ISO datetime-local string, "" = unbounded
  to?: string; // ISO datetime-local string, "" = unbounded
}

export function distinctActions(entries: AuditEntry[]): string[] {
  return [...new Set(entries.map((e) => e.action))].sort();
}

export function filterEntries(entries: AuditEntry[], f: AuditFilters): AuditEntry[] {
  const text = f.text.trim().toLowerCase();
  const from = f.from ? new Date(f.from).getTime() / 1000 : null;
  const to = f.to ? new Date(f.to).getTime() / 1000 : null;
  return entries.filter((e) => {
    if (f.action && e.action !== f.action) return false;
    if (from !== null && e.timestamp < from) return false;
    if (to !== null && e.timestamp > to) return false;
    if (
      text &&
      !e.action.toLowerCase().includes(text) &&
      !e.details.toLowerCase().includes(text)
    ) {
      return false;
    }
    return true;
  });
}

/// Build the query string for GET /api/audit-log/export from the current UI
/// filters. Only forwards the params the server schema understands
/// (action / since / until); free-text stays a client-side concern.
export function serverExportParams(f: AuditFilters): URLSearchParams {
  const p = new URLSearchParams();
  if (f.action) p.set("action", f.action);
  if (f.from) p.set("since", new Date(f.from).toISOString());
  if (f.to) p.set("until", new Date(f.to).toISOString());
  return p;
}
