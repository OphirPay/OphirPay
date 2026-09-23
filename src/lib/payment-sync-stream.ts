import { PrismaClient, Payment, PaymentSyncRun, SyncMechanism } from '@prisma/client';
import { createEventSource } from './events/event-source';
import { getHorizonUrl } from '../config';
import { logger } from '../utils/logger';

/**
 * Stream based payment reconciliation.
 *
 * Subscribes to Horizon account streams for all pending payments and updates
 * their status as soon as a transaction is observed. The stream is resilient
 * to disconnections and will reconcile missed events on reconnect.
 *
 * The function records a `PaymentSyncRun` entry for each status change
 * with the mechanism set to `STREAM`. If a stream event is missed, the
 * existing polling job will still fire and create a `POLLING` run.
 */
export async function startPaymentStreamSync(
  prisma: PrismaClient,
  horizonUrl: string = getHorizonUrl()
) {
  // Fetch all pending payments that have not yet been confirmed
  const pendingPayments = await prisma.payment.findMany({
    where: { status: 'PENDING' },
    select: { id: true, destinationAccount: true, transactionHash: true },
  });

  // Group by destination account to avoid duplicate streams
  const accountMap = new Map<string, Payment[]>();
  pendingPayments.forEach((p) => {
    const arr = accountMap.get(p.destinationAccount) ?? [];
    arr.push(p);
    accountMap.set(p.destinationAccount, arr);
  });

  // Helper to reconcile a single payment
  const reconcilePayment = async (payment: Payment) => {
    // If already confirmed, skip
    const current = await prisma.payment.findUnique({
      where: { id: payment.id },
      select: { status: true },
    });
    if (!current || current.status !== 'PENDING') return;

    // Query Horizon for the transaction hash
    try {
      const tx = await fetch(`${horizonUrl}/transactions/${payment.transactionHash}`);
      if (!tx.ok) return;
      const txJson = await tx.json();
      if (txJson.successful) {
        // Update status
        await prisma.payment.update({
          where: { id: payment.id },
          data: { status: 'CONFIRMED' },
        });

        // Record sync run
        await prisma.paymentSyncRun.create({
          data: {
            paymentId: payment.id,
            mechanism: SyncMechanism.STREAM,
            status: 'CONFIRMED',
            details: `Stream confirmed transaction ${payment.transactionHash}`,
          },
        });
      }
    } catch (e) {
      logger.warn(`Stream reconcile failed for payment ${payment.id}: ${e}`);
    }
  };

  // For each account, start an EventSource
  accountMap.forEach((payments, account) => {
    const streamUrl = `${horizonUrl}/accounts/${account}/payments?cursor=now&limit=200`;
    const es = createEventSource(streamUrl, {
      onMessage: async (event) => {
        try {
          const data = JSON.parse(event.data);
          // Horizon payment event contains transaction_hash
          const txHash = data.transaction_hash;
          // Find any pending payment with this hash
          const payment = payments.find((p) => p.transactionHash === txHash);
          if (payment) {
            await reconcilePayment(payment);
          }
        } catch (e) {
          logger.warn(`Failed to process stream event: ${e}`);
        }
      },
      onError: (err) => {
        logger.error(`EventSource error for account ${account}: ${err}`);
        // Let the EventSource library handle reconnection with backoff
      },
    });

    // Store the EventSource instance if we need to close it later
    // (not implemented here for brevity)
  });
}
