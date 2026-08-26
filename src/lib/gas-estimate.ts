// SPDX-License-Identifier: MIT

/**
 * Stellar transaction cost display utilities.
 * Formats gas costs and fees in human-readable form.
 */

const STROOPS_PER_XLM = 10_000_000;

/**
 * Format stroops to a human-readable XLM string with minimal trailing zeros.
 * 100 stroops → "0.00001 XLM"
 */
export function formatStroopsToXlm(stroops: number | string): string {
  const s = typeof stroops === "string" ? parseFloat(stroops) : stroops;
  const xlm = s / STROOPS_PER_XLM;
  return `${xlm.toFixed(7).replace(/0+$/, "").replace(/\.$/, ".0")} XLM`;
}

/**
 * Format a base fee for display.
 */
export function formatBaseFee(stroops: number): string {
  if (stroops === 100) return "0.00001 XLM (minimum)";
  return `${formatStroopsToXlm(stroops)}`;
}

/**
 * Estimate total fee for a transaction with N operations.
 */
export function estimateTotalCost(
  numOperations: number,
  baseFeeStroops = 100
): { stroops: number; xlm: string } {
  const total = numOperations * baseFeeStroops;
  return {
    stroops: total,
    xlm: formatStroopsToXlm(total),
  };
}
