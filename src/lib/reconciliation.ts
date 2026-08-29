// SPDX-License-Identifier: MIT

import prisma from "@/lib/prisma";
import { getHorizonServer } from "@/lib/stellar";
import { logger } from "@/lib/logger";

export interface ReconciliationResult {
  totalChecked: number;
  completedCount: number;
  failedCount: number;
  stillPendingCount: number;
  updatedPaymentIds: string[];
  timestamp: string;
  durationMs: number;
  errors: string[];
}

export interface ReconcileOptions {
  limit?: number;
  maxAgeMinutes?: number;
  userId?: string;
}

const DEFAULT_BATCH_LIMIT = 50;
const DEFAULT_TIMEOUT_MINUTES = 10;

/**
 * Reconciles pending/submitted transactions in the database with on-chain Horizon status.
 * Updates on-chain completed or failed transactions and flags dropped transactions.
 */
export async function reconcilePendingPayments(
  options: ReconcileOptions = {}
): Promise<ReconciliationResult> {
  const startTime = Date.now();
  const limit = options.limit || DEFAULT_BATCH_LIMIT;
  const timeoutMinutes = options.maxAgeMinutes || DEFAULT_TIMEOUT_MINUTES;
  const timeoutThreshold = new Date(Date.now() - timeoutMinutes * 60 * 1000);

  const result: ReconciliationResult = {
    totalChecked: 0,
    completedCount: 0,
    failedCount: 0,
    stillPendingCount: 0,
    updatedPaymentIds: [],
    timestamp: new Date().toISOString(),
    durationMs: 0,
    errors: [],
  };

  try {
    const whereClause: Record<string, unknown> = {
      status: { in: ["PENDING", "SUBMITTED"] },
      txHash: { not: null },
      deletedAt: null,
    };

    if (options.userId) {
      whereClause.userId = options.userId;
    }

    const pendingPayments = await prisma.payment.findMany({
      where: whereClause,
      take: limit,
      orderBy: { createdAt: "asc" },
    });

    result.totalChecked = pendingPayments.length;

    if (pendingPayments.length === 0) {
      result.durationMs = Date.now() - startTime;
      return result;
    }

    const horizon = getHorizonServer();

    for (const payment of pendingPayments) {
      if (!payment.txHash) continue;

      try {
        // Query transaction from Horizon
        const txRecord = await horizon.transactions().transaction(payment.txHash).call();

        if (txRecord && txRecord.successful) {
          await prisma.payment.update({
            where: { id: payment.id },
            data: {
              status: "COMPLETED",
              updatedAt: new Date(),
            },
          });
          result.completedCount++;
          result.updatedPaymentIds.push(payment.id);
          logger.info(`Reconciliation: Payment ${payment.id} marked as COMPLETED (tx: ${payment.txHash})`);
        } else if (txRecord && !txRecord.successful) {
          await prisma.payment.update({
            where: { id: payment.id },
            data: {
              status: "FAILED",
              updatedAt: new Date(),
            },
          });
          result.failedCount++;
          result.updatedPaymentIds.push(payment.id);
          logger.warn(`Reconciliation: Payment ${payment.id} failed on-chain (tx: ${payment.txHash})`);
        }
      } catch (err: unknown) {
        const error = err as { response?: { status?: number }; message?: string };
        // If 404 (Not Found on Horizon)
        if (error.response?.status === 404 || error.message?.includes("404")) {
          // If transaction has been pending longer than timeout, mark as failed/dropped
          if (new Date(payment.createdAt) < timeoutThreshold) {
            await prisma.payment.update({
              where: { id: payment.id },
              data: {
                status: "FAILED",
                updatedAt: new Date(),
              },
            });
            result.failedCount++;
            result.updatedPaymentIds.push(payment.id);
            logger.warn(`Reconciliation: Payment ${payment.id} timed out and not found on Horizon (tx: ${payment.txHash})`);
          } else {
            result.stillPendingCount++;
          }
        } else {
          result.stillPendingCount++;
          result.errors.push(`Error checking tx ${payment.txHash}: ${error.message || String(err)}`);
        }
      }
    }
  } catch (err: unknown) {
    const error = err as Error;
    result.errors.push(`Reconciliation job error: ${error.message || String(err)}`);
    logger.error("Reconciliation job encountered an unexpected error", { error: err });
  }

  result.durationMs = Date.now() - startTime;
  return result;
}
