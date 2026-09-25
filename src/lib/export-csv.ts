// SPDX-License-Identifier: MIT

/**
 * OphirPay CSV Export Builder
 * Issue #161: Export the filtered payment list to CSV
 * Refactored to delegate core parsing and serializing to unified csv-core.
 */

import { escapeCsvCell, serializeRecords, serializeCsv } from "@/lib/csv-core";

export interface PaymentRecord {
  id: string;
  amount: string | number;
  currency: string;
  status: string;
  created_at?: string;
  timestamp?: string;
  memo?: string | null;
  tx_hash?: string | null;
  txHash?: string | null;
}

export function escapeCsvField(val: unknown): string {
  return escapeCsvCell(val);
}

export function buildPaymentCsv(payments: PaymentRecord[]): string {
  const headers = ["id", "amount", "currency", "status", "created_at", "memo", "tx_hash"];
  const rows = payments.map((p) => [
    p.id,
    p.amount,
    p.currency,
    p.status,
    p.created_at || p.timestamp,
    p.memo,
    p.tx_hash || p.txHash,
  ]);

  return serializeCsv([headers, ...rows], { lineEnding: "\n" });
}

export function getExportFilename(prefix = "payments-export", date = new Date()): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${prefix}-${yyyy}-${mm}-${dd}.csv`;
}

/**
 * Convert an array of objects to CSV string (server-safe, no Blob).
 * `T extends object` (rather than Record<string, unknown>) so interfaces —
 * which have no implicit index signature — are accepted.
 * Includes OWASP formula-injection protection.
 */
export function toCsvString<T extends object>(
  data: T[],
  columns: { key: keyof T; header: string }[]
): string {
  return serializeRecords(data, columns, {
    preventFormulaInjection: true,
    lineEnding: "\n",
  });
}

/**
 * Create a CSV Response object for API download endpoints.
 * `extraHeaders` lets callers attach metadata (e.g. X-Export-Truncated).
 */
export function createCsvResponse(
  filename: string,
  data: string,
  extraHeaders: Record<string, string> = {}
): Response {
  return new Response(data, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      ...extraHeaders,
    },
  });
}
