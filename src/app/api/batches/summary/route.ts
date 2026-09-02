// SPDX-License-Identifier: MIT
import { withMetrics } from "@/lib/metrics-middleware";

import prisma from "@/lib/prisma";
import { successResponse, unauthorizedError, handleApiError } from "@/lib/api-response";
import { withRequestLogging } from "@/lib/request-logging";
import { getAuthContext } from "@/lib/auth-session";
import type { BatchStatus } from "@/types";

type BatchGroupResult = { status: string; _count: { _all: number } };

type BatchDrillDown = {
  id: string;
  name: string;
  description: string | null;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  paymentCounts?: { total: number; completed: number; failed: number; pending: number };
};

const BATCH_STATUSES: BatchStatus[] = [
  "CREATED",
  "PROCESSING",
  "COMPLETED",
  "PARTIALLY_COMPLETED",
  "FAILED",
];

/** Terminal statuses that count as "failed" for progress reporting. */
const FAILED_STATUSES = new Set<string>(["FAILED", "CANCELLED"]);

/**
 * GET /api/batches/summary — roll up batch statuses into counts
 *
 * Drives the batches dashboard summary view:
 *
 *  • `counts`     — number of batches in each BatchStatus, plus `total`.
 *  • `progress`   — global payment progress across *every* batch, derived from
 *                   the same child Payment rows that feed the per-batch counts,
 *                   so the summary is always consistent with per-item progress.
 *  • `batches`    — per-batch drill-down (most recent first) with each batch's
 *                   own payment progress broken down by status.
 *
 * Every count stems from the Payment/Batch rows themselves (Prisma groupBy),
 * never a separately cached aggregate, so reads always match the item-level
 * data the batches list renders.
 */
export const GET = withMetrics(
  "GET /api/batches/summary",
  withRequestLogging(async function GET(request: Request) {
    try {
      const auth = await getAuthContext(request);
      if (!auth) {
        return unauthorizedError(
          "Authentication required. Connect your wallet or provide an API key."
        );
      }

      const { searchParams } = new URL(request.url);
      const rawLimit = Number(searchParams.get("limit"));
      // Cap the drill-down list; absent/invalid values fall back to 10.
      const limit = Number.isInteger(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 50) : 10;

      const userId = auth.userId;

      const [statusGroups, batches, paymentGroups] = await Promise.all([
        // Batch counts by status.
        prisma.batch.groupBy({
          by: ["status"],
          where: { userId },
          _count: { _all: true },
        }),
        // Drill-down rows — most recent batches for this user.
        prisma.batch.findMany({
          where: { userId },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take: limit,
          select: {
            id: true,
            name: true,
            description: true,
            status: true,
            createdAt: true,
            updatedAt: true,
          },
        }),
        // Every payment inside any of the user's batches, keyed by (batch, status).
        // Computed once and reused for both the per-batch drill-down and the
        // global progress totals, keeping the two perfectly in sync.
        prisma.payment.groupBy({
          by: ["batchId", "status"],
          where: { userId, batchId: { not: null } },
          _count: { _all: true },
        }),
      ]);

      // Status counts - always expose every BatchStatus so the UI can render all cards
      const counts: Record<string, number> = Object.fromEntries(
        BATCH_STATUSES.map((s: BatchStatus) => [s, 0])
      );
      for (const g of statusGroups) {
        counts[g.status] = g._count._all;
      }
      const total = statusGroups.reduce((sum: number, g) => sum + g._count._all, 0);
      // Per-batch payment progress keyed by batchId → status → count.
      const perBatchStatus = new Map<string, Record<string, number>>();

      // Global progress across every batch, plus the per-batch drill-down.
      const globalProgress = { total: 0, completed: 0, failed: 0, pending: 0 };
      for (const p of paymentGroups) {
        if (!p.batchId) continue;
        const countsForBatch = perBatchStatus.get(p.batchId) ?? {};
        countsForBatch[p.status] = p._count._all;
        perBatchStatus.set(p.batchId, countsForBatch);

        globalProgress.total += p._count._all;
        if (p.status === "COMPLETED") globalProgress.completed += p._count._all;
        else if (FAILED_STATUSES.has(p.status)) globalProgress.failed += p._count._all;
        else globalProgress.pending += p._count._all;
      }

      const drillDown = batches.map((batch) => {
        const pc = perBatchStatus.get(batch.id) ?? {};
        const completed = pc["COMPLETED"] ?? 0;
        const failed = (pc["FAILED"] ?? 0) + (pc["CANCELLED"] ?? 0);
        const batchTotal = Object.values(pc).reduce((sum: number, n: number) => sum + n, 0);
        return {
          ...batch,
          paymentCounts: {
            total: batchTotal,
            completed,
            failed,
            pending: Math.max(0, batchTotal - completed - failed),
          },
        };
      });

      return successResponse({
        counts: { total, ...counts },
        progress: globalProgress,
        batches: drillDown,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      return handleApiError(err, "GET /api/batches/summary");
    }
  })
);
