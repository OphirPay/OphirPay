import { PrismaClient, SyncMechanism } from '@prisma/client';
import { startPaymentStreamSync } from './payment-sync-stream';
import { getHorizonUrl } from '../config';
import { logger } from '../utils/logger';

/**
 * Existing polling reconciliation job.
 * This function remains unchanged but now records the mechanism.
 */
export async function runPaymentPollingSync(prisma: PrismaClient) {
  const pendingPayments = await prisma.payment.findMany({
    where: { status: 'PENDING' },
  });

  for (const payment of pendingPayments) {
    try {
      const tx = await fetch(`${getHorizonUrl()}/transactions/${payment.transactionHash}`);
      if (!tx.ok) continue;
      const txJson = await tx.json();
      if (txJson.successful) {
        await prisma.payment.update({
          where: { id: payment.id },
          data: { status: 'CONFIRMED' },
        });

        await prisma.paymentSyncRun.create({
          data: {
            paymentId: payment.id,
            mechanism: SyncMechanism.POLLING,
            status: 'CONFIRMED',
            details: `Polling confirmed transaction ${payment.transactionHash}`,
          },
        });
      }
    } catch (e) {
      logger.warn(`Polling sync failed for payment ${payment.id}: ${e}`);
    }
  }
}

/**
 * Entry point for the reconciliation job.
 * Starts the streaming sync and falls back to polling if needed.
 */
export async function runPaymentSyncJob(prisma: PrismaClient) {
  // Start streaming sync
  await startPaymentStreamSync(prisma);

  // Run polling as a safety net every 5 minutes
  setInterval(() => runPaymentPollingSync(prisma), 5 * 60 * 1000);
}
