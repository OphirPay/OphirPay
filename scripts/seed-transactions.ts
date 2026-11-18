// SPDX-License-Identifier: MIT

/**
 * Seed script to generate mock Stellar testnet transactions and scheduled payments.
 *
 * Populates local development and staging databases with realistic transactions
 * across multiple Stellar assets (native XLM, USDC, EURC) with varied statuses,
 * memos, and scheduled executions.
 *
 * Usage:
 *   npm run seed:transactions
 *   or: npx tsx scripts/seed-transactions.ts
 */

import { Keypair } from "@stellar/stellar-sdk";
import { PrismaClient, PaymentStatus, ScheduledPaymentStatus } from "@prisma/client";
import { assertSafeDatabaseUrl } from "../prisma/seed";

export interface MockPaymentSeed {
  id: string;
  amount: string;
  assetCode: string;
  assetIssuer?: string;
  payerAddress: string;
  payeeAddress: string;
  memo: string;
  description: string;
  status: PaymentStatus;
  transactionHash?: string;
}

export interface MockScheduledSeed {
  id: string;
  amount: string;
  assetCode: string;
  assetIssuer?: string;
  destAddress: string;
  memo: string;
  description: string;
  scheduledAt: Date;
  status: ScheduledPaymentStatus;
}

/**
 * Generates mock transaction datasets using @stellar/stellar-sdk keypairs and hashes.
 */
export function generateMockDatasets(): {
  payments: MockPaymentSeed[];
  scheduled: MockScheduledSeed[];
} {
  const payer1 = Keypair.random().publicKey();
  const payee1 = Keypair.random().publicKey();
  const payee2 = Keypair.random().publicKey();

  const testnetUsdcIssuer = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
  const testnetEurcIssuer = "GD6WTRX47DEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";

  const payments: MockPaymentSeed[] = [
    {
      id: "seed_pay_001_xlm",
      amount: "150.0000000",
      assetCode: "XLM",
      payerAddress: payer1,
      payeeAddress: payee1,
      memo: "INV-2026-XLM-01",
      description: "Direct XLM payment for design services",
      status: PaymentStatus.COMPLETED,
      transactionHash: Keypair.random().rawPublicKey().toString("hex"),
    },
    {
      id: "seed_pay_002_usdc",
      amount: "45.2500000",
      assetCode: "USDC",
      assetIssuer: testnetUsdcIssuer,
      payerAddress: payer1,
      payeeAddress: payee2,
      memo: "COFFEE-SUB-108",
      description: "Monthly recurring coffee subscription in USDC",
      status: PaymentStatus.COMPLETED,
      transactionHash: Keypair.random().rawPublicKey().toString("hex"),
    },
    {
      id: "seed_pay_003_eurc",
      amount: "210.7500000",
      assetCode: "EURC",
      assetIssuer: testnetEurcIssuer,
      payerAddress: payer1,
      payeeAddress: payee2,
      memo: "EU-VENDOR-PAY",
      description: "Euro cross-border vendor remittance",
      status: PaymentStatus.PENDING,
    },
    {
      id: "seed_pay_004_refund",
      amount: "12.5000000",
      assetCode: "XLM",
      payerAddress: payee1,
      payeeAddress: payer1,
      memo: "REFUND-ORD-302",
      description: "Customer return refund (cancelled payment)",
      status: PaymentStatus.CANCELLED,
      transactionHash: Keypair.random().rawPublicKey().toString("hex"),
    },
    {
      id: "seed_pay_005_treasury",
      amount: "5000.0000000",
      assetCode: "XLM",
      payerAddress: payer1,
      payeeAddress: payee1,
      memo: "DAO-TREASURY-ALLOC",
      description: "DAO liquidity allocation",
      status: PaymentStatus.COMPLETED,
      transactionHash: Keypair.random().rawPublicKey().toString("hex"),
    },
  ];

  const now = new Date();
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const nextWeek = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  const scheduled: MockScheduledSeed[] = [
    {
      id: "seed_sched_001_usdc",
      amount: "25.0000000",
      assetCode: "USDC",
      assetIssuer: testnetUsdcIssuer,
      destAddress: payee1,
      memo: "WEEKLY-ALLOWANCE",
      description: "Automated recurring allowance stream",
      scheduledAt: tomorrow,
      status: ScheduledPaymentStatus.SCHEDULED,
    },
    {
      id: "seed_sched_002_xlm",
      amount: "75.0000000",
      assetCode: "XLM",
      destAddress: payee2,
      memo: "CLOUD-INFRA-RECURRING",
      description: "Automated cloud host reimbursement",
      scheduledAt: nextWeek,
      status: ScheduledPaymentStatus.SCHEDULED,
    },
  ];

  return { payments, scheduled };
}

/**
 * Executes the transaction seeding process against PostgreSQL via Prisma.
 */
export async function seedTransactions(prismaClient?: PrismaClient): Promise<{
  paymentsCount: number;
  scheduledCount: number;
}> {
  const prisma = prismaClient || new PrismaClient();

  try {
    assertSafeDatabaseUrl(process.env.DATABASE_URL);

    console.log("🌱 Generating mock Stellar testnet transactions...");

    // 1. Ensure a default developer/demo user exists
    let user = await prisma.user.findFirst();
    if (!user) {
      console.log("   Creating mock developer user...");
      user = await prisma.user.create({
        data: {
          id: "dev_mock_user_1",
          email: "dev@ophirpay.local",
          name: "Local Developer",
        },
      });
    }

    const { payments, scheduled } = generateMockDatasets();

    // 2. Upsert payment records
    for (const p of payments) {
      await prisma.payment.upsert({
        where: { id: p.id },
        update: {
          amount: p.amount,
          assetCode: p.assetCode,
          assetIssuer: p.assetIssuer,
          memo: p.memo,
          description: p.description,
          status: p.status,
          transactionHash: p.transactionHash,
        },
        create: {
          id: p.id,
          userId: user.id,
          amount: p.amount,
          assetCode: p.assetCode,
          assetIssuer: p.assetIssuer,
          memo: p.memo,
          description: p.description,
          status: p.status,
          transactionHash: p.transactionHash,
        },
      });
    }
    console.log(`✅ Seeded ${payments.length} mock payments (XLM, USDC, EURC).`);

    // 3. Upsert scheduled payment records
    for (const s of scheduled) {
      await prisma.scheduledPayment.upsert({
        where: { id: s.id },
        update: {
          amount: s.amount,
          assetCode: s.assetCode,
          assetIssuer: s.assetIssuer,
          destAddress: s.destAddress,
          memo: s.memo,
          description: s.description,
          scheduledAt: s.scheduledAt,
          status: s.status,
        },
        create: {
          id: s.id,
          userId: user.id,
          amount: s.amount,
          assetCode: s.assetCode,
          assetIssuer: s.assetIssuer,
          destAddress: s.destAddress,
          memo: s.memo,
          description: s.description,
          scheduledAt: s.scheduledAt,
          status: s.status,
        },
      });
    }
    console.log(`✅ Seeded ${scheduled.length} mock scheduled/stream payments.`);
    console.log("\n🚀 Dashboard is now populated with realistic testnet transaction data!");

    return {
      paymentsCount: payments.length,
      scheduledCount: scheduled.length,
    };
  } finally {
    if (!prismaClient) {
      await prisma.$disconnect();
    }
  }
}

// Auto-run when executed directly via CLI
if (process.env.NODE_ENV !== "test" && typeof require !== "undefined" && require.main === module) {
  seedTransactions().catch((err) => {
    console.error("❌ Failed to seed transactions:", err);
    process.exit(1);
  });
}
