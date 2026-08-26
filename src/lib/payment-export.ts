// SPDX-License-Identifier: MIT

/**
 * Pure shaping logic for the payment CSV export.
 *
 * Kept out of the route module so it can be unit-tested without pulling in
 * Prisma or the auth session machinery.
 */

/**
 * Upper bound on rows in a single export.
 *
 * The whole result set is materialised in memory as one string, so this is
 * bounded deliberately rather than left to grow with the table. When the cap is
 * hit the response is still a valid CSV; the `X-Export-Truncated` header tells
 * the caller the file is short, so truncation is never silent.
 */
export const MAX_EXPORT_ROWS = 10_000;

/** Columns written to the CSV, in order. */
export const EXPORT_COLUMNS = [
  { key: "id", header: "Payment ID" },
  { key: "createdAt", header: "Created At" },
  { key: "status", header: "Status" },
  { key: "amount", header: "Amount" },
  { key: "assetCode", header: "Asset Code" },
  { key: "assetIssuer", header: "Asset Issuer" },
  { key: "description", header: "Description" },
  { key: "memo", header: "Memo" },
  { key: "transactionHash", header: "Transaction Hash" },
  { key: "stellarOpId", header: "Stellar Op ID" },
  { key: "sourceAccountId", header: "Source Account" },
  { key: "destAccountId", header: "Destination Account" },
  { key: "batchId", header: "Batch ID" },
  { key: "completedAt", header: "Completed At" },
] as const;

export type ExportColumnKey = (typeof EXPORT_COLUMNS)[number]["key"];
export type ExportRow = Record<ExportColumnKey, string>;

/** Build the dated download filename, e.g. `ophirpay-payments-2026-08-26.csv`. */
export function exportFilename(now: Date = new Date()): string {
  return `ophirpay-payments-${now.toISOString().split("T")[0]}.csv`;
}

/**
 * Flatten a payment record to CSV-safe strings.
 *
 * `amount` is a Prisma `Decimal` and the timestamps are `Date` objects. Letting
 * `String()` coerce those would emit locale-dependent text for dates and could
 * lose precision on the decimal, so both are converted explicitly: dates to
 * ISO-8601, everything else through the value's own `toString`.
 */
export function toExportRow(payment: Record<string, unknown>): ExportRow {
  const str = (v: unknown): string => {
    if (v === null || v === undefined) return "";
    if (v instanceof Date) return v.toISOString();
    return String(v);
  };

  return Object.fromEntries(
    EXPORT_COLUMNS.map((c) => [c.key, str(payment[c.key])])
  ) as ExportRow;
}

/** Column descriptors in the shape `toCsvString` expects. */
export function exportColumnSpec(): { key: ExportColumnKey; header: string }[] {
  return EXPORT_COLUMNS.map((c) => ({ key: c.key, header: c.header }));
}
