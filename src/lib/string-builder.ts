// SPDX-License-Identifier: MIT

/**
 * String builder utility for constructing complex display strings
 * like payment descriptions, event summaries, and notification text.
 */

/**
 * Build a human-readable transaction summary from payment details.
 */
export function buildTxSummary(params: {
  payer: string;
  payee: string;
  amount: string;
  asset: string;
}): string {
  const shortPayer = shortenAddress(params.payer);
  const shortPayee = shortenAddress(params.payee);
  return `${shortPayer} → ${shortPayee} · ${params.amount} ${params.asset}`;
}

/**
 * Build a batch payment description string.
 */
export function buildBatchSummary(params: {
  totalPayments: number;
  totalAmount: string;
  asset: string;
}): string {
  return `${params.totalPayments} payment${params.totalPayments !== 1 ? "s" : ""} · ${params.totalAmount} ${params.asset} total`;
}

/**
 * Shorten a Stellar public key for display.
 * Example: GABCD...WXYZ
 */
export function shortenAddress(address: string, chars = 4): string {
  if (address.length <= chars * 2 + 3) return address;
  return `${address.slice(0, chars + 1)}...${address.slice(-chars)}`;
}

/**
 * Build an event notification message from a decoded contract event.
 */
export function buildEventMessage(eventType: string, amount: string, recipient: string): string {
  const short = shortenAddress(recipient);
  switch (eventType) {
    case "payment_sent":
      return `Sent ${amount} XLM to ${short}`;
    case "batch_completed":
      return `Batch completed: ${amount} XLM distributed`;
    case "stream_created":
      return `Stream created for ${short} (${amount} XLM/interval)`;
    default:
      return `Event: ${eventType} — ${amount} XLM`;
  }
}
