// SPDX-License-Identifier: MIT

import { fetchOnChainPayments } from "@/lib/contracts";
import { successResponse, serverError } from "@/lib/api-response";
import { CACHE_PRESETS } from "@/lib/cache";
import { withRequestLogging } from "@/lib/request-logging";

export const dynamic = "force-dynamic";

/**
 * GET /api/events/history?limit=50 — fetch on-chain payment event history.
 * Cached for 60s since on-chain data changes slowly.
 */
export const GET = withRequestLogging(async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") || "50", 10)));

    const result = await fetchOnChainPayments(limit);

    return successResponse(
      {
        events: result.payments.map((p) => ({
          id: `evt_${p.id}`,
          type: "payment.created",
          payer: p.payer,
          payee: p.payee,
          amount: p.amountStroops,
          txHash: p.txHash,
          timestamp: p.timestamp,
          metadata: p.metadata,
        })),
        total: result.total,
      },
      { timestamp: new Date().toISOString() },
      200,
      CACHE_PRESETS.short
    );
  } catch (err) {
    return serverError(err instanceof Error ? err.message : "Failed to fetch event history");
  }
});
