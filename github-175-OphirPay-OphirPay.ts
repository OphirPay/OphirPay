// pages/api/scheduled-payments/execute.ts
import { NextApiRequest, NextApiResponse } from 'next';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { stripe } from '@/lib/stripe';
import { sendPaymentEvent } from '@/lib/events';

const EXECUTION_LIMIT = 100; // Prevent runaway execution

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Only allow POST from cron (Vercel sets X-Request-Id header for cron)
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Verify cron request (Vercel cron sends a specific header)
  const isCron = req.headers['x-request-id']?.startsWith('cron_');
  if (!isCron) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  try {
    // Find payments scheduled for today (or overdue)
    const dueDate = new Date();
    dueDate.setHours(0, 0, 0, 0); // Normalize to start of day

    const scheduledPayments = await prisma.payment.findMany({
      where: {
        status: 'SCHEDULED',
        scheduledFor: {
          lte: new Date(), // Due now or overdue
        },
      },
      take: EXECUTION_LIMIT,
      include: {
        user: true,
        wallet: true,
      },
    });

    if (scheduledPayments.length === 0) {
      return res.status(200).json({ processed: 0, message: 'No scheduled payments found' });
    }

    let processedCount = 0;
    const errors: string[] = [];

    for (const payment of scheduledPayments) {
      try {
        // Idempotency: skip if already processed (double-trigger protection)
        if (payment.status !== 'SCHEDULED') continue;

        // Validate wallet balance
        if (payment.wallet.balance < payment.amount) {
          throw new Error('Insufficient wallet balance');
        }

        // Deduct from wallet
        await prisma.wallet.update({
          where: { id: payment.walletId },
          data: {
            balance: { decrement: payment.amount },
          },
        });

        // Process payment (e.g., via Stripe if external)
        if (payment.provider === 'stripe') {
          await stripe.paymentIntents.create({
            amount: payment.amount * 100, // Stripe uses cents
            currency: payment.currency.toLowerCase(),
            customer: payment.user.stripeCustomerId,
            description: `Scheduled payment for ${payment.description}`,
          });
        }

        // Update payment status
        await prisma.payment.update({
          where: { id: payment.id },
          data: {
            status: 'COMPLETED',
            completedAt: new Date(),
          },
        });

        // Emit event
        sendPaymentEvent('payment.completed', {
          paymentId: payment.id,
          userId: payment.userId,
          amount: payment.amount,
          currency: payment.currency,
        });

        processedCount++;
      } catch (err) {
        const errorMsg = `Payment ${payment.id} failed: ${err instanceof Error ? err.message : 'Unknown error'}`;
        errors.push(errorMsg);

        // Update status to failed
        await prisma.payment.update({
          where: { id: payment.id },
          data: {
            status: 'FAILED',
            failureReason: errorMsg,
          },
        });
      }
    }

    return res.status(200).json({
      processed: processedCount,
      errors,
      total: scheduledPayments.length,
    });
  } catch (err) {
    console.error('Scheduled payment execution error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// Cron configuration in vercel.json:
// "crons": [
//   {
//     "path": "/api/scheduled-payments/execute",
//     "schedule": "0 0 * * *" // Every day at midnight UTC
//   }
// ]