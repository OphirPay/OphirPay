// SPDX-License-Identifier: MIT

import type { BatchRecipient } from "@/types";
import { isValidStellarAddress } from "@/lib/stellar";

export const MAX_MEMO_BYTES = 28;
const MEMO_CONTROL_CHARS = /[\u0000-\u001F\u007F-\u009F]/;

export interface BatchValidationError {
  index: number;
  field: string;
  message: string;
}

export interface BatchValidationResult {
  valid: boolean;
  errors: BatchValidationError[];
  totalAmount: number;
  totalsByAsset: Record<string, number>;
}

/**
 * Validate a batch of payment recipients before building the transaction.
 * Checks addresses, amounts, memos, duplicates, and total against balance.
 */
export function validateBatchRecipients(
  recipients: BatchRecipient[],
  availableBalance?: number
): BatchValidationResult {
  const errors: BatchValidationError[] = [];
  let totalAmount = 0;
  const totalsByAsset: Record<string, number> = {};
  const addresses = new Set<string>();

  if (recipients.length === 0) {
    errors.push({ index: -1, field: "recipients", message: "At least one recipient is required." });
    return { valid: false, errors, totalAmount: 0, totalsByAsset };
  }

  if (recipients.length > 100) {
    errors.push({
      index: -1,
      field: "recipients",
      message: "Maximum 100 recipients per batch.",
    });
    return { valid: false, errors, totalAmount: 0, totalsByAsset };
  }

  for (let i = 0; i < recipients.length; i++) {
    const r = recipients[i];

    if (!r.address || !isValidStellarAddress(r.address)) {
      errors.push({ index: i, field: "address", message: `Invalid Stellar address.` });
      continue;
    }

    if (addresses.has(r.address)) {
      errors.push({ index: i, field: "address", message: "Duplicate address." });
      continue;
    }
    addresses.add(r.address);

    const amount = typeof r.amount === "string" ? parseFloat(r.amount) : r.amount;
    if (isNaN(amount) || !Number.isFinite(amount) || amount <= 0) {
      errors.push({ index: i, field: "amount", message: "Amount must be greater than 0." });
      continue;
    }

    if (r.memo !== undefined && r.memo !== "") {
      if (MEMO_CONTROL_CHARS.test(r.memo)) {
        errors.push({
          index: i,
          field: "memo",
          message: "Memo must not contain control characters.",
        });
        continue;
      }
      if (new TextEncoder().encode(r.memo).length > MAX_MEMO_BYTES) {
        errors.push({
          index: i,
          field: "memo",
          message: "Memo must be 28 bytes or fewer.",
        });
        continue;
      }
    }

    totalAmount += amount;
    const asset = (r.assetCode || "XLM").toUpperCase();
    totalsByAsset[asset] = (totalsByAsset[asset] ?? 0) + amount;
  }

  const MAX_I128 = 1.7014118346046923e38;
  if (totalAmount > MAX_I128) {
    errors.push({
      index: -1,
      field: "total",
      message: "Math overflow",
    });
  }

  if (availableBalance !== undefined && totalAmount > availableBalance) {
    errors.push({
      index: -1,
      field: "total",
      message: `Total of ${totalAmount} exceeds available balance of ${availableBalance}.`,
    });
  }

  return { valid: errors.length === 0, errors, totalAmount, totalsByAsset };
}
