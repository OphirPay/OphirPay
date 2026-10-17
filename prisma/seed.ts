import { PrismaClient, Prisma } from "@prisma/client";
import { createHash } from "crypto";

export type SeedProfile = "minimal" | "staging" | "load";

export interface SeedOptions {
  profile: SeedProfile;
  sanitize: boolean;
  dryRun: boolean;
}

export interface SeedSummary {
  profile: SeedProfile;
  usersCount: number;
  paymentsCount: number;
  batchesCount: number;
  refundsCount: number;
  hooksCount: number;
  accountsCount: number;
  recurrencesCount: number;
  scheduledPaymentsCount: number;
  paymentRequestsCount: number;
  webhooksCount: number;
  webhookEventsCount: number;
  webhookDeliveriesCount: number;
  auditLogsCount: number;
  apiKeysCount: number;
  apiKeyLogsCount: number;
  syncRunsCount: number;
  sanitizedCount: number;
}

/**
 * Validates that the target database URL does not match any production patterns
 * or active production environments to prevent accidental data overwriting.
 */
export function assertSafeDatabaseUrl(
  databaseUrl?: string,
  env: Record<string, string | undefined> = process.env
): void {
  const nodeEnv = (env.NODE_ENV || "").toLowerCase();
  const vercelEnv = (env.VERCEL_ENV || "").toLowerCase();
  if (nodeEnv === "production" || vercelEnv === "production") {
    throw new Error(
      `[SAFETY CHECK] Staging seed aborted: Environment variable NODE_ENV or VERCEL_ENV is set to production.`
    );
  }

  const stellarNetwork = (
    env.STELLAR_NETWORK ||
    env.NEXT_PUBLIC_STELLAR_NETWORK ||
    ""
  ).toUpperCase();
  if (stellarNetwork === "PUBLIC" || stellarNetwork === "MAINNET") {
    throw new Error(
      `[SAFETY CHECK] Staging seed aborted: STELLAR_NETWORK is set to public mainnet (${stellarNetwork}).`
    );
  }

  if (!databaseUrl) {
    return;
  }

  const cleanUrl = databaseUrl.trim().toLowerCase();

  // Pattern checks for production database hosts, connection strings, and names
  const productionPatterns: RegExp[] = [
    /(\b|_|-)(prod|production|live)(\b|_|-)/i,
    /\b(prod|production)\.[a-z0-9-]+\.(aws|neon|supabase|postgres)/i,
    /([@/])(prod|production|live)-db/i,
    /([@/])(ophirpay_prod|ophirpay-prod|production_db)/i,
  ];

  for (const pattern of productionPatterns) {
    if (pattern.test(cleanUrl)) {
      throw new Error(
        `[SAFETY CHECK] Staging seed aborted: Target DATABASE_URL appears to be a production environment (matched pattern: ${pattern}).`
      );
    }
  }
}

/**
 * Sanitizes an email address to a deterministic internal staging address
 * to guarantee no external real users receive staging notifications.
 */
export function sanitizeEmail(email: string): string {
  if (!email) return "user_anonymous@staging.ophirpay.internal";
  if (email.endsWith("@staging.ophirpay.internal")) {
    return email;
  }
  const hash = createHash("sha256").update(email.toLowerCase().trim()).digest("hex").slice(0, 10);
  return `user_${hash}@staging.ophirpay.internal`;
}

/**
 * Generates a mock or sanitized staging API key prefix and hash.
 */
export function sanitizeApiKey(rawOrHashedKey: string): { prefix: string; keyHash: string } {
  const hash = createHash("sha256").update(rawOrHashedKey).digest("hex");
  const prefix = `oph_stg_${hash.slice(0, 4)}`;
  return {
    prefix,
    keyHash: `v1:${hash}`,
  };
}

/**
 * Returns a valid Stellar testnet public key format for mock data.
 */
export function generateMockStellarKey(index: number): string {
  const mockKeys = [
    "GACZ7ZELCUC5YGJ6JHIVLEZNR3XKYKOVUWD6H3IRFPRZMALNUYJZQM2U",
    "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
    "GCALANF3WJ77Y5BL6ZZQ556QO5NQLI4N75EAKQW472OOHWZX6NPL5BTI",
    "GDQP2KPQGKIHYJGXNUIYOMHARUARCA7DJT5FO2FFOOKY3IFDTUIDWN25",
    "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
    "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFTRTVUARWGLWDZTRQ5B2",
    "GDEQ4NTR3F2U6F3F5IUG6C636U3H3AECDXJ5FRPAYTFX2L66Q7Q76P3E",
    "GB5W7Q673K2W4L7XW5PXXK7M54M6ZFF64A2FTHP62V53ZJ46L46A4Y5G",
  ];
  return mockKeys[index % mockKeys.length];
}

/**
 * Returns a random Date between `daysAgoMax` days ago and now.
 */
export function generatePastDate(daysAgoMax: number = 30): Date {
  const now = Date.now();
  const pastMs = Math.floor(Math.random() * daysAgoMax * 24 * 60 * 60 * 1000);
  return new Date(now - pastMs);
}

/**
 * Parses CLI arguments and environment variables into SeedOptions.
 */
export function parseSeedOptions(
  args: string[] = process.argv.slice(2),
  env: Record<string, string | undefined> = process.env
): SeedOptions {
  let profile: SeedProfile = (env.SEED_PROFILE as SeedProfile) || "minimal";
  let sanitize = env.SEED_SANITIZE === "true";
  let dryRun = false;

  for (const arg of args) {
    if (arg.startsWith("--profile=")) {
      const p = arg.split("=")[1].toLowerCase();
      if (p === "staging" || p === "minimal" || p === "load") {
        profile = p;
      }
    } else if (arg === "-p" && args.indexOf(arg) + 1 < args.length) {
      const p = args[args.indexOf(arg) + 1].toLowerCase();
      if (p === "staging" || p === "minimal" || p === "load") {
        profile = p as SeedProfile;
      }
    } else if (arg === "--profile") {
      profile = "staging";
    } else if (arg === "--staging") {
      profile = "staging";
    } else if (arg === "--minimal") {
      profile = "minimal";
    } else if (arg === "--load") {
      profile = "load";
    } else if (arg === "--sanitize" || arg === "--staging-sanitize") {
      sanitize = true;
    } else if (arg === "--dry-run") {
      dryRun = true;
    }
  }

  return { profile, sanitize, dryRun };
}

/**
 * Sanitizes existing database records if required.
 */
export async function sanitizeExistingData(prisma: PrismaClient): Promise<number> {
  let sanitizedCount = 0;

  // 1. Sanitize user emails
  const users = await prisma.user.findMany({
    where: {
      email: {
        not: {
          endsWith: "@staging.ophirpay.internal",
        },
      },
    },
  });

  for (const u of users) {
    if (u.email) {
      await prisma.user.update({
        where: { id: u.id },
        data: { email: sanitizeEmail(u.email) },
      });
      sanitizedCount++;
    }
  }

  // 2. Sanitize PaymentRequest recipient emails
  const requests = await prisma.paymentRequest.findMany({
    where: {
      recipientEmail: {
        not: {
          endsWith: "@staging.ophirpay.internal",
        },
      },
    },
  });

  for (const r of requests) {
    if (r.recipientEmail) {
      await prisma.paymentRequest.update({
        where: { id: r.id },
        data: {
          recipientEmail: sanitizeEmail(r.recipientEmail),
          notificationEmail: r.notificationEmail ? sanitizeEmail(r.notificationEmail) : undefined,
        },
      });
      sanitizedCount++;
    }
  }

  return sanitizedCount;
}

/**
 * Executes the seed workflow according to the configured profile.
 */
export async function runSeed(
  prisma: PrismaClient,
  options: SeedOptions
): Promise<SeedSummary> {
  const summary: SeedSummary = {
    profile: options.profile,
    usersCount: 0,
    paymentsCount: 0,
    batchesCount: 0,
    refundsCount: 0,
    hooksCount: 0,
    accountsCount: 0,
    recurrencesCount: 0,
    scheduledPaymentsCount: 0,
    paymentRequestsCount: 0,
    webhooksCount: 0,
    webhookEventsCount: 0,
    webhookDeliveriesCount: 0,
    auditLogsCount: 0,
    apiKeysCount: 0,
    apiKeyLogsCount: 0,
    syncRunsCount: 0,
    sanitizedCount: 0,
  };

  if (options.sanitize) {
    summary.sanitizedCount = await sanitizeExistingData(prisma);
  }

  if (options.dryRun) {
    return summary;
  }

  // ── Profile: Minimal (Standard Local Smoke Testing) ───────────
  if (options.profile === "minimal") {
    const user = await prisma.user.upsert({
      where: { id: "seed-user-1" },
      update: {},
      create: {
        id: "seed-user-1",
        name: "OphirPay Demo",
        email: "demo@staging.ophirpay.internal",
        stellarAddress: generateMockStellarKey(0),
      },
    });
    summary.usersCount = 1;

    const paymentSeeds = [
      { amount: 500, description: "Monthly subscription payment", status: "COMPLETED" as const },
      { amount: 250, description: "Freelance invoice #42", status: "COMPLETED" as const },
      { amount: 1500, description: "Vendor payment — cloud hosting", status: "COMPLETED" as const },
      { amount: 100, description: "Test payment", status: "PENDING" as const },
      { amount: 75, description: "Coffee fund contribution", status: "FAILED" as const },
    ];

    const createdPayments: { id: string; amount: Prisma.Decimal }[] = [];
    for (const p of paymentSeeds) {
      const payment = await prisma.payment.create({
        data: {
          amount: p.amount,
          assetCode: "XLM",
          description: p.description,
          status: p.status,
          userId: user.id,
          transactionHash: `tx-hash-${Math.random().toString(36).substring(2, 10)}`,
        },
      });
      createdPayments.push({ id: payment.id, amount: payment.amount });
    }
    summary.paymentsCount = createdPayments.length;

    await prisma.batch.create({
      data: {
        name: "Demo Batch — Monthly Payroll",
        description: "Sample batch payment for demo purposes",
        userId: user.id,
        status: "COMPLETED",
      },
    });
    summary.batchesCount = 1;

    const refunds = [
      { idx: 0, reason: "Product arrived defective", reasonCode: 0, status: "PROCESSED" as const },
      { idx: 1, reason: "Never received the service", reasonCode: 1, status: "APPROVED" as const },
      { idx: 2, reason: "Charged twice by mistake", reasonCode: 2, status: "REQUESTED" as const },
      { idx: 3, reason: "Unauthorized transaction", reasonCode: 3, status: "REJECTED" as const },
    ];

    for (const r of refunds) {
      const payment = createdPayments[r.idx];
      if (!payment) continue;
      await prisma.refund.create({
        data: {
          userId: user.id,
          paymentId: payment.id,
          amount: payment.amount,
          reason: r.reason,
          reasonCode: r.reasonCode,
          status: r.status,
          asset: "native",
          resolvedAt: r.status === "PROCESSED" || r.status === "REJECTED" ? new Date() : null,
        },
      });
      summary.refundsCount++;
    }

    const hooks = [
      { eventType: "payment_recorded", webhookUrl: "https://staging-receiver.ophirpay.internal/hooks/payments" },
      { eventType: "refund_processed", webhookUrl: "https://staging-receiver.ophirpay.internal/hooks/refunds" },
      { eventType: "escrow_created", webhookUrl: "https://staging-receiver.ophirpay.internal/hooks/escrows" },
    ];

    for (const h of hooks) {
      await prisma.notificationHook.create({
        data: {
          userId: user.id,
          eventType: h.eventType,
          webhookUrl: h.webhookUrl,
          active: true,
        },
      });
      summary.hooksCount++;
    }

    return summary;
  }

  // ── Profile: Staging & Load (Full Multi-User & Realistic Business Scenarios) ──
  const stagingUsers = [
    {
      id: "stg-user-admin",
      name: "Staging Ops Admin",
      email: "ops_admin@staging.ophirpay.internal",
      stellarAddress: generateMockStellarKey(0),
    },
    {
      id: "stg-user-merchant",
      name: "Staging Stellar Commerce",
      email: "merchant@staging.ophirpay.internal",
      stellarAddress: generateMockStellarKey(1),
    },
    {
      id: "stg-user-dev",
      name: "Staging Integration Dev",
      email: "dev_portal@staging.ophirpay.internal",
      stellarAddress: generateMockStellarKey(2),
    },
    {
      id: "stg-user-alice",
      name: "Staging Alice Buyer",
      email: "alice_test@staging.ophirpay.internal",
      stellarAddress: generateMockStellarKey(3),
    },
  ];

  const dbUsers = [];
  for (const u of stagingUsers) {
    const user = await prisma.user.upsert({
      where: { id: u.id },
      update: {
        name: u.name,
        email: u.email,
        stellarAddress: u.stellarAddress,
      },
      create: u,
    });
    dbUsers.push(user);
    summary.usersCount++;
  }

  const [adminUser, merchantUser, devUser, aliceUser] = dbUsers;

  // 2. Linked Accounts
  const accountDefinitions = [
    { userId: adminUser.id, name: "Main Treasury", publicKey: generateMockStellarKey(0) },
    { userId: merchantUser.id, name: "Merchant Operations", publicKey: generateMockStellarKey(1) },
    { userId: merchantUser.id, name: "Staging Checkout Vault", publicKey: generateMockStellarKey(4) },
    { userId: devUser.id, name: "Dev Sandbox Account", publicKey: generateMockStellarKey(2) },
    { userId: aliceUser.id, name: "Alice Personal Stash", publicKey: generateMockStellarKey(3) },
  ];

  const dbAccounts = [];
  for (const acc of accountDefinitions) {
    const account = await prisma.account.upsert({
      where: { publicKey: acc.publicKey },
      update: { name: acc.name, isActive: true },
      create: acc,
    });
    dbAccounts.push(account);
    summary.accountsCount++;
  }

  // 3. Batches
  const batchPayroll = await prisma.batch.create({
    data: {
      name: "Staging Batch — Monthly Contractor Payout",
      description: "Automated test payout across international contractors",
      userId: merchantUser.id,
      status: "COMPLETED",
    },
  });
  summary.batchesCount++;

  const batchGrants = await prisma.batch.create({
    data: {
      name: "Staging Batch — Milestone Grants",
      description: "Community grant disbursements awaiting final multisig",
      userId: adminUser.id,
      status: "PROCESSING",
    },
  });
  summary.batchesCount++;

  // 4. Payments across statuses & 30-day realistic timestamps, including:
  //    - active escrows
  //    - partially vested streams
  //    - multi-signature approval queues
  const paymentScenarios = [
    // Regular payments
    {
      userId: merchantUser.id,
      amount: 1250.5,
      assetCode: "USDC",
      description: "Wholesale Inventory Settlement",
      status: "COMPLETED" as const,
      daysAgo: 25,
      sourceAccountId: dbAccounts[1]?.id,
      destAccountId: dbAccounts[0]?.id,
      batchId: batchPayroll.id,
      txHash: "a1b2c3d4e5f67890123456789abcdef0123456789abcdef0123456789abcdef0",
    },
    {
      userId: aliceUser.id,
      amount: 45.0,
      assetCode: "XLM",
      description: "Subscription — Pro Tier",
      status: "COMPLETED" as const,
      daysAgo: 18,
      sourceAccountId: dbAccounts[4]?.id,
      destAccountId: dbAccounts[1]?.id,
      txHash: "b2c3d4e5f67890123456789abcdef0123456789abcdef0123456789abcdef01",
    },
    {
      userId: merchantUser.id,
      amount: 820.0,
      assetCode: "XLM",
      description: "Cloud Provider Monthly Compute",
      status: "CONFIRMED" as const,
      daysAgo: 12,
      sourceAccountId: dbAccounts[1]?.id,
      txHash: "c3d4e5f67890123456789abcdef0123456789abcdef0123456789abcdef012",
    },
    {
      userId: devUser.id,
      amount: 15.0,
      assetCode: "XLM",
      description: "Micro-payment Test Sequence #1",
      status: "PENDING" as const,
      daysAgo: 2,
    },
    {
      userId: devUser.id,
      amount: 50.0,
      assetCode: "XLM",
      description: "Contract Invocation Gas Buffer",
      status: "PROCESSING" as const,
      daysAgo: 1,
    },
    {
      userId: aliceUser.id,
      amount: 300.0,
      assetCode: "USDC",
      description: "Refunded Store Return",
      status: "COMPLETED" as const,
      daysAgo: 22,
      txHash: "d4e5f67890123456789abcdef0123456789abcdef0123456789abcdef0123",
    },
    {
      userId: merchantUser.id,
      amount: 99.99,
      assetCode: "XLM",
      description: "Failed Checkout Sequence",
      status: "FAILED" as const,
      daysAgo: 8,
      errorMessage: "Horizon transaction expired before ledger close",
    },
    {
      userId: adminUser.id,
      amount: 5000.0,
      assetCode: "XLM",
      description: "Cancelled Treasury Reallocation",
      status: "CANCELLED" as const,
      daysAgo: 15,
    },
    // Issue #1423 Business Scenario A: Active Escrows
    {
      userId: merchantUser.id,
      amount: 2500.0,
      assetCode: "USDC",
      description: "Active Escrow: Logistics Freight Delivery Bond",
      status: "PROCESSING" as const,
      daysAgo: 5,
      metadata: JSON.stringify({
        type: "escrow",
        escrowId: "esc_stg_101",
        state: "ACTIVE",
        arbiter: generateMockStellarKey(2),
        beneficiary: generateMockStellarKey(1),
        depositor: generateMockStellarKey(3),
        releaseConditions: "Physical customs bill-of-lading confirmation verified",
        lockedAt: new Date(Date.now() - 5 * 86400000).toISOString(),
        timeoutLedger: 1250000,
      }),
    },
    // Issue #1423 Business Scenario B: Partially Vested Streams
    {
      userId: adminUser.id,
      amount: 12000.0,
      assetCode: "XLM",
      description: "Partially Vested Stream: Core Contributor 6-Month Grant",
      status: "CONFIRMED" as const,
      daysAgo: 28,
      metadata: JSON.stringify({
        type: "stream",
        streamId: "str_stg_202",
        state: "ACTIVE",
        totalAmount: "12000.0000000",
        vestedAmount: "5600.0000000",
        withdrawnAmount: "4000.0000000",
        ratePerSecond: "0.0007716",
        cliffPassed: true,
        startTime: new Date(Date.now() - 28 * 86400000).toISOString(),
        stopTime: new Date(Date.now() + 152 * 86400000).toISOString(),
      }),
    },
    // Issue #1423 Business Scenario C: Multi-Signature Approval Queues
    {
      userId: adminUser.id,
      amount: 35000.0,
      assetCode: "USDC",
      description: "Multisig Approval Queue: Staging Security Audit Retainer",
      status: "PENDING" as const,
      daysAgo: 3,
      batchId: batchGrants.id,
      metadata: JSON.stringify({
        type: "multisig",
        proposalId: "prop_stg_303",
        threshold: 2,
        requiredSigners: 3,
        currentSignatures: 1,
        signers: [generateMockStellarKey(0), generateMockStellarKey(1), generateMockStellarKey(2)],
        signedBy: [generateMockStellarKey(0)],
        pendingApproval: true,
        expiresAt: new Date(Date.now() + 7 * 86400000).toISOString(),
      }),
    },
  ];

  const dbPayments = [];
  for (const p of paymentScenarios) {
    const createdAt = new Date(Date.now() - p.daysAgo * 86400000);
    const payment = await prisma.payment.create({
      data: {
        userId: p.userId,
        amount: p.amount,
        assetCode: p.assetCode,
        description: p.description,
        status: p.status,
        sourceAccountId: p.sourceAccountId,
        destAccountId: p.destAccountId,
        batchId: p.batchId,
        transactionHash: p.txHash,
        errorMessage: p.errorMessage,
        metadata: p.metadata,
        createdAt,
        updatedAt: createdAt,
        completedAt: p.status === "COMPLETED" ? createdAt : null,
      },
    });
    dbPayments.push(payment);
    summary.paymentsCount++;
  }

  // 5. Recurrences (Recurring Schedules)
  const recMonthly = await prisma.recurrence.create({
    data: {
      userId: aliceUser.id,
      name: "Monthly Streaming Subscription",
      frequency: "MONTHLY",
      amount: 45.0,
      assetCode: "XLM",
      destAddress: generateMockStellarKey(1),
      description: "Auto-renew monthly payment",
      isActive: true,
      nextRunAt: new Date(Date.now() + 12 * 86400000),
      lastRunAt: new Date(Date.now() - 18 * 86400000),
    },
  });
  summary.recurrencesCount++;

  const recWeekly = await prisma.recurrence.create({
    data: {
      userId: merchantUser.id,
      name: "Weekly Liquidity Pool Rebalance",
      frequency: "WEEKLY",
      amount: 250.0,
      assetCode: "USDC",
      destAddress: generateMockStellarKey(0),
      description: "Automated weekly vault liquidity provision",
      isActive: true,
      nextRunAt: new Date(Date.now() + 3 * 86400000),
      lastRunAt: new Date(Date.now() - 4 * 86400000),
    },
  });
  summary.recurrencesCount++;

  // 6. Scheduled Payments (One-off scheduled runs)
  await prisma.scheduledPayment.create({
    data: {
      userId: merchantUser.id,
      amount: 1500.0,
      assetCode: "USDC",
      destAddress: generateMockStellarKey(4),
      description: "End of month supplier milestone",
      scheduledAt: new Date(Date.now() + 5 * 86400000),
      status: "SCHEDULED",
    },
  });
  summary.scheduledPaymentsCount++;

  await prisma.scheduledPayment.create({
    data: {
      userId: devUser.id,
      amount: 25.0,
      assetCode: "XLM",
      destAddress: generateMockStellarKey(0),
      description: "Past executed test run",
      scheduledAt: new Date(Date.now() - 10 * 86400000),
      executedAt: new Date(Date.now() - 10 * 86400000),
      status: "EXECUTED",
      transactionHash: "e5f67890123456789abcdef0123456789abcdef0123456789abcdef01234567",
    },
  });
  summary.scheduledPaymentsCount++;

  // 7. Payment Requests
  await prisma.paymentRequest.create({
    data: {
      userId: merchantUser.id,
      amount: 120.0,
      assetCode: "USDC",
      description: "Invoice #INV-2026-0881 - Hardware Supply",
      recipientEmail: "buyer_0881@staging.ophirpay.internal",
      notificationEmail: merchantUser.email,
      dueDate: new Date(Date.now() + 14 * 86400000),
      status: "PENDING",
    },
  });
  summary.paymentRequestsCount++;

  await prisma.paymentRequest.create({
    data: {
      userId: merchantUser.id,
      amount: 300.0,
      assetCode: "USDC",
      description: "Invoice #INV-2026-0740 - Design Consultation",
      recipientEmail: "alice_client@staging.ophirpay.internal",
      status: "PAID",
      transactionHash: "f67890123456789abcdef0123456789abcdef0123456789abcdef012345678",
    },
  });
  summary.paymentRequestsCount++;

  // 8. Refunds
  if (dbPayments[5]) {
    await prisma.refund.create({
      data: {
        userId: aliceUser.id,
        paymentId: dbPayments[5].id,
        amount: dbPayments[5].amount,
        reason: "Item returned in original packaging",
        reasonCode: 1,
        status: "PROCESSED",
        asset: "USDC",
        onChainId: 1001,
        requestedAt: new Date(Date.now() - 20 * 86400000),
        resolvedAt: new Date(Date.now() - 19 * 86400000),
      },
    });
    summary.refundsCount++;
  }

  if (dbPayments[0]) {
    await prisma.refund.create({
      data: {
        userId: merchantUser.id,
        paymentId: dbPayments[0].id,
        amount: 250.0,
        reason: "Partial dispute on delivery fee",
        reasonCode: 2,
        status: "REQUESTED",
        asset: "USDC",
        onChainId: 1002,
        requestedAt: new Date(Date.now() - 2 * 86400000),
      },
    });
    summary.refundsCount++;
  }

  // 9. Webhooks, Events, Deliveries
  const webhook = await prisma.webhook.create({
    data: {
      userId: merchantUser.id,
      url: "https://staging-receiver.ophirpay.internal/api/webhooks/incoming",
      events: JSON.stringify(["payment.completed", "refund.processed", "escrow.locked"]),
      secret: "oph_stg_whsec_" + createHash("sha256").update("merchant_sec").digest("hex").slice(0, 16),
      isActive: true,
    },
  });
  summary.webhooksCount++;

  const webhookEvt = await prisma.webhookEvent.create({
    data: {
      userId: merchantUser.id,
      event: "payment.completed",
      timestamp: new Date(Date.now() - 18 * 86400000),
      data: JSON.stringify({
        paymentId: dbPayments[1]?.id,
        amount: "45.0000000",
        asset: "XLM",
        status: "COMPLETED",
      }),
    },
  });
  summary.webhookEventsCount++;

  await prisma.webhookDelivery.create({
    data: {
      webhookId: webhook.id,
      eventId: webhookEvt.id,
      status: "SUCCESS",
      responseCode: 200,
      latencyMs: 142,
      durationMs: 142,
      targetUrl: webhook.url,
      deliveredAt: new Date(Date.now() - 18 * 86400000),
    },
  });
  summary.webhookDeliveriesCount++;

  // 10. Audit Logs
  const auditEntries = [
    {
      action: "auth:login",
      actor: adminUser.id,
      target: adminUser.id,
      ip: "10.0.1.42",
      details: { method: "freighter", wallet: adminUser.stellarAddress },
    },
    {
      action: "escrow:create",
      actor: merchantUser.id,
      target: "esc_stg_101",
      ip: "10.0.2.15",
      details: { amount: "2500.0 USDC", arbiter: generateMockStellarKey(2) },
    },
    {
      action: "multisig:proposal_submit",
      actor: adminUser.id,
      target: "prop_stg_303",
      ip: "10.0.1.42",
      details: { proposalId: "prop_stg_303", threshold: 2, amount: "35000.0 USDC" },
    },
  ];

  for (const entry of auditEntries) {
    await prisma.auditLog.create({
      data: {
        action: entry.action,
        actor: entry.actor,
        target: entry.target,
        ip: entry.ip,
        details: entry.details,
      },
    });
    summary.auditLogsCount++;
  }

  // 11. Notification Hooks
  const stgHooks = [
    { eventType: "payment.completed", webhookUrl: "https://staging-receiver.ophirpay.internal/hooks/payments" },
    { eventType: "refund.requested", webhookUrl: "https://staging-receiver.ophirpay.internal/hooks/refunds" },
    { eventType: "multisig.approval_required", webhookUrl: "https://staging-receiver.ophirpay.internal/hooks/multisig" },
  ];

  for (const h of stgHooks) {
    await prisma.notificationHook.create({
      data: {
        userId: merchantUser.id,
        eventType: h.eventType,
        webhookUrl: h.webhookUrl,
        active: true,
      },
    });
    summary.hooksCount++;
  }

  // 12. ApiKeys & Logs
  const apiKeySanitized = sanitizeApiKey("test_secret_key_developer_seed");
  const apiKey = await prisma.apiKey.create({
    data: {
      userId: devUser.id,
      name: "Staging CI Integration Bot",
      prefix: apiKeySanitized.prefix,
      keyHash: apiKeySanitized.keyHash,
      scopes: ["read:payments", "write:payments", "admin:webhooks"],
      lastUsed: new Date(Date.now() - 3600000),
    },
  });
  summary.apiKeysCount++;

  await prisma.apiKeyRequestLog.create({
    data: {
      keyId: apiKey.id,
      createdAt: new Date(Date.now() - 3600000),
    },
  });
  summary.apiKeyLogsCount++;

  // 13. PaymentSyncRuns
  await prisma.paymentSyncRun.create({
    data: {
      trigger: "cron",
      status: "success",
      scanned: 15,
      confirmed: 12,
      failed: 2,
      notFound: 1,
      errors: 0,
      createdAt: new Date(Date.now() - 7200000),
      completedAt: new Date(Date.now() - 7140000),
    },
  });
  summary.syncRunsCount++;

  // ── Profile: Load (Bulk generation for load testing / pagination) ─
  if (options.profile === "load") {
    console.log("Generating additional 100 bulk payment records for load testing...");
    const bulkPaymentsData = [];
    for (let i = 1; i <= 100; i++) {
      bulkPaymentsData.push({
        userId: devUser.id,
        amount: Math.round((Math.random() * 500 + 5) * 100) / 100,
        assetCode: i % 3 === 0 ? "USDC" : "XLM",
        description: `Load Test Payment #${i}`,
        status: i % 5 === 0 ? ("FAILED" as const) : ("COMPLETED" as const),
        transactionHash: `tx-bulk-${i}-${createHash("sha256").update(String(i)).digest("hex").slice(0, 16)}`,
        createdAt: generatePastDate(30),
      });
    }

    for (const b of bulkPaymentsData) {
      await prisma.payment.create({ data: b });
      summary.paymentsCount++;
    }
  }

  return summary;
}

export async function main(): Promise<void> {
  const options = parseSeedOptions();
  console.log(`[OphirPay Seed] Starting seed execution with profile: "${options.profile}"...`);

  // Safety barrier check
  assertSafeDatabaseUrl(process.env.DATABASE_URL, process.env);

  const prisma = new PrismaClient();
  try {
    const summary = await runSeed(prisma, options);
    console.log("=================================================");
    console.log(`[OphirPay Seed] Successfully completed!`);
    console.log(`- Profile:              ${summary.profile}`);
    console.log(`- Users:                ${summary.usersCount}`);
    console.log(`- Accounts:             ${summary.accountsCount}`);
    console.log(`- Payments:             ${summary.paymentsCount}`);
    console.log(`- Batches:              ${summary.batchesCount}`);
    console.log(`- Recurrences:          ${summary.recurrencesCount}`);
    console.log(`- Scheduled Payments:   ${summary.scheduledPaymentsCount}`);
    console.log(`- Payment Requests:     ${summary.paymentRequestsCount}`);
    console.log(`- Refunds:              ${summary.refundsCount}`);
    console.log(`- Webhooks:             ${summary.webhooksCount}`);
    console.log(`- Webhook Deliveries:   ${summary.webhookDeliveriesCount}`);
    console.log(`- Audit Logs:           ${summary.auditLogsCount}`);
    console.log(`- API Keys:             ${summary.apiKeysCount}`);
    console.log(`- Sync Runs:            ${summary.syncRunsCount}`);
    if (summary.sanitizedCount > 0) {
      console.log(`- Sanitized Records:    ${summary.sanitizedCount}`);
    }
    console.log("=================================================");
  } finally {
    await prisma.$disconnect();
  }
}

// Automatically invoke if executed directly via tsx/node
if (process.env.NODE_ENV !== "test" && !process.env.VITEST) {
  main().catch((err) => {
    console.error("[OphirPay Seed Error]:", err);
    process.exit(1);
  });
}
