// SPDX-License-Identifier: MIT

/**
 * Dead-letter metrics and alert threshold.
 *
 * Acceptance criterion: "Metrics for dead-lettered deliveries are exposed and
 * alerted on." Counters are emitted at dead-letter time (see
 * webhook-dead-letter-service). This module adds the dashboard snapshot and the
 * threshold-based alert used to page when one subscriber's endpoint is broken.
 */

import { logger } from '@/lib/logger';
import { countDeadLetters } from '@/lib/webhook-dead-letter';

/** Emit an alert once a webhook accumulates this many un-replayed dead letters. */
export const DEAD_LETTER_ALERT_THRESHOLD = 5;

export interface DeadLetterPanel {
  totalUnreplayed: number;
  alerting: boolean;
  threshold: number;
}

/**
 * Snapshot for the metrics dashboard panel.
 * `webhookId` scope is used by the per-webhook alert; global scope by the panel.
 */
export async function getDeadLetterSnapshot(
  webhookId?: string,
): Promise<DeadLetterPanel> {
  const totalUnreplayed = await countDeadLetters(webhookId);
  return {
    totalUnreplayed,
    alerting: totalUnreplayed >= DEAD_LETTER_ALERT_THRESHOLD,
    threshold: DEAD_LETTER_ALERT_THRESHOLD,
  };
}

/** Log a warning when a webhook crosses the alert threshold. */
export async function checkDeadLetterAlert(webhookId: string): Promise<boolean> {
  const snapshot = await getDeadLetterSnapshot(webhookId);
  if (snapshot.alerting) {
    logger.warn('Webhook dead-letter threshold exceeded', {
      webhookId,
      totalUnreplayed: snapshot.totalUnreplayed,
      threshold: snapshot.threshold,
    });
  }
  return snapshot.alerting;
}
