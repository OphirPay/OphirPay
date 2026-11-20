// SPDX-License-Identifier: MIT

import type { BatchRecipient } from "@/types";

export interface BatchProcessorOptions {
  /**
   * When true, entries with the same address, asset and memo are merged into a
   * single payment whose amount is the sum. Entries that differ in memo or
   * asset are never merged. Defaults to false (flag only).
   */
  combineDuplicates?: boolean;
}

export interface DuplicateGroup {
  address: string;
  /** Indices (in the input array) of every entry sharing this address. */
  indices: number[];
  /** True when at least two of those entries were merged into one payment. */
  combined: boolean;
}

export interface ProcessedBatch {
  recipients: BatchRecipient[];
  duplicates: DuplicateGroup[];
  warnings: string[];
}

// Stellar amounts have at most 7 decimal places.
const roundAmount = (n: number): number => Number(n.toFixed(7));

const sameTarget = (a: BatchRecipient, b: BatchRecipient): boolean =>
  a.address === b.address &&
  (a.assetCode ?? "") === (b.assetCode ?? "") &&
  (a.memo ?? "") === (b.memo ?? "");

/**
 * Detect duplicate recipient addresses in a batch and optionally combine them.
 */
export function processBatchRecipients(
  recipients: BatchRecipient[],
  options: BatchProcessorOptions = {}
): ProcessedBatch {
  const { combineDuplicates = false } = options;

  const indicesByAddress = new Map<string, number[]>();
  recipients.forEach((r, i) => {
    const list = indicesByAddress.get(r.address);
    if (list) list.push(i);
    else indicesByAddress.set(r.address, [i]);
  });

  const output: BatchRecipient[] = [];
  const mergedAddresses = new Set<string>();

  recipients.forEach((r) => {
    if (combineDuplicates) {
      const existing = output.find((o) => sameTarget(o, r));
      if (existing) {
        existing.amount = roundAmount(existing.amount + r.amount);
        mergedAddresses.add(r.address);
        return;
      }
    }
    output.push({ ...r });
  });

  const duplicates: DuplicateGroup[] = [];
  const warnings: string[] = [];
  for (const [address, indices] of indicesByAddress) {
    if (indices.length < 2) continue;
    const combined = mergedAddresses.has(address);
    duplicates.push({ address, indices, combined });
    warnings.push(
      `Duplicate recipient ${address} appears ${indices.length} times (rows ${indices
        .map((i) => i + 1)
        .join(", ")}).`
    );
  }

  return { recipients: output, duplicates, warnings };
}
