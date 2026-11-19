// SPDX-License-Identifier: MIT
import { PrismaClient, Prisma, BatchStatus, RequestStatus, PaymentStatus } from "@prisma/client";

export const prisma = new PrismaClient();

export type SeedProfile = "minimal" | "staging" | "load";

/**
 * Detect whether a database connection string points to a production database.
 * Rejects common production hostnames, cloud providers, and naming conventions
 * unless explicitly tagged as staging, dev, or test.
 */
export function isProductionDatabaseUrl(url?: string): boolean {
  if (!url) return false;
  const lower = url.toLowerCase();

  // Explicit staging / dev / test / local indicators take precedence
  const isStagingOrDev =
    lower.includes("staging") ||
    lower.includes("localhost") ||
    lower.includes("127.0.0.1") ||
    lower.includes("dev.db") ||
    lower.includes("test") ||
    lower.includes("sandbox") ||
    lower.includes("local");

  // Production domain patterns
  const hasProdCloudHost =
    lower.includes("rds.amazonaws.com") ||
    lower.includes("supabase.co") ||
    lower.includes("neon.tech") ||
    lower.includes("cockroachlabs.cloud") ||
    lower.includes("planetscale.com");

  // Production keywords
  const hasProdKeyword =
    /(?:^|[-_./?&=@:])(prod|production|mainnet|live)(?:[-_./?&=@:]|$)/i.test(lower);

  if (hasProdKeyword && !isStagingOrDev) {
    return true;
  }

  if (hasProdCloudHost && !isStagingOrDev) {
    return true;
  }

  return false;
}

/**
 * Asserts that the target database is not production.
 */
export function assertSafeDatabaseUrl(url?: string): void {
  const targetUrl = url || process.env.DATABASE_URL || "";
  if (isProductionDatabaseUrl(targetUrl)) {
    throw new Error(
      `[SAFETY HALT] Refusing to seed database: DATABASE_URL appears to target a production environment (${targetUrl}). Seeding is restricted to local and staging environments.`
    );
  }
}

/**
 * Parse CLI seed profile arguments (--profile=staging, --profile=minimal, --profile=load).
 */
export function parseProfile(args: string[] = process.argv): SeedProfile {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg?.startsWith("--profile=")) {
      const p = arg.split("=")[1]?.toLowerCase();
      if (p === "staging" || p === "minimal" || p === "load") {
        return p;
      }
    } else if (arg === "--profile" && args[i + 1]) {
      const p = args[i + 1]?.toLowerCase();
      if (p === "staging" || p === "minimal" || p === "load") {
        return p;
      }
    }
  }

  const envProfile = process.env.SEED_PROFILE?.toLowerCase();
  if (envProfile === "staging" || envProfile === "load") {
    return envProfile;
  }

  return "minimal";
}

/** Helper to generate dates spanning past 30 days */
function pastDate(daysAgo: number, hoursOffset = 0): Date {
  const date = new Date();
  date.setDate(date.getDate() - daysAgo);
  date.setHours(date.getHours() - hoursOffset);
  return date;
}

/** Helper to generate future dates */
function futureDate(daysAhead: number, hoursOffset = 0): Date {
  const date = new Date();
  date.setDate(date.getDate() + daysAhead);
  date.setHours(date.getHours() + hoursOffset);
  return date;
}

// ── Minimal Profile ──────────────────────────────────────────────
async function seedMinimal() {
  console.log("Seeding with 'minimal' profile...");

  const user = await prisma.user.upsert({
    where: { id: "seed-user-1" },
    update: {},
    create: {
      id: "seed-user-1",
      name: "OphirPay Demo",
      stellarAddress: "GACZ7ZELCUC5YGJ6JHIVLEZNR3XKYKOVUWD6H3IRFPRZMALNUYJZQM2U",
      email: "demo@example.com",
    },
  });

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
        transactionHash: "seed-tx-hash-minimal",
      },
    });
    createdPayments.push({ id: payment.id, amount: payment.amount });
  }

  await prisma.batch.create({
    data: {
      name: "Demo Batch — Monthly Payroll",
      description: "Sample batch payment for demo purposes",
      userId: user.id,
      status: "COMPLETED",
    },
  });

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
  }

  const hooks = [
    { eventType: "payment_recorded", webhookUrl: "https://example.com/webhooks/payments" },
    { eventType: "refund_processed", webhookUrl: "https://example.com/webhooks/refunds" },
    { eventType: "escrow_created", webhookUrl: "https://example.com/webhooks/escrows" },
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
  }

  console.log(`[Minimal Profile] Seeded: 1 user, ${createdPayments.length} payments, 1 batch, ${refunds.length} refunds, ${hooks.length} hooks`);
}

// ── Staging Profile ──────────────────────────────────────────────
async function seedStaging() {
  console.log("Seeding with 'staging' profile (comprehensive multi-user test data)...");

  // 1. Multi-user personas
  const users = [
    {
      id: "seed-user-merchant",
      name: "OphirPay Staging Merchant",
      email: "merchant@staging.ophirpay.example.com",
      stellarAddress: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
    },
    {
      id: "seed-user-buyer",
      name: "Staging Buyer Alice",
      email: "alice@staging.ophirpay.example.com",
      stellarAddress: "GCZ74M52C6WSZ3QJ2X7QW237J3F2QYGL33N2B5G7NNDP3NPYM2F2327D",
    },
    {
      id: "seed-user-approver",
      name: "Multisig Approver Bob",
      email: "bob@staging.ophirpay.example.com",
      stellarAddress: "GDQER2U65LGLV6PXY3V22VWV7Y4W63P6F4P5W6G6Q72R4V7V5Q5R3S5T",
    },
    {
      id: "seed-user-auditor",
      name: "Compliance Auditor Carol",
      email: "carol@staging.ophirpay.example.com",
      stellarAddress: "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
    },
  ];

  const createdUsers: Record<string, string> = {};
  for (const u of users) {
    const user = await prisma.user.upsert({
      where: { id: u.id },
      update: { name: u.name, email: u.email, stellarAddress: u.stellarAddress },
      create: u,
    });
    createdUsers[u.id] = user.id;
  }

  // 2. Realistic dummy transactions spanning the past 30 days
  const merchantId = createdUsers["seed-user-merchant"]!;
  const buyerId = createdUsers["seed-user-buyer"]!;

  const stagingPayments = [
    { amount: 1250.5, asset: "XLM", desc: "Software License Renewal - Annual", status: "COMPLETED" as const, daysAgo: 28 },
    { amount: 350.0, asset: "USDC", desc: "Cloud Infrastructure Hosting Invoice #1024", status: "COMPLETED" as const, daysAgo: 25 },
    { amount: 75.0, asset: "XLM", desc: "API Gateway Micro-transaction Tier 2", status: "COMPLETED" as const, daysAgo: 21 },
    { amount: 5000.0, asset: "USDC", desc: "Smart Contract Escrow Deposit #89", status: "COMPLETED" as const, daysAgo: 18 },
    { amount: 200.0, asset: "EURC", desc: "Consulting Retainer Payment", status: "COMPLETED" as const, daysAgo: 15 },
    { amount: 15.0, asset: "XLM", desc: "Testnet Faucet Relay Verification", status: "COMPLETED" as const, daysAgo: 12 },
    { amount: 850.0, asset: "USDC", desc: "Hardware Wallet Order #49281", status: "COMPLETED" as const, daysAgo: 8 },
    { amount: 320.0, asset: "XLM", desc: "Payment Stream Initialization (100 days)", status: "COMPLETED" as const, daysAgo: 5 },
    { amount: 180.0, asset: "USDC", desc: "Pending Merchant Settlement", status: "PENDING" as const, daysAgo: 2 },
    { amount: 95.0, asset: "XLM", desc: "Unconfirmed Cross-border Settlement", status: "PENDING" as const, daysAgo: 1 },
    { amount: 1200.0, asset: "USDC", desc: "Failed Liquidity Rebalance - Low Balance", status: "FAILED" as const, daysAgo: 10 },
    { amount: 450.0, asset: "XLM", desc: "Aborted Transfer - Sequence Expired", status: "FAILED" as const, daysAgo: 4 },
  ];

  const createdPayments: Array<{ id: string; amount: Prisma.Decimal; userId: string }> = [];
  for (let i = 0; i < stagingPayments.length; i++) {
    const sp = stagingPayments[i]!;
    const userId = i % 2 === 0 ? merchantId : buyerId;
    const payment = await prisma.payment.create({
      data: {
        amount: sp.amount,
        assetCode: sp.asset,
        description: sp.desc,
        status: sp.status,
        userId,
        transactionHash: `0x7a${i}b84920c8f1e739572b834719284729103847291038472910384729103847${i}`,
        createdAt: pastDate(sp.daysAgo, i),
      },
    });
    createdPayments.push({ id: payment.id, amount: payment.amount, userId });
  }

  // 3. Batches
  const stagingBatches: Array<{ name: string; desc: string; status: BatchStatus; daysAgo: number }> = [
    { name: "October Contractor Payouts", desc: "Disbursement batch for core engineering contractors", status: BatchStatus.COMPLETED, daysAgo: 14 },
    { name: "Bi-Weekly Community Grants", desc: "Wave 10 ecosystem mini-grant distributions", status: BatchStatus.COMPLETED, daysAgo: 7 },
    { name: "Vendor Invoices Batch #41", desc: "Monthly SaaS operational expenses", status: BatchStatus.PROCESSING, daysAgo: 1 },
  ];

  for (const b of stagingBatches) {
    await prisma.batch.create({
      data: {
        name: b.name,
        description: b.desc,
        userId: merchantId,
        status: b.status,
        createdAt: pastDate(b.daysAgo),
      },
    });
  }

  // 4. Recurrences & Scheduled Payments
  const recurrence = await prisma.recurrence.create({
    data: {
      userId: merchantId,
      name: "Staging Infrastructure Retainer",
      frequency: "MONTHLY",
      amount: 1500,
      assetCode: "USDC",
      destAddress: "GCZ74M52C6WSZ3QJ2X7QW237J3F2QYGL33N2B5G7NNDP3NPYM2F2327D",
      nextRunAt: futureDate(14),
      isActive: true,
      createdAt: pastDate(30),
    },
  });

  await prisma.scheduledPayment.create({
    data: {
      userId: buyerId,
      amount: 250,
      assetCode: "XLM",
      destAddress: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
      scheduledAt: futureDate(3),
      status: "SCHEDULED",
      description: "Scheduled milestone payment for audit review",
      createdAt: pastDate(2),
    },
  });

  // 5. Payment Requests / Links
  const paymentRequests: Array<{ description: string; amount: number; status: RequestStatus; daysAgo: number }> = [
    { description: "Consulting Invoice #701", amount: 1200, status: RequestStatus.PENDING, daysAgo: 3 },
    { description: "Donation Campaign — Clean Oceans", amount: 50, status: RequestStatus.PAID, daysAgo: 10 },
    { description: "Expired Booking Reservation", amount: 300, status: RequestStatus.EXPIRED, daysAgo: 20 },
  ];

  for (const pr of paymentRequests) {
    await prisma.paymentRequest.create({
      data: {
        userId: merchantId,
        description: pr.description,
        amount: pr.amount,
        assetCode: "USDC",
        status: pr.status,
        createdAt: pastDate(pr.daysAgo),
      },
    });
  }

  // 6. Refunds across multiple reasons and statuses
  const stagingRefunds = [
    { pIdx: 0, reason: "Duplicate billing during checkout error", reasonCode: 2, status: "PROCESSED" as const, daysAgo: 24 },
    { pIdx: 1, reason: "Service agreement cancelled within cooling-off period", reasonCode: 1, status: "APPROVED" as const, daysAgo: 16 },
    { pIdx: 2, reason: "Defective software module delivery", reasonCode: 0, status: "REQUESTED" as const, daysAgo: 5 },
    { pIdx: 3, reason: "Unrecognized card payment reported", reasonCode: 3, status: "REJECTED" as const, daysAgo: 12 },
  ];

  for (const sr of stagingRefunds) {
    const payment = createdPayments[sr.pIdx];
    if (!payment) continue;
    await prisma.refund.create({
      data: {
        userId: payment.userId,
        paymentId: payment.id,
        amount: payment.amount,
        reason: sr.reason,
        reasonCode: sr.reasonCode,
        status: sr.status,
        asset: "native",
        createdAt: pastDate(sr.daysAgo),
        resolvedAt: sr.status === "PROCESSED" || sr.status === "REJECTED" ? pastDate(sr.daysAgo - 1) : null,
      },
    });
  }

  // 7. Webhook & Deliveries (Sanitized URLs)
  const webhook = await prisma.webhook.create({
    data: {
      userId: merchantId,
      url: "https://staging.merchant.example.com/api/ophirpay-webhooks",
      events: JSON.stringify(["payment.created", "refund.processed", "escrow.funded"]),
      isActive: true,
      secret: "whsec_staging_test_secret_32bytes_sanitized_abc",
      createdAt: pastDate(29),
    },
  });

  const webhookEvent = await prisma.webhookEvent.create({
    data: {
      userId: merchantId,
      event: "payment.created",
      timestamp: pastDate(18),
      data: JSON.stringify({ paymentId: createdPayments[0]?.id, status: "COMPLETED" }),
      createdAt: pastDate(18),
    },
  });

  await prisma.webhookDelivery.create({
    data: {
      webhookId: webhook.id,
      eventId: webhookEvent.id,
      status: "SUCCESS",
      responseCode: 200,
      latencyMs: 142,
      attempts: 1,
      targetUrl: webhook.url,
      deliveredAt: pastDate(18),
    },
  });

  // 8. Audit Logs
  const auditEntries = [
    { action: "user.auth.login", actor: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5", details: "Merchant signed in via Freighter on Stellar Testnet", daysAgo: 30 },
    { action: "multisig.proposal.created", actor: "GDQER2U65LGLV6PXY3V22VWV7Y4W63P6F4P5W6G6Q72R4V7V5Q5R3S5T", details: "Proposed withdrawal: 5000 USDC to contractor pool", daysAgo: 14 },
    { action: "multisig.proposal.approved", actor: "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN", details: "Auditor co-signed proposal #42 (threshold 2/3 met)", daysAgo: 13 },
    { action: "webhook.endpoint.updated", actor: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5", details: "Updated webhook destination URL to staging endpoint", daysAgo: 7 },
  ];

  for (const ae of auditEntries) {
    await prisma.auditLog.create({
      data: {
        action: ae.action,
        actor: ae.actor,
        target: merchantId,
        details: { description: ae.details },
        createdAt: pastDate(ae.daysAgo),
      },
    });
  }

  // 9. Sanitized API Keys (No real secrets seeded)
  await prisma.apiKey.create({
    data: {
      userId: merchantId,
      name: "Staging Integration Testing Key",
      prefix: "oph_stg_",
      keyHash: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      scopes: ["payments:read", "payments:write", "webhooks:read"],
      createdAt: pastDate(25),
    },
  });

  console.log(
    `[Staging Profile] Seeded: ${users.length} users, ${createdPayments.length} payments, ${stagingBatches.length} batches, 1 recurrence, 1 scheduled payment, ${paymentRequests.length} payment requests, ${stagingRefunds.length} refunds, 1 webhook + delivery, ${auditEntries.length} audit logs, 1 API key.`
  );
}

// ── Load Profile ────────────────────────────────────────────────
async function seedLoad() {
  console.log("Seeding with 'load' profile (high-volume synthetic payments)...");

  const user = await prisma.user.upsert({
    where: { id: "seed-user-load" },
    update: {},
    create: {
      id: "seed-user-load",
      name: "OphirPay Load Testing User",
      stellarAddress: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
      email: "loadtest@staging.ophirpay.example.com",
    },
  });

  const batchCount = 5;
  const paymentsPerBatch = 15;
  let totalPayments = 0;

  for (let b = 1; b <= batchCount; b++) {
    const batch = await prisma.batch.create({
      data: {
        name: `Load Test Batch #${b}`,
        description: `Synthetic load batch #${b}`,
        userId: user.id,
        status: b === batchCount ? BatchStatus.PROCESSING : BatchStatus.COMPLETED,
        createdAt: pastDate(b * 3),
      },
    });

    for (let p = 1; p <= paymentsPerBatch; p++) {
      await prisma.payment.create({
        data: {
          batchId: batch.id,
          userId: user.id,
          amount: (p * 10.5).toFixed(2),
          assetCode: p % 2 === 0 ? "USDC" : "XLM",
          description: `Load synthetic payment B${b}-P${p}`,
          status: p % 10 === 0 ? "FAILED" : p % 7 === 0 ? "PENDING" : "COMPLETED",
          transactionHash: `0xload${b}${p}739281749281749281749281749281749281749281749281749281`,
          createdAt: pastDate(b * 3, p),
        },
      });
      totalPayments++;
    }
  }

  console.log(`[Load Profile] Seeded: 1 user, ${batchCount} batches, ${totalPayments} payments.`);
}

export async function main() {
  assertSafeDatabaseUrl();
  const profile = parseProfile();

  switch (profile) {
    case "staging":
      await seedStaging();
      break;
    case "load":
      await seedLoad();
      break;
    case "minimal":
    default:
      await seedMinimal();
      break;
  }
}

if (process.env.NODE_ENV !== "test") {
  main()
    .catch((e) => {
      console.error("Seed error:", e);
      process.exit(1);
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
