// SPDX-License-Identifier: MIT

import type { Payment } from "@prisma/client";

/**
 * Pure row-shaping for the donor history export (issue #571). A donor's
 * donations are the payments they sent, so rows are the caller's own Payment
 * records. No Prisma client or auth imports, so it can be unit-tested
 * without a database or a session.
 */

/** Upper bound on exported rows — the export is materialised as a single string. */
export const MAX_DONATION_EXPORT_ROWS = 10_000;

/** A CSV/JSON-friendly, fully-stringified view of a donation record. */
export interface DonationExportRow {
  id: string;
  amount: string;
  assetCode: string;
  assetIssuer: string;
  description: string;
  memo: string;
  status: string;
  transactionHash: string;
  createdAt: string;
}

/** Stable column order — shared by the CSV header and the JSON keys. */
export const DONATION_EXPORT_COLUMNS: {
  key: keyof DonationExportRow;
  header: string;
}[] = [
  { key: "id", header: "Donation ID" },
  { key: "amount", header: "Amount" },
  { key: "assetCode", header: "Asset Code" },
  { key: "assetIssuer", header: "Asset Issuer" },
  { key: "description", header: "Description" },
  { key: "memo", header: "Memo" },
  { key: "status", header: "Status" },
  { key: "transactionHash", header: "Transaction Hash" },
  { key: "createdAt", header: "Donated At" },
];

/**
 * Map a Prisma payment to a string-only export row. Dates are written as
 * ISO-8601 and Decimal amounts are rendered at the schema's scale (7 dp) —
 * `toString` would emit scientific notation for tiny amounts ("1e-7") and
 * `String()` coercion would give locale-dependent output.
 */
export function donationToExportRow(payment: Payment): DonationExportRow {
  return {
    id: payment.id,
    amount: payment.amount.toFixed(7),
    assetCode: payment.assetCode,
    assetIssuer: payment.assetIssuer ?? "",
    description: payment.description ?? "",
    memo: payment.memo ?? "",
    status: payment.status,
    transactionHash: payment.transactionHash ?? "",
    createdAt: payment.createdAt.toISOString(),
  };
}

/** Dated filename, e.g. `ophirpay-donations-2026-09-01.csv` (UTC date). */
export function buildDonationExportFilename(now: Date = new Date()): string {
  return `ophirpay-donations-${now.toISOString().split("T")[0]}.csv`;
}
