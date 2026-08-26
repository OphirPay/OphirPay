// SPDX-License-Identifier: MIT

import type { OnChainPayment } from "@/lib/contracts";
import { XLM_STROOPS } from "@/lib/stellar";
import { titleCase } from "@/lib/text";

export interface FormattedEvent {
  id: string;
  type: string;
  amountXlm: number;
  payer: string;
  payee: string;
  txHash: string;
  timestamp?: number;
  metadata?: string;
  status: string;
}

/**
 * Format raw on-chain payment data into a display-friendly event format.
 */
export function formatOnChainEvent(payment: OnChainPayment): FormattedEvent {
  return {
    id: `evt_${payment.id}`,
    type: "payment.created",
    amountXlm: payment.amountStroops / XLM_STROOPS,
    payer: payment.payer,
    payee: payment.payee,
    txHash: payment.txHash,
    timestamp: payment.timestamp,
    metadata: payment.metadata,
    status: payment.metadata === "CANCELLED" ? "CANCELLED" : "COMPLETED",
  };
}

/**
 * Group events by type for analytics display.
 */
export function groupEventsByType(
  events: FormattedEvent[]
): { type: string; count: number; volume: number }[] {
  const groups: Record<string, { count: number; volume: number }> = {};
  for (const e of events) {
    if (!groups[e.type]) groups[e.type] = { count: 0, volume: 0 };
    groups[e.type].count++;
    groups[e.type].volume += e.amountXlm;
  }
  return Object.entries(groups).map(([type, v]) => ({
    type: titleCase(type.replace("payment.", "")),
    count: v.count,
    volume: v.volume,
  }));
}

/**
 * Sort events by timestamp (newest first).
 */
export function sortEventsByDate<T extends { timestamp?: number }>(events: T[]): T[] {
  return [...events].sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0));
}
