import { PrismaClient, Prisma, PaymentStatus, BatchStatus, RefundStatus } from "@prisma/client";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

export type SeedProfile = "staging" | "minimal" | "load";

export const VALID_STELLAR_PUBLIC_KEY_REGEX = /^G[A-Z2-7]{55}$/;
const STELLAR_SECRET_SEED_REGEX = /\bS[A-Z2-7]{55}\b/g;
const LIVE_API_KEY_REGEX = /\b(?:sk_live_[A-Za-z0-9]+|pk_live_[A-Za-z0-9]+|whsec_live_[A-Za-z0-9]+|ophir_live_[A-Za-z0-9]+)\b/gi;
const EMAIL_REGEX = /\b([A-Za-z0-9._%+-]+)@([A-Za-z0-9.-]+\.[A-Za-z]{2,})\b/g;

export const TESTNET_PUBLIC_KEYS = [
  "GACZ7ZELCUC5YGJ6JHIVLEZNR3XKYKOVUWD6H3IRFPRZMALNUYJZQM2U",
  "GBBM6BKZPEHWYO3E3YKREDPQXMS4VK35YLNU7NFBRI26RAN7GI5POFBB",
  "GCEZWKCA5VLDNRLN3RPRJMRZOX3Z6G5CHCGSNFHEYVXM3XOJMDS674JZ",
  "GD5DJQDDBKGAYNEAXU562HYGOOSYAEOO6AS53PZXBOZGCP5M2OPGMZV3",
  "GA7YNBW5CBTJZ3ZZOWX3ZNBKD6OE7A7IHUQVWMY62W2ZBG2SGZVOOPVH",
  "GBDEVU63Y6NTHJQQZIKVTC23NWLQVP3WJ2RI2OTSJTNYOIGICST6DUXR",
] as const;

const PRODUCTION_DB_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /(?:^|[\W_-])prod(?:uction)?(?:[\W_-]|$)/i, label: "production identifier in DATABASE_URL" },
  { pattern: /\.rds\.amazonaws\.com/i, label: "AWS RDS host in DATABASE_URL" },
  { pattern: /\.supabase\.co/i, label: "Supabase hosted instance in DATABASE_URL" },
  { pattern: /\.aws\.neon\.tech/i, label: "Neon AWS cloud host in DATABASE_URL" },
  { pattern: /mainnet/i, label: "mainnet identifier in DATABASE_URL" },
];

export interface SeedUserRecord {
  id: string;
  name: string;
  email: string;
  stellarAddress: string;
}

export interface SeedAccountRecord {
  id: string;
  userId: string;
  name: string;
  publicKey: string;
  isActive: boolean;
}

export interface SeedPaymentRecord {
  id: string;
  userId: string;
  amount: number;
  assetCode: string;
  description: string;
  status: PaymentStatus;
  transactionHash: string;
  createdAt: Date;
  completedAt: Date | null;
  metadata: string;
}

export interface SeedEscrowRecord {
  id: string;
  depositorAddress: string;
  beneficiaryAddress: string;
  arbiterAddress: string;
  amount: number;
  assetCode: string;
  status: "ACTIVE" | "PARTIALLY_RELEASED" | "DISPUTED";
  createdAt: Date;
  expiresAt: Date;
  contactEmail: string;
}

export interface SeedStreamRecord {
  id: string;
  senderAddress: string;
  recipientAddress: string;
  totalAmount: number;
  vestedAmount: number;
  vestedPercentage: number;
  assetCode: string;
  status: "STREAMING" | "PAUSED";
  startedAt: Date;
  cliffAt: Date;
  endsAt: Date;
}

export interface SeedMultiSigQueueRecord {
  id: string;
  operationType: "LARGE_PAYOUT" | "ESCROW_RELEASE" | "TREASURY_REBALANCE";
  proposerAddress: string;
  signers: string[];
  approvalsReceived: number;
  threshold: number;
  status: "PENDING_APPROVALS" | "READY_TO_EXECUTE";
  createdAt: Date;
}

export interface SeedDataset {
  profile: SeedProfile;
  users: SeedUserRecord[];
  accounts: SeedAccountRecord[];
  payments: SeedPaymentRecord[];
  batches: Array<{ id: string; userId: string; name: string; description: string; status: BatchStatus }>;
  refunds: Array<{
    paymentIndex: number;
    reason: string;
    reasonCode: number;
    status: RefundStatus;
    asset: string;
  }>;
  hooks: Array<{ eventType: string; webhookUrl: string }>;
  escrows: SeedEscrowRecord[];
  streams: SeedStreamRecord[];
  multiSigQueue: SeedMultiSigQueueRecord[];
}

export function parseSeedProfile(
  args: readonly string[] = process.argv.slice(2),
  envProfile: string | undefined = process.env.SEED_PROFILE,
): SeedProfile {
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg.startsWith("--profile=")) {
      const value = arg.slice("--profile=".length).trim().toLowerCase();
      if (value === "staging" || value === "minimal" || value === "load") {
        return value;
      }
      throw new Error(`Invalid seed profile "${value}". Expected one of: staging, minimal, load.`);
    }
    if (arg === "--profile" && args[i + 1]) {
      const value = args[i + 1].trim().toLowerCase();
      if (value === "staging" || value === "minimal" || value === "load") {
        return value;
      }
      throw new Error(`Invalid seed profile "${value}". Expected one of: staging, minimal, load.`);
    }
  }

  if (envProfile) {
    const normalized = envProfile.trim().toLowerCase();
    if (normalized === "staging" || normalized === "minimal" || normalized === "load") {
      return normalized;
    }
    throw new Error(`Invalid SEED_PROFILE "${envProfile}". Expected one of: staging, minimal, load.`);
  }

  return "staging";
}

export function validateSafeSeedDatabaseUrl(
  databaseUrl: string | undefined = process.env.DATABASE_URL,
  nodeEnv: string | undefined = process.env.NODE_ENV,
): { safe: boolean; reason?: string } {
  if (nodeEnv && nodeEnv.trim().toLowerCase() === "production") {
    return {
      safe: false,
      reason: "Refusing to seed when NODE_ENV is set to 'production'.",
    };
  }

  if (!databaseUrl || databaseUrl.trim().length === 0) {
    return {
      safe: false,
      reason: "DATABASE_URL is missing or empty.",
    };
  }

  for (const { pattern, label } of PRODUCTION_DB_PATTERNS) {
    if (pattern.test(databaseUrl)) {
      return {
        safe: false,
        reason: `Refusing to seed database: detected ${label}.`,
      };
    }
  }

  return { safe: true };
}

export function sanitizeSeedString(value: string): string {
  return value
    .replace(STELLAR_SECRET_SEED_REGEX, "[REDACTED_STELLAR_SECRET]")
    .replace(LIVE_API_KEY_REGEX, "test_sanitized_key_000000")
    .replace(EMAIL_REGEX, (_full, localPart: string, domain: string) => {
      if (domain.toLowerCase() === "example.test") {
        return `${localPart.toLowerCase()}@example.test`;
      }
      const cleanLocal = localPart.replace(/[^a-zA-Z0-9._-]/g, "").toLowerCase() || "sanitized-user";
      return `${cleanLocal}@example.test`;
    });
}

export function sanitizeSeedRecord<T>(record: T): T {
  if (typeof record === "string") {
    return sanitizeSeedString(record) as unknown as T;
  }
  if (record instanceof Date || record === null || record === undefined || typeof record !== "object") {
    return record;
  }
  if (Array.isArray(record)) {
    return record.map((item) => sanitizeSeedRecord(item)) as unknown as T;
  }

  const output: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(record as Record<string, unknown>)) {
    if (/secret|privatekey|rawkey|password|token/i.test(key) && typeof val === "string") {
      output[key] = "sanitized_placeholder_do_not_use";
    } else {
      output[key] = sanitizeSeedRecord(val);
    }
  }
  return output as T;
}

export function buildSeedDataset(
  profile: SeedProfile = "staging",
  referenceDate: Date = new Date("2026-10-15T12:00:00.000Z"),
): SeedDataset {
  const counts = {
    minimal: { users: 1, payments: 5, escrows: 1, streams: 1, multiSig: 1 },
    staging: { users: 3, payments: 30, escrows: 4, streams: 4, multiSig: 3 },
    load: { users: 6, payments: 120, escrows: 8, streams: 8, multiSig: 6 },
  }[profile];

  const users: SeedUserRecord[] = Array.from({ length: counts.users }, (_, idx) => ({
    id: `seed-user-${idx + 1}`,
    name: idx === 0 ? "OphirPay Demo" : `OphirPay Staging Operator ${idx + 1}`,
    email: `operator-${idx + 1}@example.test`,
    stellarAddress: TESTNET_PUBLIC_KEYS[idx % TESTNET_PUBLIC_KEYS.length],
  }));

  const accounts: SeedAccountRecord[] = users.map((u, idx) => ({
    id: `seed-account-${idx + 1}`,
    userId: u.id,
    name: idx === 0 ? "Primary Testnet Treasury" : `Operations Wallet #${idx + 1}`,
    publicKey: u.stellarAddress,
    isActive: true,
  }));

  const statusCycle: PaymentStatus[] = [
    "COMPLETED",
    "COMPLETED",
    "COMPLETED",
    "PENDING",
    "FAILED",
    "PROCESSING",
    "CONFIRMED",
    "SUBMITTED",
    "SIGNED",
    "CANCELLED",
  ];

  const assetCycle = ["XLM", "USDC", "XLM", "EURC", "XLM"];
  const descriptions = [
    "Monthly subscription payment",
    "Freelance invoice #42",
    "Vendor payment — cloud hosting",
    "Test payment",
    "Coffee fund contribution",
    "Cross-border contractor settlement",
    "Escrow milestone #1 tranche",
    "Streaming payroll settlement",
    "Multi-sig treasury disbursement",
    "API gateway usage settlement",
  ];

  const payments: SeedPaymentRecord[] = Array.from({ length: counts.payments }, (_, idx) => {
    const daysAgo = idx % 30;
    const hoursAgo = (idx * 3) % 24;
    const createdAt = new Date(
      referenceDate.getTime() - (daysAgo * 24 + hoursAgo) * 60 * 60 * 1000,
    );
    const status = statusCycle[idx % statusCycle.length];
    const completedAt =
      status === "COMPLETED" || status === "CONFIRMED"
        ? new Date(createdAt.getTime() + 45_000)
        : null;
    const owner = users[idx % users.length];
    const counterparty = TESTNET_PUBLIC_KEYS[(idx + 1) % TESTNET_PUBLIC_KEYS.length];
    const amount = [500, 250, 1500, 100, 75, 840.5, 1250, 42.25, 3100, 195][idx % 10];

    return {
      id: `seed-payment-${idx + 1}`,
      userId: owner.id,
      amount,
      assetCode: assetCycle[idx % assetCycle.length],
      description: descriptions[idx % descriptions.length],
      status,
      transactionHash: `seed-tx-${profile}-${String(idx + 1).padStart(4, "0")}`,
      createdAt,
      completedAt,
      metadata: JSON.stringify({
        seedProfile: profile,
        sourcePublicKey: owner.stellarAddress,
        destinationPublicKey: counterparty,
        contactEmail: owner.email,
      }),
    };
  });

  const escrows: SeedEscrowRecord[] = Array.from({ length: counts.escrows }, (_, idx) => {
    const createdAt = new Date(referenceDate.getTime() - (idx + 2) * 3 * 24 * 60 * 60 * 1000);
    const expiresAt = new Date(referenceDate.getTime() + (14 + idx * 7) * 24 * 60 * 60 * 1000);
    const statuses: SeedEscrowRecord["status"][] = ["ACTIVE", "PARTIALLY_RELEASED", "DISPUTED"];
    return {
      id: `seed-escrow-${idx + 1}`,
      depositorAddress: TESTNET_PUBLIC_KEYS[idx % TESTNET_PUBLIC_KEYS.length],
      beneficiaryAddress: TESTNET_PUBLIC_KEYS[(idx + 1) % TESTNET_PUBLIC_KEYS.length],
      arbiterAddress: TESTNET_PUBLIC_KEYS[(idx + 2) % TESTNET_PUBLIC_KEYS.length],
      amount: 1200 + idx * 450,
      assetCode: idx % 2 === 0 ? "USDC" : "XLM",
      status: statuses[idx % statuses.length],
      createdAt,
      expiresAt,
      contactEmail: `escrow-ops-${idx + 1}@example.test`,
    };
  });

  const streams: SeedStreamRecord[] = Array.from({ length: counts.streams }, (_, idx) => {
    const startedAt = new Date(referenceDate.getTime() - (15 + idx * 3) * 24 * 60 * 60 * 1000);
    const cliffAt = new Date(startedAt.getTime() + 5 * 24 * 60 * 60 * 1000);
    const endsAt = new Date(referenceDate.getTime() + (15 + idx * 5) * 24 * 60 * 60 * 1000);
    const totalAmount = 2000 + idx * 500;
    const vestedPercentage = [35, 50, 65, 80][idx % 4];
    const vestedAmount = Number(((totalAmount * vestedPercentage) / 100).toFixed(2));
    return {
      id: `seed-stream-${idx + 1}`,
      senderAddress: TESTNET_PUBLIC_KEYS[idx % TESTNET_PUBLIC_KEYS.length],
      recipientAddress: TESTNET_PUBLIC_KEYS[(idx + 2) % TESTNET_PUBLIC_KEYS.length],
      totalAmount,
      vestedAmount,
      vestedPercentage,
      assetCode: idx % 2 === 0 ? "XLM" : "USDC",
      status: idx % 3 === 2 ? "PAUSED" : "STREAMING",
      startedAt,
      cliffAt,
      endsAt,
    };
  });

  const multiSigQueue: SeedMultiSigQueueRecord[] = Array.from({ length: counts.multiSig }, (_, idx) => {
    const operationTypes: SeedMultiSigQueueRecord["operationType"][] = [
      "LARGE_PAYOUT",
      "ESCROW_RELEASE",
      "TREASURY_REBALANCE",
    ];
    const threshold = 3;
    const approvalsReceived = idx % 2 === 0 ? 1 : 2;
    return {
      id: `seed-multisig-${idx + 1}`,
      operationType: operationTypes[idx % operationTypes.length],
      proposerAddress: TESTNET_PUBLIC_KEYS[0],
      signers: [
        TESTNET_PUBLIC_KEYS[0],
        TESTNET_PUBLIC_KEYS[1],
        TESTNET_PUBLIC_KEYS[2],
      ],
      approvalsReceived,
      threshold,
      status: approvalsReceived >= threshold ? "READY_TO_EXECUTE" : "PENDING_APPROVALS",
      createdAt: new Date(referenceDate.getTime() - (idx + 1) * 36 * 60 * 60 * 1000),
    };
  });

  const batches = [
    {
      id: "seed-batch-1",
      userId: users[0].id,
      name: "Demo Batch — Monthly Payroll",
      description: "Sanitized staging batch payment for payroll simulation",
      status: "COMPLETED" as BatchStatus,
    },
    ...(profile !== "minimal"
      ? [
          {
            id: "seed-batch-2",
            userId: users[0].id,
            name: "Staging Batch — Vendor Settlements",
            description: "Multi-asset vendor payout batch",
            status: "PARTIALLY_COMPLETED" as BatchStatus,
          },
        ]
      : []),
  ];

  const refunds = [
    { paymentIndex: 0, reason: "Product arrived defective", reasonCode: 0, status: "PROCESSED" as RefundStatus, asset: "native" },
    { paymentIndex: 1, reason: "Never received the service", reasonCode: 1, status: "APPROVED" as RefundStatus, asset: "native" },
    { paymentIndex: 2, reason: "Charged twice by mistake", reasonCode: 2, status: "REQUESTED" as RefundStatus, asset: "native" },
    { paymentIndex: 3, reason: "Unauthorized transaction", reasonCode: 3, status: "REJECTED" as RefundStatus, asset: "native" },
  ];

  const hooks = [
    { eventType: "payment_recorded", webhookUrl: "https://example.test/webhooks/payments" },
    { eventType: "refund_processed", webhookUrl: "https://example.test/webhooks/refunds" },
    { eventType: "escrow_created", webhookUrl: "https://example.test/webhooks/escrows" },
  ];

  return sanitizeSeedRecord({
    profile,
    users,
    accounts,
    payments,
    batches,
    refunds,
    hooks,
    escrows,
    streams,
    multiSigQueue,
  });
}

export async function runSeed(options: {
  prismaClient?: PrismaClient;
  profile?: SeedProfile;
  databaseUrl?: string;
  nodeEnv?: string;
} = {}): Promise<SeedDataset> {
  const safety = validateSafeSeedDatabaseUrl(options.databaseUrl, options.nodeEnv);
  if (!safety.safe) {
    throw new Error(safety.reason || "Unsafe database URL rejected by staging seed guard.");
  }

  const profile = options.profile ?? parseSeedProfile();
  const dataset = buildSeedDataset(profile);
  const prisma = options.prismaClient ?? new PrismaClient();
  const shouldDisconnect = !options.prismaClient;

  try {
    console.log(`Seeding OphirPay database (profile: ${profile})...`);

    for (const u of dataset.users) {
      await prisma.user.upsert({
        where: { id: u.id },
        update: {
          name: u.name,
          email: u.email,
          stellarAddress: u.stellarAddress,
        },
        create: {
          id: u.id,
          name: u.name,
          email: u.email,
          stellarAddress: u.stellarAddress,
        },
      });
    }

    const createdPayments: { id: string; amount: Prisma.Decimal }[] = [];
    for (const p of dataset.payments) {
      const payment = await prisma.payment.create({
        data: {
          amount: p.amount,
          assetCode: p.assetCode,
          description: p.description,
          status: p.status,
          userId: p.userId,
          transactionHash: p.transactionHash,
          metadata: p.metadata,
          createdAt: p.createdAt,
          completedAt: p.completedAt,
        },
      });
      createdPayments.push({ id: payment.id, amount: payment.amount });
    }

    for (const b of dataset.batches) {
      await prisma.batch.create({
        data: {
          name: b.name,
          description: b.description,
          userId: b.userId,
          status: b.status,
        },
      });
    }

    for (const r of dataset.refunds) {
      const payment = createdPayments[r.paymentIndex];
      if (!payment) continue;
      await prisma.refund.create({
        data: {
          userId: dataset.users[0].id,
          paymentId: payment.id,
          amount: payment.amount,
          reason: r.reason,
          reasonCode: r.reasonCode,
          status: r.status,
          asset: r.asset,
          resolvedAt: r.status === "PROCESSED" || r.status === "REJECTED" ? new Date() : null,
        },
      });
    }

    for (const h of dataset.hooks) {
      await prisma.notificationHook.create({
        data: {
          userId: dataset.users[0].id,
          eventType: h.eventType,
          webhookUrl: h.webhookUrl,
          active: true,
        },
      });
    }

    for (const escrow of dataset.escrows) {
      await prisma.auditLog.create({
        data: {
          action: "escrow:seed",
          actor: dataset.users[0].id,
          target: escrow.id,
          details: escrow as unknown as Prisma.InputJsonValue,
        },
      });
    }

    for (const stream of dataset.streams) {
      await prisma.auditLog.create({
        data: {
          action: "stream:seed",
          actor: dataset.users[0].id,
          target: stream.id,
          details: stream as unknown as Prisma.InputJsonValue,
        },
      });
    }

    for (const approval of dataset.multiSigQueue) {
      await prisma.auditLog.create({
        data: {
          action: "multisig:seed",
          actor: dataset.users[0].id,
          target: approval.id,
          details: approval as unknown as Prisma.InputJsonValue,
        },
      });
    }

    console.log(
      `Seeded (${profile}): ${dataset.users.length} users, ${createdPayments.length} payments, ` +
        `${dataset.batches.length} batches, ${dataset.refunds.length} refunds, ` +
        `${dataset.escrows.length} escrows, ${dataset.streams.length} streams, ` +
        `${dataset.multiSigQueue.length} multi-sig items`,
    );

    return dataset;
  } finally {
    if (shouldDisconnect) {
      await prisma.$disconnect();
    }
  }
}

const isDirectExecution =
  typeof process !== "undefined" &&
  Array.isArray(process.argv) &&
  process.argv[1] &&
  resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1]);

if (isDirectExecution) {
  runSeed().catch((e) => {
    console.error("Seed error:", e);
    process.exit(1);
  });
}
