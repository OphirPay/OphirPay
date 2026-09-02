// SPDX-License-Identifier: MIT

import { nativeToScVal } from "@stellar/stellar-sdk";
import { withApiAuth } from "@/lib/api-auth";
import { successResponse, handleApiError, validationError } from "@/lib/api-response";
import prisma from "@/lib/prisma";
import { withRequestLogging } from "@/lib/request-logging";
import {
  auditLogQuerySchema,
  toAuditLogFilters,
  iterateAuditLogEntries,
  type AuditLogEntry,
} from "@/lib/audit-log";
import { z } from "zod";

const auditLogQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
  actor: z.string().trim().min(1).optional(),
  action: z.string().trim().min(1).optional(),
  // Unix timestamps (seconds) — inclusive range bounds on entry.timestamp
  since: z.coerce.number().int().positive().optional(),
  source: z.enum(["contract", "db", "all"]).optional().default("contract"),
});

export type AuditLogEntry = {
  id: number;
  timestamp: number;
  action: string;
  actor: string;
  target_id: number;
  details: string;
};
export type { AuditLogEntry };

/** Read a page of audit entries, most recent first, in parallel batches of 10. */
async function readAuditEntries(
  ids: number[]
): Promise<AuditLogEntry[]> {
  const entries: AuditLogEntry[] = [];
  for (let i = 0; i < ids.length; i += 10) {
    const chunk = ids.slice(i, i + 10);
    const results = await Promise.all(
      chunk.map(async (id) => {
        try {
          const entryResult = await simulateContractCall(
            DEFAULT_CONTRACT_ID,
            "get_audit_entry",
            CHAIN_READ_SOURCE,
            [nativeToScVal(id, { type: "u64" })]
          );
          if (entryResult.status === "SIMULATION_FAILED" || !entryResult.returnValue) {
            return null;
          }
          return entryResult.returnValue as AuditLogEntry;
        } catch {
          // Skip entries we can't read
          return null;
        }
      })
    );
    for (const entry of results) {
      if (entry) entries.push(entry);
    }
  }
  return entries;
}

/**
 * GET /api/audit-log
 *
 * Returns contract audit log entries. Requires API-key authentication.
 * Queries the OphirPayContract's persistent audit ledger on-chain.
 *
 * Supports pagination plus filtering by actor (substring, case-insensitive),
 * action (exact), and a since/until timestamp range — filters compose with
 * pagination, so `total` reflects the filtered result set.
 * Returns contract audit log entries. Requires API-key authentication with the
 * `admin` scope. Supports offset pagination (`page` / `limit`) and combined
 * filters: `actor`, `action`, `resource` (matches `target_id`), a `since` /
 * `until` date range (Unix seconds or ISO 8601), and `order` (asc | desc).
 * Returns audit log entries. Requires API-key authentication with the `admin`
 * scope.
 *
 * `source` selects the backing store:
 *   - `db`       → persisted audit entries (refund lifecycle history, issue
 *                  #365), queryable by action/target;
 *   - `contract` → the on-chain immutable audit ledger, filtered server-side
 *                  with offset pagination (`page` / `limit`) and the combined
 *                  filters `actor`, `action`, `resource`, `since`, `until`,
 *                  `order`;
 *   - `all`      → DB entries plus matching on-chain entries.
 *
 * For the on-chain sources, filtering is applied across the full ledger, so
 * `meta.total` reflects the filtered set, not the raw contract count.
 */
async function _GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    // Blank query params are treated as absent (Zod .optional() only applies
    // to undefined).
    const param = (name: string): string | undefined => {
      const v = searchParams.get(name);
      return v == null || v.trim() === "" ? undefined : v;
    };

    const parsed = auditLogQuerySchema.safeParse({
      page: param("page"),
      limit: param("limit"),
      actor: param("actor"),
      action: param("action"),
      resource: param("resource"),
      since: param("since"),
      until: param("until"),
      order: param("order"),
      source: param("source"),
    });
    if (!parsed.success) return validationError(parsed.error);

    const { page, limit, source } = parsed.data;
    const filters = toAuditLogFilters(parsed.data);

    // Persisted (DB) audit entries — refund lifecycle history with record
    // ids, queryable by action/target (issue #365).
    const dbEntries =
      source === "db" || source === "all"
        ? await prisma.auditLog.findMany({
            orderBy: { createdAt: "desc" },
            skip: (page - 1) * limit,
            take: limit,
            where: {
              ...(filters.action ? { action: filters.action } : {}),
              ...(filters.actor ? { actor: filters.actor } : {}),
              ...(filters.resource != null
                ? { target: String(filters.resource) }
                : {}),
            },
          })
        : [];

    if (source === "db") {
      return successResponse(
        dbEntries.map((e) => ({
          id: e.id,
          timestamp: new Date(e.createdAt).getTime(),
          action: e.action,
          actor: e.actor ?? "",
          target_id: e.target ?? "",
          details:
            typeof e.details === "string"
              ? e.details
              : e.details != null
                ? JSON.stringify(e.details)
                : null,
        })),
        { page, limit, total: dbEntries.length }
      );
    }

    const parsed = auditLogQuerySchema.safeParse({
      page: param("page"),
      limit: param("limit"),
      actor: param("actor"),
      action: param("action"),
      resource: param("resource"),
      since: param("since"),
      until: param("until"),
      order: param("order"),
    });
    if (!parsed.success) return validationError(parsed.error);

    if (countResult.status === "SIMULATION_FAILED") {
      return successResponse(dbEntries, {
        page,
        limit,
        total: 0,

      });
    }

    const totalCount = Number(countResult.returnValue ?? 0);
    if (totalCount === 0) {
      return successResponse(dbEntries, { page, limit, total: 0 });
    }

    // Which entries to read (ids are 1-indexed, most recent = highest id):
    // - No filters: only the page window, so unfiltered reads stay cheap.
    // - Filters: scan the whole ledger so the filtered `total` (and therefore
    //   pagination) is exact regardless of where matches fall.
    const ids: number[] = [];
    if (hasFilters) {
      for (let id = totalCount; id >= 1; id--) ids.push(id);
    } else {
      const startId = Math.max(1, totalCount - (page - 1) * limit);
      const endId = Math.max(1, startId - limit + 1);
      for (let id = startId; id >= endId; id--) ids.push(id);
    // Fetch entries from the contract (most recent first, capped at limit)
    const entries: AuditLogEntry[] = [];
    const startId = Math.max(1, totalCount - (page - 1) * limit);
    const endId = Math.max(1, startId - limit + 1);

    // Collect the filtered set (bounded by the on-chain ledger) to compute the
    // total for offset pagination.
    // On-chain entries: collect the filtered set (bounded by the ledger) to
    // compute the total for offset pagination, then slice the requested page.
    const all: AuditLogEntry[] = [];
    for await (const entry of iterateAuditLogEntries(filters)) {
      all.push(entry);
    }
    // DB rows are newest-first too, so for `all` the on-chain slice mirrors it.
    const start = (page - 1) * limit;
    const items = all.slice(start, start + limit);
    const combined =
      source === "all"
        ? [
            ...items.map((e) => ({
              id: e.id,
              timestamp: e.timestamp,
              action: e.action,
              actor: e.actor,
              target_id: e.target_id,
              details: e.details,
            })),
            ...dbEntries.map((e) => ({
              id: e.id,
              timestamp: new Date(e.createdAt).getTime(),
              action: e.action,
              actor: e.actor ?? "",
              target_id: e.target ?? "",
              details:
                typeof e.details === "string"
                  ? e.details
                  : e.details != null
                    ? JSON.stringify(e.details)
                    : null,
            })),
          ]
        : items;

    const entries = await readAuditEntries(ids);

    // Apply filters (mirrors the UI's client-side live-entry predicate):
    // actor substring (case-insensitive), action exact match, inclusive
    // since/until timestamp range.
    const actorQuery = actor?.toLowerCase();
    const filtered = entries.filter((e) => {
      if (actorQuery && !(e.actor ?? "").toLowerCase().includes(actorQuery)) {
        return false;
      }
      if (action && e.action !== action) return false;
      if (since !== undefined && e.timestamp < since) return false;
      if (until !== undefined && e.timestamp > until) return false;
      return true;
    });

    const start = (page - 1) * limit;
    const paged = filtered.slice(start, start + limit);

    return successResponse(entries, {
    return successResponse(combined, {
      page,
      limit,
      total: source === "all" ? all.length + dbEntries.length : all.length,
    });
  } catch (error) {
    return handleApiError(error);
  }
}

export const GET = withRequestLogging(withApiAuth(_GET, "admin"));