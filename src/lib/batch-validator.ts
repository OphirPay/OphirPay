// SPDX-License-Identifier: MIT

import type { BatchRecipient } from "@/types";
import { isValidStellarAddress } from "@/lib/stellar";

interface BatchValidationResult {
  valid: boolean;
  errors: { index: number; field: string; message: string }[];
  totalAmount: number;
}

/**
 * Validate a batch of payment recipients before building the transaction.
 * Checks addresses, amounts, duplicates, and total against balance.
 */
export function validateBatchRecipients(
  recipients: BatchRecipient[],
  availableBalance?: number
): BatchValidationResult {
  const errors: { index: number; field: string; message: string }[] = [];
  let totalAmount = 0;
  const addresses = new Set<string>();

  if (recipients.length === 0) {
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
    if (isNaN(amount) || amount <= 0) {
      errors.push({ index: i, field: "amount", message: "Amount must be greater than 0." });
      continue;
    }

    totalAmount += amount;
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
