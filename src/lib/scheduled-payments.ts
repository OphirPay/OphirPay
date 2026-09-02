// SPDX-License-Identifier: MIT

import { Keypair, TransactionBuilder, Operation, Asset, Memo } from "@stellar/stellar-sdk";
import prisma from "@/lib/prisma";
import { getHorizonServer, NETWORK_PASSPHRASE } from "@/lib/stellar";
import type { ScheduledPayment, ScheduledPaymentStatus } from "@prisma/client";

/**
 * Scheduled (delayed) payments — one-off payments persisted with a future
 * `scheduledFor` timestamp. A cron endpoint calls `executeDueScheduledPayments`
 * which picks due rows, submits each from the configured server account, and
 * records the outcome (EXECUTED with the tx hash, or FAILED with the error).
 *
 * The server signs with `SCHEDULED_PAYMENTS_SOURCE_SECRET` (a funded Stellar
 * secret key). Without it, the cron endpoint refuses to run rather than
 * failing every due payment.
 */

export const SCHEDULED_SOURCE_SECRET_ENV = "SCHEDULED_PAYMENTS_SOURCE_SECRET";

/** Read the server-side signing secret, throwing a clear error if unset. */
export function getScheduledSourceSecret(): string {
  const secret = process.env[SCHEDULED_SOURCE_SECRET_ENV];
  if (!secret) {
    throw new Error(
      `${SCHEDULED_SOURCE_SECRET_ENV} is not configured — scheduled payments cannot be executed.`
    );
  }
  return secret;
}

/** Public key of the account that executes scheduled payments. */
export function getScheduledSourcePublicKey(): string {
  return Keypair.fromSecret(getScheduledSourceSecret()).publicKey();
}

export interface ScheduledPaymentSubmittable {
  id: string;
  amount: string;
  assetCode: string;
  assetIssuer?: string | null;
  destAddress: string;
  memo?: string | null;
}

/**
 * Build, sign, and submit one scheduled payment from the server account.
 * Returns the Horizon transaction hash on success.
 */
export async function submitScheduledPayment(
  payment: ScheduledPaymentSubmittable
): Promise<string> {
  const keypair = Keypair.fromSecret(getScheduledSourceSecret());
  const server = getHorizonServer();
  const sourceAccount = await server.loadAccount(keypair.publicKey());
  const now = Math.floor(Date.now() / 1000);

  const paymentAsset =
    payment.assetCode === "XLM" || !payment.assetIssuer
      ? Asset.native()
      : new Asset(payment.assetCode, payment.assetIssuer);

  let builder = new TransactionBuilder(sourceAccount, {
    fee: (await server.fetchBaseFee()).toString(),
    networkPassphrase: NETWORK_PASSPHRASE,
    timebounds: {
      minTime: 0,
      maxTime: now + 300, // 5 minutes
    },
  }).addOperation(
    Operation.payment({
      destination: payment.destAddress,
      asset: paymentAsset,
      amount: payment.amount,
    })
  );

  if (payment.memo) {
    builder = builder.addMemo(Memo.text(payment.memo));
  }

  const tx = builder.build();
  tx.sign(keypair);
  const result = await server.submitTransaction(tx);
  return result.hash;
}

/**
 * Select due scheduled payments: status SCHEDULED and `scheduledFor` in the
 * past, oldest first.
 */
export async function pickDueScheduledPayments(
  now: Date = new Date(),
  take = 20
): Promise<ScheduledPayment[]> {
  return prisma.scheduledPayment.findMany({
    where: {
      status: "SCHEDULED",
      scheduledFor: { lte: now },
    },
    orderBy: { scheduledFor: "asc" },
    take,
  });
}

export interface ScheduledPaymentRunSummary {
  /** Due candidates found (SCHEDULED + past due). */
  picked: number;
  executed: number;
  failed: number;
  results: {
    id: string;
    status: ScheduledPaymentStatus;
    transactionHash?: string | null;
    error?: string | null;
  }[];
}

/**
 * Execute all due scheduled payments:
 *
 *   1. pick due rows (SCHEDULED, scheduledFor <= now)
 *   2. atomically claim each (SCHEDULED → PROCESSING) so overlapping cron
 *      runs never double-submit a payment
 *   3. submit from the server account, then mark EXECUTED (with tx hash) or
 *      FAILED (with error message)
 *
 * `submit` is injectable for tests.
 */
export async function executeDueScheduledPayments(
  now: Date = new Date(),
  take = 20,
  submit: (payment: ScheduledPaymentSubmittable) => Promise<string> = submitScheduledPayment
): Promise<ScheduledPaymentRunSummary> {
  const due = await pickDueScheduledPayments(now, take);
  const summary: ScheduledPaymentRunSummary = {
    picked: due.length,
    executed: 0,
    failed: 0,
    results: [],
  };

  for (const payment of due) {
    // Claim the row; a concurrent cron run that already claimed it gets
    // count === 0 and we skip — no double submissions.
    const claimed = await prisma.scheduledPayment.updateMany({
      where: { id: payment.id, status: "SCHEDULED" },
      data: { status: "PROCESSING" },
    });
    if (claimed.count === 0) continue;

    try {
      const hash = await submit({
        id: payment.id,
        amount: payment.amount.toString(),
        assetCode: payment.assetCode,
        assetIssuer: payment.assetIssuer,
        destAddress: payment.destAddress,
        memo: payment.memo,
      });
      await prisma.scheduledPayment.update({
        where: { id: payment.id },
        data: {
          status: "EXECUTED",
          transactionHash: hash,
          executedAt: new Date(),
          errorMessage: null,
        },
      });
      summary.executed += 1;
      summary.results.push({ id: payment.id, status: "EXECUTED", transactionHash: hash });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await prisma.scheduledPayment.update({
        where: { id: payment.id },
        data: { status: "FAILED", errorMessage: message.slice(0, 500) },
      });
      summary.failed += 1;
      summary.results.push({ id: payment.id, status: "FAILED", error: message });
    }
  }

  return summary;
}
