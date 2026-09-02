/**
 * OphirPay CSV Export Builder
 * Issue #161: Export the filtered payment list to CSV
 */

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
  if (val === null || val === undefined) return '';
  const str = String(val);
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function buildPaymentCsv(payments: PaymentRecord[]): string {
  const headers = ['id', 'amount', 'currency', 'status', 'created_at', 'memo', 'tx_hash'];
  const rows = [headers.join(',')];

  for (const p of payments) {
    const row = [
      escapeCsvField(p.id),
      escapeCsvField(p.amount),
      escapeCsvField(p.currency),
      escapeCsvField(p.status),
      escapeCsvField(p.created_at || p.timestamp),
      escapeCsvField(p.memo),
      escapeCsvField(p.tx_hash || p.txHash)
    ];
    rows.push(row.join(','));
  }

  return rows.join('\n');
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
 */
export function toCsvString<T extends object>(
  data: T[],
  columns: { key: keyof T; header: string }[]
): string {
  const header = columns.map((c) => escapeField(String(c.header))).join(",");
  const rows = data.map((row) =>
    columns.map((c) => escapeField(String(row[c.key] ?? ""))).join(",")
  );
  return [header, ...rows].join("\n");
}

function escapeField(value: string): string {
  // CSV formula-injection guard (OWASP): spreadsheet apps evaluate cells that
  // begin with = + - @ as formulas (including DDE/UNC paths). Neutralize by
  // prefixing a single quote, which the spreadsheet renders literally.
  if (/^[=+\-@]/.test(value)) {
    value = `'${value}`;
  }
  if (
    value.includes(",") ||
    value.includes('"') ||
    value.includes("\n") ||
    // RFC 4180 §2.6 — a bare carriage return splits the record in Excel and
    // in any reader that treats CR as a line terminator.
    value.includes("\r")
  ) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
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
