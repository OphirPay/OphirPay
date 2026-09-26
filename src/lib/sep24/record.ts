// SPDX-License-Identifier: MIT

import prisma from "@/lib/prisma";
import type { Sep24Transaction } from "./types";
import { logger } from "@/lib/logger";

/**
 * Record a completed SEP-24 anchor deposit in the OphirPay database.
 * This ensures that on-ramp funds are reflected in the user's recorded payments list.
 *
 * Idempotent: Deduplicates by matching the anchor's transaction ID within payment metadata.
 *
 * @param userId OphirPay user ID
 * @param tx Completed SEP-24 transaction
 * @param anchorDomain Anchor domain that processed the transaction
 * @param assetCode Asset code (defaults to XLM or extracted from tx)
 */
export async function recordCompletedAnchorDeposit(
  userId: string,
  tx: Sep24Transaction,
  anchorDomain: string,
  assetCode: string = "XLM"
) {
  if (tx.status !== "completed") {
    return null;
  }

  const rawAmount = tx.amountOut || tx.amountIn || "0";
  const amount = Number(rawAmount);

  const metaString = JSON.stringify({
    source: "sep24_anchor",
    anchorDomain,
    anchorTransactionId: tx.id,
    kind: tx.kind,
    externalTransactionId: tx.externalTransactionId,
    amountFee: tx.amountFee,
  });

  // Check if already recorded to avoid duplicates
  const existing = await prisma.payment.findFirst({
    where: {
      userId,
      OR: [
        { transactionHash: tx.stellarTransactionId ? tx.stellarTransactionId : undefined },
        { metadata: { contains: `"anchorTransactionId":"${tx.id}"` } },
      ],
    },
  });

  if (existing) {
    return existing;
  }

  try {
    const payment = await prisma.payment.create({
      data: {
        userId,
        amount,
        assetCode: assetCode.toUpperCase(),
        description: `Fiat on-ramp deposit via ${anchorDomain}`,
        status: "COMPLETED",
        transactionHash: tx.stellarTransactionId || null,
        metadata: metaString,
      },
    });

    logger.info(`Recorded SEP-24 completed deposit for user ${userId}: payment ${payment.id} (${amount} ${assetCode})`);
    return payment;
  } catch (err: unknown) {
    logger.error("Failed to record SEP-24 anchor payment:", err);
    throw err;
  }
}
