// SPDX-License-Identifier: MIT

export const STROOPS_PER_XLM = BigInt(10_000_000);

export function parseXlmAmount(value: string): bigint | null {
  const match = /^(\d+)(?:\.(\d{0,7}))?$/.exec(value.trim());
  if (!match) return null;
  return BigInt(match[1]) * STROOPS_PER_XLM +
    BigInt((match[2] ?? "").padEnd(7, "0") || "0");
}

export function formatXlmStroops(value: number | string | bigint): string {
  const stroops = BigInt(value);
  const whole = stroops / STROOPS_PER_XLM;
  const fractional = (stroops % STROOPS_PER_XLM)
    .toString()
    .padStart(7, "0")
    .replace(/0+$/, "");
  return `${new Intl.NumberFormat().format(whole)}.${fractional.padEnd(2, "0")} XLM`;
}
