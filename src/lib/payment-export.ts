// SPDX-License-Identifier: MIT

import type { Payment } from "@prisma/client";

/**
 * Pure row-shaping and serialization for the payment export. No Prisma client
 * or auth imports, so it can be unit-tested without a database or a session.
 *
 * The export supports two formats over the same record shape:
 *
 *   • CSV  — RFC 4180 rows built by `src/lib/export-csv.ts`
 *   • JSON — the same fields, as an array of objects
 *
 * There is deliberately no row cap: the export streams 250-row pages straight
 * from a Prisma cursor (issue #1369), so memory stays flat regardless of how
 * many rows match.
 */

/** Rows fetched (and flushed) per database round trip while streaming. */
export const PAYMENT_EXPORT_PAGE_SIZE = 250;

/** Supported download formats. */
export const PAYMENT_EXPORT_FORMATS = ["csv", "json"] as const;
export type PaymentExportFormat = (typeof PAYMENT_EXPORT_FORMATS)[number];

/** Content type sent for each format. */
export const PAYMENT_EXPORT_CONTENT_TYPES: Record<PaymentExportFormat, string> = {
  csv: "text/csv; charset=utf-8",
  json: "application/json; charset=utf-8",
};

/**
 * A fully-stringified, export-facing view of a payment record.
 *
 * The field names are the contract with API consumers (they are also the JSON
 * keys), while the column headers in {@link PAYMENT_EXPORT_COLUMNS} are the
 * human-readable CSV headers.
 */
export interface PaymentExportRow {
  id: string;
  timestamp: string;
  transactionHash: string;
  sender: string;
  recipient: string;
  asset: string;
  amount: string;
  fee: string;
  memo: string;
  status: string;
}

/** Columns exported by both formats, in display order. */
export const PAYMENT_EXPORT_COLUMNS: {
  key: keyof PaymentExportRow;
  header: string;
}[] = [
  { key: "timestamp", header: "Timestamp" },
  { key: "transactionHash", header: "Transaction Hash" },
  { key: "sender", header: "Sender" },
  { key: "recipient", header: "Recipient" },
  { key: "asset", header: "Asset" },
  { key: "amount", header: "Amount" },
  { key: "fee", header: "Fee" },
  { key: "memo", header: "Memo" },
  { key: "status", header: "Status" },
  { key: "id", header: "Payment ID" },
];

/**
 * Pull a fee out of the payment's metadata blob when one was recorded.
 *
 * The `Payment` model has no dedicated fee column, so the fee (when known) is
 * persisted inside the free-form `metadata` JSON under one of the conventional
 * keys below. Anything else is treated as "not recorded" and exported as an
 * empty cell rather than fabricated.
 */
function extractFee(metadata: string | null): string {
  if (!metadata) return "";
  try {
    const parsed: unknown = JSON.parse(metadata);
    if (parsed === null || typeof parsed !== "object") return "";
    const record = parsed as Record<string, unknown>;
    for (const key of ["fee", "networkFee", "feeCharged"]) {
      const value = record[key];
      if (typeof value === "string" || typeof value === "number") {
        return String(value);
      }
    }
  } catch {
    // Metadata is free-form; a non-JSON memo is not an export failure.
  }
  return "";
}

/**
 * Map a Prisma payment to a string-only export row. Dates are written as
 * ISO-8601 and Decimal amounts are rendered at the schema's scale (7 dp) —
 * `toString` would emit scientific notation for tiny amounts ("1e-7") and
 * `String()` coercion would give locale-dependent output.
 */
export function paymentToExportRow(payment: Payment): PaymentExportRow {
  return {
    id: payment.id,
    timestamp: payment.createdAt.toISOString(),
    transactionHash: payment.transactionHash ?? "",
    sender: payment.sourceAccountId ?? "",
    recipient: payment.destAccountId ?? "",
    asset: payment.assetCode,
    amount: payment.amount.toFixed(7),
    fee: extractFee(payment.metadata),
    memo: payment.memo ?? "",
    status: payment.status,
  };
}

/** Backwards-compatible alias used by the CSV streaming path. */
export const paymentToCsvRow = paymentToExportRow;

/** JSON representation of one row: the same keys, in column order. */
export function paymentRowToJson(
  row: PaymentExportRow
): Record<string, string> {
  return Object.fromEntries(
    PAYMENT_EXPORT_COLUMNS.map(({ key }) => [key, row[key]])
  ) as Record<string, string>;
}

/**
 * Serialize rows as a pretty-printed JSON array.
 *
 * Streaming callers build the array incrementally instead; this helper is for
 * buffered use (tests, small exports, the client-side fallback).
 */
export function toPaymentJson(rows: PaymentExportRow[]): string {
  return `${JSON.stringify(rows.map(paymentRowToJson), null, 2)}\n`;
}

/**
 * Dated filename, e.g. `ophirpay-payments-2026-08-26.csv` (UTC date).
 * The extension follows the requested format.
 */
export function buildPaymentExportFilename(
  format: PaymentExportFormat = "csv",
  now: Date = new Date()
): string {
  return `ophirpay-payments-${now.toISOString().split("T")[0]}.${format}`;
}
