// SPDX-License-Identifier: MIT

import type { OnChainPayment } from "@/lib/contracts";

/**
 * Column sorting for the payments table.
 *
 * Pure, URL-driven helpers so sort state can live in the query string
 * (`?sort=date|amount|status&dir=asc|desc`) and compose with the existing
 * search filter and pagination without any shared mutable state.
 */

export type PaymentSortKey = "date" | "amount" | "status";
export type PaymentSortDir = "asc" | "desc";

export interface PaymentSort {
  /** null means no sort — the table falls back to contract insertion order. */
  key: PaymentSortKey | null;
  dir: PaymentSortDir;
}

export const PAYMENT_SORT_KEYS: readonly PaymentSortKey[] = [
  "date",
  "amount",
  "status",
];

const DEFAULT_SORT: PaymentSort = { key: null, dir: "asc" };

/**
 * Derive the display status of an on-chain payment record.
 * The contract stores a status marker in the metadata field.
 */
export function getPaymentStatus(
  payment: Pick<OnChainPayment, "metadata">
): "RECORDED" | "CANCELLED" {
  return payment.metadata === "CANCELLED" ? "CANCELLED" : "RECORDED";
}

/**
 * Read and validate the `sort` / `dir` search params.
 * Unknown keys or directions fall back to defaults instead of throwing,
 * so a hand-edited URL can never break the table.
 */
export function parsePaymentSort(params: URLSearchParams): PaymentSort {
  const key = params.get("sort") as PaymentSortKey | null;
  if (!key || !(PAYMENT_SORT_KEYS as readonly string[]).includes(key)) {
    return DEFAULT_SORT;
  }
  const dir = params.get("dir") === "desc" ? "desc" : "asc";
  return { key, dir };
}

/**
 * Build the URL param updates that encode a sort state.
 * Passing the result to the page's `updateQuery` persists the sort in the
 * URL. A cleared sort (key === null) maps both params to null so they are
 * removed from the query string entirely.
 */
export function getSortParamUpdates(
  sort: PaymentSort
): Record<string, string | null> {
  if (!sort.key) return { sort: null, dir: null };
  return { sort: sort.key, dir: sort.dir };
}

/**
 * Compute the next sort state for a header click.
 *
 * Cycling behavior (per column):
 *   none → asc → desc → none
 * Clicking a different column always starts at ascending.
 */
export function getNextSort(
  current: PaymentSort,
  key: PaymentSortKey
): PaymentSort {
  if (current.key !== key) return { key, dir: "asc" };
  if (current.dir === "asc") return { key, dir: "desc" };
  return DEFAULT_SORT;
}

/**
 * Return a new array sorted by the active sort state.
 * The input array is not mutated. Missing timestamps sort as the epoch
 * (oldest), so they surface first in ascending and last in descending —
 * predictable in both directions.
 */
export function applyPaymentSort(
  payments: OnChainPayment[],
  sort: PaymentSort
): OnChainPayment[] {
  if (!sort.key) return payments;

  const dir = sort.dir === "desc" ? -1 : 1;
  return [...payments].sort((a, b) => {
    let cmp = 0;
    switch (sort.key) {
      case "date":
        cmp = (a.timestamp ?? 0) - (b.timestamp ?? 0);
        break;
      case "amount":
        cmp = a.amountStroops - b.amountStroops;
        break;
      case "status":
        cmp = getPaymentStatus(a).localeCompare(getPaymentStatus(b));
        break;
    }
    return cmp * dir;
  });
}
