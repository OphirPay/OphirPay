// SPDX-License-Identifier: MIT

import type { Payment } from "@prisma/client";

/**
 * Pure row-shaping for the payment CSV export. No Prisma client or auth
 * imports, so it can be unit-tested without a database or a session.
 */

/** Upper bound on exported rows — the CSV is materialised as a single string. */
export const MAX_EXPORT_ROWS = 10_000;

/** A CSV and JSON friendly, fully-shaped view of a payment record (issue #1296). */
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
  // Supplementary and backward-compatible fields
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
 * Standard columns called out by Issue #1296:
 * timestamp, transaction hash, sender, recipient, asset, amount, fee, memo, status.
 */
export const STANDARD_PAYMENT_EXPORT_COLUMNS: {
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

/** Standard fields required by Issue #1296 for JSON and accounting exports */
export interface StandardPaymentExportItem {
  timestamp: string;
  transactionHash: string;
  sender: string;
  recipient: string;
  asset: string;
  amount: string;
  fee: string;
  memo: string;
  status: string;
  id?: string;
}

/**
 * Map a Prisma payment to a string-only CSV/JSON row. Dates are written as
 * ISO-8601 and Decimal amounts are rendered at the schema's scale (7 dp) —
 * `toString` would emit scientific notation for tiny amounts ("1e-7") and
 * `String()` coercion would give locale-dependent output.
 */
export function paymentToCsvRow(payment: Payment): PaymentExportRow {
  const timestamp = payment.createdAt.toISOString();
  const sender = payment.sourceAccountId ?? "";
  const recipient = payment.destAccountId ?? "";
  const asset = payment.assetCode;
  // Stellar network standard base fee is 100 stroops (0.0000100 XLM)
  const fee = "0.0000100";

  return {
    id: payment.id,
    timestamp,
    transactionHash: payment.transactionHash ?? "",
    sender,
    recipient,
    asset,
    amount: payment.amount.toFixed(7),
    fee,
    memo: payment.memo ?? "",
    status: payment.status,
    assetCode: payment.assetCode,
    assetIssuer: payment.assetIssuer ?? "",
    description: payment.description ?? "",
    sourceAccountId: sender,
    destAccountId: recipient,
    createdAt: timestamp,
  };
}

/** Alias for paymentToCsvRow reflecting broader format support (CSV & JSON) */
export const paymentToExportRow = paymentToCsvRow;

/**
 * Serialize an array of payment rows or Prisma payments to structured JSON (issue #1296).
 * Follows the standard columns: timestamp, transaction hash, sender, recipient, asset, amount, fee, memo, status.
 */
export function serializePaymentsToJson(
  payments: (Payment | PaymentExportRow)[]
): string {
  const items: StandardPaymentExportItem[] = payments.map((p) => {
    const row = "timestamp" in p ? (p as PaymentExportRow) : paymentToCsvRow(p as Payment);
    return {
      timestamp: row.timestamp,
      transactionHash: row.transactionHash,
      sender: row.sender,
      recipient: row.recipient,
      asset: row.asset,
      amount: row.amount,
      fee: row.fee,
      memo: row.memo,
      status: row.status,
      id: row.id,
    };
  });
  return JSON.stringify(items, null, 2);
}

/**
 * Dated filename, e.g. `ophirpay-payments-2026-08-26.csv` or `.json` (UTC date).
 * Supports both legacy `buildPaymentExportFilename(now)` and `buildPaymentExportFilename(format, now)`.
 */
export function buildPaymentExportFilename(
  formatOrDate?: "csv" | "json" | Date,
  maybeDate?: Date
): string {
  let format = "csv";
  let date = new Date();

  if (formatOrDate instanceof Date) {
    date = formatOrDate;
  } else if (typeof formatOrDate === "string") {
    format = formatOrDate;
    if (maybeDate instanceof Date) {
      date = maybeDate;
    }
  }

  const yyyyMmDd = date.toISOString().split("T")[0];
  return `ophirpay-payments-${yyyyMmDd}.${format}`;
}
