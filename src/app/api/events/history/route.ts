// SPDX-License-Identifier: MIT
import { withMetrics } from "@/lib/metrics-middleware";

import { fetchOnChainPayments } from "@/lib/contracts";
import {
  successResponse,
  serverError,
  badRequestError,
  validationError,
} from "@/lib/api-response";
import { CACHE_PRESETS } from "@/lib/cache";
import { withRequestLogging } from "@/lib/request-logging";
import { cursorPaginationSchema } from "@/lib/validation-schemas";
import { decodeCursor, computeNextCursor } from "@/lib/pagination-utils";

export const dynamic = "force-dynamic";

/**
 * GET /api/events/history?limit=50&cursor=... — fetch on-chain payment event history.
 * Cached for 60s since on-chain data changes slowly.
 * Ordered by on-chain sequence ID descending (newest first).
 */
export const GET = withMetrics("GET /api/events/history", withRequestLogging(async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const explicitPage = searchParams.get("page");
    const rawCursor = searchParams.get("cursor");

    const parsed = cursorPaginationSchema.safeParse({
      limit: searchParams.get("limit") ?? undefined,
      cursor: rawCursor ?? undefined,
    });

    if (!parsed.success) {
      return validationError(parsed.error);
    }

    const { limit, cursor } = parsed.data;

    if (explicitPage !== null && cursor) {
      return badRequestError("page and cursor cannot both be used");
    }

    let cursorId: number | undefined;
    if (cursor) {
      const decoded = decodeCursor(cursor);
      if (!decoded) {
        return badRequestError("Invalid cursor");
      }
      const rawId = decoded.id.startsWith("evt_") ? decoded.id.slice(4) : decoded.id;
      const parsedId = parseInt(rawId, 10);
      if (isNaN(parsedId) || parsedId < 1) {
        return badRequestError("Invalid cursor");
      }
      cursorId = parsedId;
    }

    // Fetch limit + 1 records to determine whether another page exists.
    const result = await fetchOnChainPayments(limit + 1, undefined, cursorId);

    const events = result.payments.map((p) => {
      const tsNum = typeof p.timestamp === "number" ? p.timestamp : Number(p.timestamp || 0);
      const createdAt = tsNum > 0
        ? new Date(tsNum > 1e11 ? tsNum : tsNum * 1000).toISOString()
        : new Date(0).toISOString();

      return {
        id: `evt_${p.id}`,
        type: "payment.created",
        payer: p.payer,
        payee: p.payee,
        amount: p.amountStroops,
        txHash: p.txHash,
        timestamp: p.timestamp,
        createdAt,
        metadata: p.metadata,
      };
    });

    const visibleEvents = events.slice(0, limit);
    const { nextCursor, hasMore } = computeNextCursor(events, limit);

    return successResponse(
      {
        events: visibleEvents,
        total: result.total,
        nextCursor,
        hasMore,
      },
      {
        limit,
        total: result.total,
        nextCursor,
        hasMore,
        timestamp: new Date().toISOString(),
      },
      200,
      CACHE_PRESETS.short
    );
  } catch (err) {
    return serverError(err instanceof Error ? err.message : "Failed to fetch event history");
  }
}));

