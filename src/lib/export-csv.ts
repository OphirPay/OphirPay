/**
 * OphirPay CSV Export Builder
 * Issue #161: Export the filtered payment list to CSV
 *
 * Quoting/escaping and BOM/newline behaviour live in the shared RFC-4180 core
 * (`@/lib/csv/core`, issue #761); this module keeps only the payment-specific
 * row shaping and the HTTP response wrapper.
 */

import { escapeCsvValue, serializeCsv, serializeCsvRecords } from "@/lib/csv/core";

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

/** Escape a single field (no formula-injection guard — legacy callers). */
export function escapeCsvField(val: unknown): string {
  if (val === null || val === undefined) return '';
  return escapeCsvValue(String(val));
}

export function buildPaymentCsv(payments: PaymentRecord[]): string {
  const headers = ['id', 'amount', 'currency', 'status', 'created_at', 'memo', 'tx_hash'];
  const rows: string[][] = [
    headers,
    ...payments.map((p) => [
      p.id,
      String(p.amount),
      p.currency,
      p.status,
      p.created_at || p.timestamp || "",
      String(p.memo ?? ""),
      p.tx_hash || p.txHash || "",
    ]),
  ];
  return serializeCsv(rows, { formulaGuard: false });
}

export function getExportFilename(prefix = 'payments-export', date = new Date()): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${prefix}-${yyyy}-${mm}-${dd}.csv`;
}

// SPDX-License-Identifier: MIT

/**
 * Server-side CSV generation for API route export endpoints.
 * Different from the client-side csv.ts which triggers downloads in the browser.
 */

/**
 * Convert an array of objects to CSV string (server-safe, no Blob).
 * `T extends object` (rather than Record<string, unknown>) so interfaces —
 * which have no implicit index signature — are accepted.
 *
 * Applies the OWASP formula-injection guard to every cell.
 */
export function toCsvString<T extends object>(
  data: T[],
  columns: { key: keyof T; header: string }[]
): string {
  return serializeCsvRecords(data, columns, { formulaGuard: true });
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
