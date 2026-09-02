// SPDX-License-Identifier: MIT

/**
 * Shared logic for the audit-log API:
 *   • GET /api/audit-log              — paginated, filterable list
 *   • GET /api/audit-log/export       — streaming CSV export of the same filters
 *
 * Audit entries live in the OphirPay contract's immutable, on-chain ledger as
 * sequentially-numbered records (`get_audit_log_count` / `get_audit_entry` ids
 * 1..N, newest = highest id). Because there is no on-chain query-by-filter,
 * filtering happens here: entries are read from the chain and tested against
 * the combined `AuditLogFilters`.
 *
 * Ordering is by id (= insertion order, which mirrors `timestamp`), newest
 * first by default. The iterator pulls ids lazily in chunks so the CSV export
 * can stream rows without ever materialising the full result set in memory.
 */

import { z } from "zod";
import { nativeToScVal } from "@stellar/stellar-sdk";
import {
  simulateContractCall,
  DEFAULT_CONTRACT_ID,
  CHAIN_READ_SOURCE,
} from "@/lib/contracts";

export interface AuditLogEntry {
  /** Sequentially-numbered on-chain entry id. */
  id: number;
  /** Unix timestamp (seconds). */
  timestamp: number;
  /** Action type, e.g. "payment_recorded", "escrow_created". */
  action: string;
  /** Stellar address of the actor. */
  actor: string;
  /** The affected entity id (payment, escrow, stream, …) — the "resource". */
  target_id: number;
  /** Human-readable summary. */
  details: string;
}

/** Combined filters applied to the audit log. */
export interface AuditLogFilters {
  /** Exact Stellar address match. */
  actor?: string;
  /** Exact action-type match. */
  action?: string;
  /** Matches `target_id` (the resource an entry acted on). */
  resource?: number;
  /** Inclusive lower bound, Unix seconds. */
  since?: number;
  /** Inclusive upper bound, Unix seconds. */
  until?: number;
  /** Result order. Defaults to `desc` (newest first). */
  order?: "asc" | "desc";
}

const AUDIT_ENTRY_BATCH_SIZE = 10;

// ── Query params ──────────────────────────────────────────────

/** Parse a `since`/`until` query value: bare integer → Unix seconds, else ISO 8601. */
export function parseAuditTimestamp(input: string): number | null {
  const t = input.trim();
  // Backward-compatible: a plain integer is treated as epoch *seconds*.
  if (/^\d{1,10}$/.test(t)) return Number(t);
  const ms = Date.parse(t);
  if (Number.isNaN(ms)) return null;
  return Math.floor(ms / 1000);
}

const yearSuffixCheck = z
  .string()
  .refine((v) => parseAuditTimestamp(v) !== null, {
    message: "Expected an ISO 8601 date or a Unix timestamp in seconds",
  });

/**
 * Shared validation for both the list and export endpoints so the export always
 * applies exactly what the list endpoint accepts.
 */
export const auditLogQuerySchema = z
  .object({
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    actor: z.string().trim().min(1).optional(),
    action: z.string().trim().min(1).optional(),
    resource: z.coerce.number().int().nonnegative().optional(),
    since: yearSuffixCheck.optional(),
    until: yearSuffixCheck.optional(),
    order: z.enum(["asc", "desc"]).default("desc"),
    // Backing store for GET /api/audit-log (issue #365): "db" serves the
    // persisted audit trail, "contract" the on-chain ledger, "all" both.
    source: z.enum(["contract", "db", "all"]).optional().default("contract"),
  })
  .superRefine((val, ctx) => {
    if (
      val.since != null &&
      val.until != null &&
      parseAuditTimestamp(val.since)! > parseAuditTimestamp(val.until)!
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["until"],
        message: "until must be greater than or equal to since",
      });
    }
  });

export type AuditLogQuery = z.infer<typeof auditLogQuerySchema>;

/** Convert validated query params into the numeric filters consumed by the reader. */
export function toAuditLogFilters(query: AuditLogQuery): AuditLogFilters {
  return {
    actor: query.actor || undefined,
    action: query.action || undefined,
    resource: query.resource,
    since: query.since != null ? parseAuditTimestamp(query.since)! : undefined,
    until: query.until != null ? parseAuditTimestamp(query.until)! : undefined,
    order: query.order ?? "desc",
  };
}

// ── Normalisation & filtering ──────────────────────────────────

/**
 * Normalise a raw contract return value into a plain `AuditLogEntry`.
 * u64/i128 fields come back as BigInt from `scValToNative`; entry ids and
 * timestamps are always within safe-integer range so they are converted to
 * numbers. Returns null for values that are not audit entries.
 */
export function normalizeAuditEntry(raw: unknown): AuditLogEntry | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const num = (v: unknown, fallback: number): number => {
    if (typeof v === "bigint") return Number(v);
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  };
  return {
    id: num(r.id, 0),
    timestamp: num(r.timestamp, 0),
    action: String(r.action ?? ""),
    actor: String(r.actor ?? ""),
    target_id: num(r.target_id, 0),
    details: String(r.details ?? ""),
  };
}

/** True when an entry satisfies every provided filter (AND semantics). */
export function matchesAuditFilters(
  entry: AuditLogEntry,
  filters: AuditLogFilters
): boolean {
  if (filters.actor && entry.actor !== filters.actor) return false;
  if (filters.action && entry.action !== filters.action) return false;
  if (filters.resource != null && entry.target_id !== filters.resource) {
    return false;
  }
  if (filters.since != null && entry.timestamp < filters.since) return false;
  if (filters.until != null && entry.timestamp > filters.until) return false;
  return true;
}

// ── On-chain reading ───────────────────────────────────────────

/** Read the current audit-log size from the contract; 0 on any failure. */
export async function readAuditLogTotalCount(): Promise<number> {
  let countResult;
  try {
    countResult = await simulateContractCall(
      DEFAULT_CONTRACT_ID,
      "get_audit_log_count",
      CHAIN_READ_SOURCE
    );
  } catch {
    return 0;
  }
  if (
    !countResult ||
    countResult.status === "SIMULATION_FAILED" ||
    !countResult.returnValue
  ) {
    return 0;
  }
  const n = Number(countResult.returnValue);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Read a single audit entry by id, or null if it can't be read. */
export async function readAuditEntryById(
  id: number
): Promise<AuditLogEntry | null> {
  try {
    const result = await simulateContractCall(
      DEFAULT_CONTRACT_ID,
      "get_audit_entry",
      CHAIN_READ_SOURCE,
      [nativeToScVal(id, { type: "u64" })]
    );
    if (result.status === "SIMULATION_FAILED" || !result.returnValue) {
      return null;
    }
    return normalizeAuditEntry(result.returnValue);
  } catch {
    return null;
  }
}

/**
 * Yield audit-log entries in id order (newest first unless `order: "asc"`),
 * lazily reading chunks from the chain and filtering as it goes. Memory stays
 * bounded by one batch — callers that stream (e.g. CSV export) never hold the
 * full result set in memory.
 */
export async function* iterateAuditLogEntries(
  filters: AuditLogFilters = {}
): AsyncGenerator<AuditLogEntry> {
  const count = await readAuditLogTotalCount();
  if (count === 0) return;

  const descending = filters.order !== "asc";
  const step = descending ? -1 : 1;
  const first = descending ? count : 1;
  const last = descending ? 1 : count;

  for (let offset = 0; offset < count; offset += AUDIT_ENTRY_BATCH_SIZE) {
    const batch: number[] = [];
    for (let i = 0; i < AUDIT_ENTRY_BATCH_SIZE; i++) {
      const id = first + step * (offset + i);
      if (descending ? id < last : id > last) break;
      batch.push(id);
    }
    // Promise.all preserves input order so the batch stays in id order.
    const entries = await Promise.all(batch.map((id) => readAuditEntryById(id)));
    for (const entry of entries) {
      if (entry && matchesAuditFilters(entry, filters)) yield entry;
    }
  }
}

// ── CSV export helpers ─────────────────────────────────────────

/** RFC 4180 escaping — a field is quoted only when it must be. */
export function escapeCsvField(value: unknown): string {
  const s = value == null ? "" : String(value);
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function auditEntryToCsvRow(entry: AuditLogEntry): string {
  return [
    entry.id,
    entry.timestamp,
    entry.action,
    entry.actor,
    entry.target_id,
    entry.details,
  ]
    .map(escapeCsvField)
    .join(",");
}

export const AUDIT_EXPORT_HEADER =
  "ID,Timestamp (Unix),Action,Actor,Target ID,Details\r\n";

/** Dated filename, e.g. `ophirpay-audit-log-2026-08-26.csv` (UTC date). */
export function buildAuditExportFilename(now: Date = new Date()): string {
  return `ophirpay-audit-log-${now.toISOString().slice(0, 10)}.csv`;
}