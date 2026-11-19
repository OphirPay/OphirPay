// SPDX-License-Identifier: MIT
import { withMetrics } from "@/lib/metrics-middleware";

import { fetchOnChainPayments, type OnChainPayment } from "@/lib/contracts";
import { successResponse, serverError, validationError, badRequestError } from "@/lib/api-response";
import { CACHE_PRESETS } from "@/lib/cache";
import { withRequestLogging } from "@/lib/request-logging";
import { paginationSchema } from "@/lib/validation-schemas";
import { computeNextCursor, decodeCursor } from "@/lib/pagination-utils";

export const dynamic = "force-dynamic";

/**
 * Maximum page size for the event-history reader. Mirrors the cap applied by
 * `paginationSchema.limit` so the cursor contract and the shared list routes
 * cannot drift apart.
 */
export const EVENT_HISTORY_MAX_LIMIT = 100;

/** Default page size when no `limit` is supplied. */
export const EVENT_HISTORY_DEFAULT_LIMIT = 50;

/** Cursor `id` prefix shared with the public event id (`evt_<n>`). */
const EVENT_ID_PREFIX = "evt_";

/** Fallback ISO timestamp for an on-chain record that carries no timestamp. */
const EPOCH_ISO = new Date(0).toISOString();

interface EventHistoryItem {
  id: string;
  type: "payment.created";
  payer: string;
  payee: string;
  amount: number;
  txHash: string;
  timestamp?: number;
  metadata?: string;
}

/**
 * GET /api/events/history?limit=50&cursor=<opaque>
 *
 * Fetch on-chain payment event history with **cursor (keyset) pagination**,
 * following the same convention as `GET /api/payments`: an opaque `cursor`
 * plus a bounded `limit`, and a `meta.nextCursor`/`meta.hasMore` envelope.
 *
 * Ordering is stable: events are returned newest-first by on-chain id
 * (`id DESC`). The cursor anchors on the last event id of the previous page,
 * so the next call resumes exactly below it without re-reading or skipping
 * records — important for clients catching up after a disconnect, which may
 * call this endpoint repeatedly.
 *
 * Cached for 60s since on-chain data changes slowly.
 */
export const GET = withMetrics("GET /api/events/history", withRequestLogging(async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);

    // Reuse the shared pagination validation (limit cap + opaque cursor)
    // rather than inventing a third pagination style.
    const parsed = paginationSchema.safeParse({
      limit: searchParams.get("limit") ?? undefined,
      cursor: searchParams.get("cursor") ?? undefined,
    });
    if (!parsed.success) return validationError(parsed.error);

    const { limit, cursor: rawCursor } = parsed.data;

    // Keyset anchor: the previous page's last event id, with the `evt_`
    // prefix stripped back to the numeric on-chain id.
    let beforeId: number | undefined;
    if (rawCursor) {
      const cursor = decodeCursor(rawCursor);
      if (!cursor) return badRequestError("Invalid cursor");
      const numericId = Number(
        cursor.id.startsWith(EVENT_ID_PREFIX)
          ? cursor.id.slice(EVENT_ID_PREFIX.length)
          : cursor.id
      );
      if (!Number.isInteger(numericId) || numericId < 1) {
        return badRequestError("Invalid cursor");
      }
      beforeId = numericId;
    }

    // Fetch one extra record so we can tell whether another page exists
    // without a second contract read (the same limit + 1 trick the payments
    // list uses).
    const result = await fetchOnChainPayments(limit + 1, undefined, { beforeId });

    const rows: EventHistoryItem[] = result.payments.map((p) => toEventHistoryItem(p));
    const events = rows.slice(0, limit);

    // `computeNextCursor` needs a `createdAt` to encode the opaque cursor.
    // The on-chain timestamp is the natural anchor; records without one fall
    // back to the epoch so the payload stays schema-valid (ordering still
    // follows the stable `id DESC` on-chain ids).
    const { nextCursor, hasMore } = computeNextCursor(
      rows.map((event) => ({
        createdAt: event.timestamp
          ? new Date(event.timestamp * 1000).toISOString()
          : EPOCH_ISO,
        id: event.id,
      })),
      limit
    );

    return successResponse(
      { events, total: result.total },
      { limit, nextCursor, hasMore },
      200,
      CACHE_PRESETS.short
    );
  } catch (err) {
    return serverError(err instanceof Error ? err.message : "Failed to fetch event history");
  }
}));

/** Normalize an on-chain payment record into the event-history wire shape. */
function toEventHistoryItem(p: OnChainPayment): EventHistoryItem {
  return {
    id: `${EVENT_ID_PREFIX}${p.id}`,
    type: "payment.created",
    payer: p.payer,
    payee: p.payee,
    amount: p.amountStroops,
    txHash: p.txHash,
    timestamp: p.timestamp,
    metadata: p.metadata,
  };
}
