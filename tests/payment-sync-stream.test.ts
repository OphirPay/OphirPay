import { PrismaClient, Payment, PaymentSyncRun, SyncMechanism } from '@prisma/client';
import { startPaymentStreamSync } from '../src/lib/payment-sync-stream';
import { createEventSource } from '../src/lib/events/event-source';
import { jest } from '@jest/globals';

jest.mock('../src/lib/events/event-source', () => {
  const original = jest.requireActual('../src/lib/events/event-source');
  return {
    ...original,
    createEventSource: jest.fn(),
  };
});

describe('Payment stream sync', () => {
  const prisma = new PrismaClient();
  const mockEventSource = {
    onmessage: null as any,
    onerror: null as any,
  };

  beforeAll(async () => {
    // Seed a pending payment
    await prisma.payment.create({
      data: {
        id: 1,
        destinationAccount: 'GDEST',
        transactionHash: 'TX123',
        status: 'PENDING',
      },
    });
  });

  afterAll(async () => {
    await prisma.payment.deleteMany({});
    await prisma.paymentSyncRun.deleteMany({});
    await prisma.$disconnect();
  });

  it('updates status on stream event', async () => {
    // Mock EventSource to capture onMessage
    (createEventSource as jest.Mock).mockReturnValue(mockEventSource);

    await startPaymentStreamSync(prisma, 'http://localhost:8000');

    // Simulate a Horizon payment event
    const eventData = JSON.stringify({
      transaction_hash: 'TX123',
    });
    mockEventSource.onmessage({ data: eventData });

    // Wait a tick for async processing
    await new Promise((r) => setTimeout(r, 50));

    const payment = await prisma.payment.findUnique({ where: { id: 1 } });
    expect(payment?.status).toBe('CONFIRMED');

    const run = await prisma.paymentSyncRun.findFirst({
      where: { paymentId: 1, mechanism: SyncMechanism.STREAM },
    });
    expect(run).not.toBeNull();
  });

  it('does not duplicate status change from polling', async () => {
    // Ensure payment is already confirmed
    await prisma.payment.update({
      where: { id: 1 },
      data: { status: 'PENDING' },
    });

    // Run polling sync manually
    await prisma.payment.update({
      where: { id: 1 },
      data: { status: 'PENDING' },
    });

    // Mock fetch to return successful transaction
    global.fetch = jest.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ successful: true }),
      })
    ) as any;

    // Run polling
    const { runPaymentPollingSync } = await import('../src/lib/payment-sync');
    await runPaymentPollingSync(prisma);

    // Check that only one run exists for the payment
    const runs = await prisma.paymentSyncRun.findMany({
      where: { paymentId: 1 },
    });
    const streamRuns = runs.filter((r) => r.mechanism === SyncMechanism.STREAM);
    const pollingRuns = runs.filter((r) => r.mechanism === SyncMechanism.POLLING);

    // Stream run should exist from previous test
    expect(streamRuns.length).toBe(1);
    // Polling run should also exist
    expect(pollingRuns.length).toBe(1);
    // Status should not be updated twice
    const payment = await prisma.payment.findUnique({ where: { id: 1 } });
    expect(payment?.status).toBe('CONFIRMED');
  });
});
