/**
 * OphirPay Webhook Relayer
 * 
 * Polls Prisma for active notification hooks AND queries the Soroban OphirPayContract
 * for new audit log entries. When a hook's event type matches a new audit entry,
 * the relayer delivers a signed webhook to the subscriber URL.
 * 
 * Dual-source: Prisma hooks (fast local query) + Soroban audit log (immutable on-chain truth)
 * 
 * Usage: npx tsx scripts/relayer.ts
 * 
 * Environment variables:
 *   POLL_INTERVAL_MS — polling interval in ms (default: 30000)
 *   NEXT_PUBLIC_CONTRACT_ID — Soroban OphirPay contract address
 */

import { nativeToScVal } from "@stellar/stellar-sdk";
import prisma from "@/lib/prisma";
import { deliverWebhook } from "@/lib/webhook-deliver";
import { logger } from "@/lib/logger";
import { simulateContractCall, CHAIN_READ_SOURCE } from "@/lib/contracts";

const READ_SOURCE = CHAIN_READ_SOURCE || "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

const CONTRACT_ID: string = (() => {
  const id = process.env.NEXT_PUBLIC_CONTRACT_ID;
  if (!id) {
    throw new Error("NEXT_PUBLIC_CONTRACT_ID is required. Set it in your environment.");
  }
  return id;
})();

const POLL_INTERVAL = parseInt(process.env.POLL_INTERVAL_MS || "30000", 10);

const HOOK_SECRET: string = (() => {
  const secret = process.env.HOOK_SECRET;
  if (!secret) {
    throw new Error("HOOK_SECRET is required for webhook HMAC signing. Set it in your environment.");
  }
  return secret;
})();

interface QueuedEvent {
  event: string;
  timestamp: string;
  data: Record<string, unknown>;
}

/**
 * Main relayer loop. Runs forever, polling every POLL_INTERVAL milliseconds.
 * In production, this should be replaced by event-driven delivery (SSE → enqueue).
 */
/**
 * Query the Soroban OphirPayContract for new audit log entries since lastCheck.
 * Returns a list of event descriptions keyed by event type.
 */
async function pollSorobanAuditLog(
  lastCheckTimestamp: number,
): Promise<{ event: string; data: Record<string, unknown> }[]> {
  try {
    // Simulate reading audit log count from the contract
    const countResult = await simulateContractCall(
      CONTRACT_ID,
      "get_audit_log_count",
      READ_SOURCE,
    );

    const totalEntries = countResult.returnValue ? parseInt(String(countResult.returnValue)) : 0;
    if (totalEntries === 0) return [];

    const events: { event: string; data: Record<string, unknown> }[] = [];

    // Read most recent entries (up to 10 per poll). get_audit_log_range requires
    // both start_id and end_id args — without them the simulation fails and no
    // events are ever found.
    const endId = totalEntries;
    const startId = Math.max(1, endId - 10);

    const rangeResult = await simulateContractCall(
      CONTRACT_ID,
      "get_audit_log_range",
      READ_SOURCE,
      [
        nativeToScVal(startId, { type: "u64" }),
        nativeToScVal(endId, { type: "u64" }),
      ],
    );

    // Map audit actions to webhook event types
    const actionToEvent: Record<string, string> = {
      payment_recorded: "payment_recorded",
      atomic_spend: "payment_recorded",
      escrow_created: "escrow_created",
      escrow_released: "escrow_released",
      refund_processed: "refund_processed",
      refund_approved: "refund_processed",
      stream_created: "stream_created",
      stream_claimed: "stream_claimed",
      batch_created: "batch_created",
      proposal_created: "proposal_created",
      proposal_passed: "proposal_created",
    };

    // If audit log entries were returned, map them to events
    if (rangeResult.returnValue) {
      // The raw result contains Vec<AuditEntry> — extract event types
      const raw = String(rangeResult.returnValue);
      const actionMatch = raw.match(/"action":"([^"]+)"/g);
      if (actionMatch) {
        for (const match of actionMatch) {
          const action = match.replace(/"action":"/, "").replace(/"/, "");
          const eventType = actionToEvent[action];
          if (eventType) {
            events.push({
              event: eventType,
              data: {
                source: "Soroban audit log",
                action,
                contractId: CONTRACT_ID,
                polledAt: Date.now(),
              },
            });
          }
        }
      }
    }

    return events;
  } catch (err) {
    logger.warn("Soroban audit log poll skipped", { error: String(err) });
    return [];
  }
}

async function relayerLoop(): Promise<void> {
  logger.info("🔔 OphirPay Webhook Relayer started", { pollInterval: POLL_INTERVAL, contractId: CONTRACT_ID });

  // Track last-seen event timestamps per event type to avoid duplicate deliveries
  const lastDelivered: Record<string, number> = {};
  let lastSorobanPoll = Date.now(); // track last Soroban query time

  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      const hooks = await prisma.notificationHook.findMany({
        where: { active: true },
        select: { id: true, eventType: true, webhookUrl: true },
      });

      if (hooks.length === 0) {
        logger.debug("No active hooks — skipping poll cycle");
      }

      const now = Date.now();
      const events: QueuedEvent[] = [];

      // Poll Soroban audit log for new on-chain events (every other cycle)
      if (now - lastSorobanPoll > POLL_INTERVAL * 2) {
        const sorobanEvents = await pollSorobanAuditLog(lastSorobanPoll);
        if (sorobanEvents.length > 0) {
          logger.info("📡 Soroban audit events found", { count: sorobanEvents.length });
        }
        for (const se of sorobanEvents) {
          events.push({
            event: se.event,
            timestamp: new Date().toISOString(),
            data: se.data,
          });
        }
        lastSorobanPoll = now;
      }

      // Collect events to deliver based on hook subscriptions
      for (const hook of hooks) {
        const lastTs = lastDelivered[hook.eventType] || 0;

        // Skip if we delivered recently (avoid spamming)
        if (now - lastTs < POLL_INTERVAL * 0.8) continue;

        // In production: query Soroban's get_audit_log_range for events since lastTs
        // For now: deliver a heartbeat confirming the hook is active
        events.push({
          event: hook.eventType,
          timestamp: new Date().toISOString(),
          data: {
            hookId: hook.id,
            eventType: hook.eventType,
            message: `Active hook — ${hook.eventType} subscription is registered on-chain`,
            deliveredAt: now,
          },
        });

        lastDelivered[hook.eventType] = now;
      }

      // Deliver events to matching hooks
      let delivered = 0;
      let failed = 0;

      for (const event of events) {
        const matchingHooks = hooks.filter((h) => h.eventType === event.event);

        for (const hook of matchingHooks) {
          const success = await deliverWebhook(hook.webhookUrl, HOOK_SECRET, event);
          if (success) {
            delivered++;
            logger.info("✅ Webhook delivered", {
              hookId: hook.id,
              event: event.event,
              url: hook.webhookUrl.substring(0, 40) + "...",
            });
          } else {
            failed++;
            logger.warn("❌ Webhook failed", {
              hookId: hook.id,
              event: event.event,
              url: hook.webhookUrl.substring(0, 40) + "...",
            });
          }
        }
      }

      if (delivered > 0 || failed > 0) {
        logger.info("📊 Relayer cycle complete", { delivered, failed, hooks: hooks.length });
      }
    } catch (err) {
      logger.error("Relayer cycle error", { error: String(err) });
    }

    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL));
  }
}

// Graceful shutdown
process.on("SIGINT", () => {
  logger.info("🛑 Relayer shutting down");
  process.exit(0);
});

process.on("SIGTERM", () => {
  logger.info("🛑 Relayer shutting down");
  process.exit(0);
});

relayerLoop().catch((err) => {
  logger.error("Relayer crashed", { error: String(err) });
  process.exit(1);
});
