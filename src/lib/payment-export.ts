// SPDX-License-Identifier: MIT

import type { Payment } from "@prisma/client";
import { toCsvString } from "@/lib/export-csv";

/**
 * Pure row-shaping for the payment CSV & JSON export. No Prisma client or auth
 * imports, so it can be unit-tested without a database or a session.
 */

/** Upper bound on exported rows — the export is materialised in memory. */
export const MAX_EXPORT_ROWS = 10_000;

/** Standard Stellar base fee (100 stroops = 0.0000100 XLM) when not overridden in metadata. */
export const DEFAULT_PAYMENT_FEE = "0.0000100";

export type PaymentExportFormat = "csv" | "json";

/** A CSV/JSON-friendly, fully-stringified view of a payment record. */
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
  assetCode: string;
  assetIssuer: string;
  description: string;
  sourceAccountId: string;
  destAccountId: string;
  createdAt: string;
}

export const PAYMENT_EXPORT_COLUMNS: {
  key: keyof PaymentExportRow;
  header: string;
}[] = [
  { key: "id", header: "Payment ID" },
  { key: "amount", header: "Amount" },
  { key: "assetCode", header: "Asset Code" },
  { key: "assetIssuer", header: "Asset Issuer" },
  { key: "description", header: "Description" },
  { key: "memo", header: "Memo" },
  { key: "status", header: "Status" },
  { key: "transactionHash", header: "Transaction Hash" },
  { key: "sourceAccountId", header: "Source Account" },
  { key: "destAccountId", header: "Destination Account" },
  { key: "createdAt", header: "Created At" },
];

/**
 * Canonical accounting/reconciliation column definition (#1296):
 * timestamp, transaction hash, sender, recipient, asset, amount, fee, memo, status.
 */
export const PAYMENT_HISTORY_COLUMNS: {
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
];

function extractFeeFromMetadata(metadata: string | null | undefined): string {
  if (!metadata) return DEFAULT_PAYMENT_FEE;
  try {
    const parsed = JSON.parse(metadata) as Record<string, unknown>;
    if (typeof parsed.fee === "string" && parsed.fee.trim().length > 0) {
      return parsed.fee.trim();
    }
    if (typeof parsed.fee === "number" && Number.isFinite(parsed.fee)) {
      return parsed.fee.toFixed(7);
    }
  } catch {
    // Non-JSON metadata — fall back to standard base fee
  }
  return DEFAULT_PAYMENT_FEE;
}

/**
 * Map a Prisma payment to a string-only export row. Dates are written as
 * ISO-8601 and Decimal amounts are rendered at the schema's scale (7 dp) —
 * `toString` would emit scientific notation for tiny amounts ("1e-7") and
 * `String()` coercion would give locale-dependent output.
 */
export function paymentToCsvRow(payment: Payment): PaymentExportRow {
  const isoTimestamp = payment.createdAt.toISOString();
  const source = payment.sourceAccountId ?? "";
  const dest = payment.destAccountId ?? "";
  const fee = extractFeeFromMetadata(payment.metadata);

  return {
    id: payment.id,
    timestamp: isoTimestamp,
    transactionHash: payment.transactionHash ?? "",
    sender: source,
    recipient: dest,
    asset: payment.assetCode,
    amount: payment.amount.toFixed(7),
    fee,
    memo: payment.memo ?? "",
    status: payment.status,
    assetCode: payment.assetCode,
    assetIssuer: payment.assetIssuer ?? "",
    description: payment.description ?? "",
    sourceAccountId: source,
    destAccountId: dest,
    createdAt: isoTimestamp,
  };
}

/** Serialize a list of Prisma payments into a JSON export string (#1296). */
export function serializePaymentsToJson(payments: Payment[]): string {
  const rows = payments.map((p) => {
    const row = paymentToCsvRow(p);
    return {
      id: row.id,
      timestamp: row.timestamp,
      transactionHash: row.transactionHash,
      sender: row.sender,
      recipient: row.recipient,
      asset: row.asset,
      assetIssuer: row.assetIssuer,
      amount: row.amount,
      fee: row.fee,
      memo: row.memo,
      description: row.description,
      status: row.status,
      createdAt: row.createdAt,
    };
  });
  return JSON.stringify(rows, null, 2);
}

/** Serialize a list of Prisma payments into CSV or JSON string (#1296). */
export function serializePaymentExport(
  payments: Payment[],
  format: PaymentExportFormat = "csv"
): string {
  if (format === "json") {
    return serializePaymentsToJson(payments);
  }
  const rows = payments.map(paymentToCsvRow);
  return toCsvString(rows, PAYMENT_EXPORT_COLUMNS);
}

/** Dated filename, e.g. `ophirpay-payments-2026-08-26.csv` or `.json` (UTC date). */
export function buildPaymentExportFilename(
  now: Date = new Date(),
  format: PaymentExportFormat = "csv"
): string {
  return `ophirpay-payments-${now.toISOString().split("T")[0]}.${format}`;
}
