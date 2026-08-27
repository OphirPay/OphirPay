// SPDX-License-Identifier: MIT

import type { Payment } from "@prisma/client";

/**
 * Pure row-shaping for the payment CSV export. No Prisma client or auth
 * imports, so it can be unit-tested without a database or a session.
 */

/** Upper bound on exported rows — the CSV is materialised as a single string. */
export const MAX_EXPORT_ROWS = 10_000;

/** A CSV-friendly, fully-stringified view of a payment record. */
export interface PaymentExportRow {
  id: string;
  amount: string;
  assetCode: string;
  assetIssuer: string;
  description: string;
  memo: string;
  status: string;
  transactionHash: string;
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
 * Map a Prisma payment to a string-only CSV row. Dates are written as
 * ISO-8601 and Decimal amounts are rendered at the schema's scale (7 dp) —
 * `toString` would emit scientific notation for tiny amounts ("1e-7") and
 * `String()` coercion would give locale-dependent output.
 */
export function paymentToCsvRow(payment: Payment): PaymentExportRow {
  return {
    id: payment.id,
    amount: payment.amount.toFixed(7),
    assetCode: payment.assetCode,
    assetIssuer: payment.assetIssuer ?? "",
    description: payment.description ?? "",
    memo: payment.memo ?? "",
    status: payment.status,
    transactionHash: payment.transactionHash ?? "",
    sourceAccountId: payment.sourceAccountId ?? "",
    destAccountId: payment.destAccountId ?? "",
    createdAt: payment.createdAt.toISOString(),
  };
}

/** Dated filename, e.g. `ophirpay-payments-2026-08-26.csv` (UTC date). */
export function buildPaymentExportFilename(now: Date = new Date()): string {
  return `ophirpay-payments-${now.toISOString().split("T")[0]}.csv`;
}
