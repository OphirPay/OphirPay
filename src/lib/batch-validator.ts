// SPDX-License-Identifier: MIT

import type { BatchRecipient } from "@/types";
import { isValidStellarAddress } from "@/lib/stellar";

export const MEMO_MAX_BYTES = 28;
const MEMO_CONTROL_CHARS =
  /[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2066-\u2069]/;

export interface BatchRowError {
  index: number;
  field: string;
  message: string;
}

export interface BatchValidationResult {
  valid: boolean;
  errors: BatchRowError[];
  totalAmount: number;
}

export interface BatchTotals {
  count: number;
  totalAmount: number;
  validCount: number;
  errorCount: number;
}

/**
 * Validate a single recipient row against format and constraint rules.
 */
export function validateBatchRecipientRow(
  r: (Partial<BatchRecipient> & { amount?: number | string }) | null | undefined,
  index: number,
  options: {
    seenAddresses?: Set<string>;
    selfAddress?: string | null;
  } = {}
): { valid: boolean; errors: { field: string; message: string }[]; amount: number } {
  const rowErrors: { field: string; message: string }[] = [];
  let parsedAmount = 0;

  if (!r || typeof r !== "object") {
    rowErrors.push({ field: "row", message: "Malformed or empty row data." });
    return { valid: false, errors: rowErrors, amount: 0 };
  }

  // Address validation
  const addr = (r.address ?? "").trim();
  if (!addr) {
    rowErrors.push({ field: "address", message: "Address is required." });
  } else if (!isValidStellarAddress(addr)) {
    rowErrors.push({ field: "address", message: "Invalid Stellar address." });
  } else if (options.selfAddress && addr === options.selfAddress) {
    rowErrors.push({ field: "address", message: "Cannot send to your own address." });
  } else if (options.seenAddresses) {
    if (options.seenAddresses.has(addr)) {
      rowErrors.push({ field: "address", message: "Duplicate address." });
    } else {
      options.seenAddresses.add(addr);
    }
  }

  // Amount validation
  const rawAmount = r.amount as unknown;
  if (rawAmount === undefined || rawAmount === null || String(rawAmount).trim() === "") {
    rowErrors.push({ field: "amount", message: "Amount is required." });
  } else {
    const num = typeof rawAmount === "string" ? parseFloat(rawAmount.trim()) : Number(rawAmount);
    if (isNaN(num) || !isFinite(num) || num <= 0) {
      rowErrors.push({ field: "amount", message: "Amount must be a number greater than 0." });
    } else {
      parsedAmount = num;
    }
  }

  // Memo validation
  if (r.memo !== undefined && r.memo !== null && String(r.memo).trim() !== "") {
    const memoStr = String(r.memo).trim();
    if (MEMO_CONTROL_CHARS.test(memoStr)) {
      rowErrors.push({ field: "memo", message: "Memo must not contain control characters." });
    } else if (memoStr.length > MEMO_MAX_BYTES) {
      rowErrors.push({ field: "memo", message: "Memo must be 28 characters or fewer." });
    } else if (new TextEncoder().encode(memoStr).length > MEMO_MAX_BYTES) {
      rowErrors.push({ field: "memo", message: "Memo must be 28 bytes or fewer (non-ASCII counts more)." });
    }
  }

  return { valid: rowErrors.length === 0, errors: rowErrors, amount: parsedAmount };
}

/**
 * Compute aggregate metrics across a list of recipients.
 */
export function calculateBatchTotals(recipients: BatchRecipient[]): BatchTotals {
  let totalAmount = 0;
  let validCount = 0;
  let errorCount = 0;
  const addresses = new Set<string>();

  for (let i = 0; i < recipients.length; i++) {
    const res = validateBatchRecipientRow(recipients[i], i, { seenAddresses: addresses });
    if (res.valid) {
      validCount++;
      totalAmount += res.amount;
    } else {
      errorCount++;
    }
  }

  return {
    count: recipients.length,
    totalAmount,
    validCount,
    errorCount,
  };
}

/**
 * Validate a batch of payment recipients before building the transaction.
 * Checks addresses, amounts, memos, duplicates, and total against balance.
 */
export function validateBatchRecipients(
  recipients: BatchRecipient[],
  availableBalance?: number
): BatchValidationResult {
  const errors: BatchRowError[] = [];
  let totalAmount = 0;
  const addresses = new Set<string>();

  if (!recipients || recipients.length === 0) {
    errors.push({ index: -1, field: "recipients", message: "At least one recipient is required." });
    return { valid: false, errors, totalAmount: 0 };
  }

  if (recipients.length > 100) {
    errors.push({
      index: -1,
      field: "recipients",
      message: "Maximum 100 recipients per batch.",
    });
    return { valid: false, errors, totalAmount: 0 };
  }

  for (let i = 0; i < recipients.length; i++) {
    const res = validateBatchRecipientRow(recipients[i], i, { seenAddresses: addresses });
    if (!res.valid) {
      for (const err of res.errors) {
        errors.push({ index: i, field: err.field, message: err.message });
      }
    } else {
      totalAmount += res.amount;
    }
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

  return { valid: errors.length === 0, errors, totalAmount };
}
