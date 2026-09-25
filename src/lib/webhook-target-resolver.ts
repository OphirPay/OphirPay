// SPDX-License-Identifier: MIT

/**
 * Resolves the live delivery target (URL + signing secret) for a webhook.
 * Returns null when the webhook has been deleted or disabled, which is the
 * signal to leave the dead letter un-replayed rather than failing loudly.
 */

import prisma from '@/lib/prisma';

export interface WebhookTarget {
  url: string;
  secret: string;
}

type WebhookRow = {
  id: string;
  url: string;
  secret: string;
  active?: boolean;
  disabledAt?: Date | null;
};

export async function resolveActiveWebhookTarget(webhookId: string): Promise<WebhookTarget | null> {
  const delegate = (prisma as unknown as { webhook?: { findUnique: (args: unknown) => Promise<WebhookRow | null> } })
    .webhook;

  if (!delegate?.findUnique) return null;

  const row = await delegate.findUnique({ where: { id: webhookId } });
  if (!row) return null;
  if (row.active === false) return null;
  if (row.disabledAt) return null;

  return { url: row.url, secret: row.secret };
}
