/** Maximum i128 value; matches the contract's i128::MAX. */
export const I128_MAX = (1n << 127n) - 1n;
export const MAX_BATCH_SIZE = 100;
export const BATCH_TOTAL_OVERFLOW_MSG = "Batch total overflows maximum amount";

export type BatchEntry = { address: string; amount: string | bigint };

export function validateBatch(entries: BatchEntry[]): { ok: boolean; total: string; error?: string } {
  if (entries.length === 0) return { ok: false, total: "0", error: "Batch is empty" };
  if (entries.length > MAX_BATCH_SIZE) return { ok: false, total: "0", error: "Batch too large" };
  let total: bigint = 0n;
  for (const e of entries) {
    const v = typeof e.amount === "bigint" ? e.amount : BigInt(e.amount);
    if (v <= 0n) return { ok: false, total: "0", error: "Invalid amount" };
    const next = total + v;
    if (next > I128_MAX) {
      return { ok: false, total: "0", error: BATCH_TOTAL_OVERFLOW_MSG };
    }
    total = next;
  }
  return { ok: true, total: total.toString() };
}
