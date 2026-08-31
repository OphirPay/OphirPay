// SPDX-License-Identifier: MIT

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { execSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import { parseRecipientsCsv } from "@/lib/csv-import";

describe("Integration: Admin CSV Import with Testcontainers PostgreSQL", () => {
  let container: StartedPostgreSqlContainer;
  let prisma: PrismaClient;
  let databaseUrl: string;

  beforeAll(async () => {
    // Spin up a disposable PostgreSQL container (Postgres 16 Alpine)
    container = await new PostgreSqlContainer("postgres:16-alpine")
      .withDatabase("ophirpay_test")
      .withUsername("postgres")
      .withPassword("postgres")
      .start();

    const ipAddress = container.getIpAddress(container.getNetworkNames()[0]) || "127.0.0.1";
    const port = container.getMappedPort(5432);
    // Connect via container internal IP on 5432 or mapped port
    databaseUrl = `postgresql://postgres:postgres@${ipAddress}:5432/ophirpay_test`;

    // Push Prisma schema onto the live PostgreSQL container
    execSync(`npx prisma db push --skip-generate --accept-data-loss`, {
      env: {
        ...process.env,
        DATABASE_URL: databaseUrl,
      },
      stdio: "inherit",
    });

    prisma = new PrismaClient({
      datasources: {
        db: {
          url: databaseUrl,
        },
      },
    });

    await prisma.$connect();
  }, 60000);

  afterAll(async () => {
    if (prisma) {
      await prisma.$disconnect();
    }
    if (container) {
      await container.stop();
    }
  }, 30000);

  it("successfully parses CSV, inserts batch + payments into real PostgreSQL, and records audit log", async () => {
    // 1. Seed User and Account
    const user = await prisma.user.create({
      data: {
        email: "admin@ophirpay.com",
        name: "Admin User",
        stellarAddress: "GBWM6Z4V757X5X2R2S3W3E4J4ZJZ5Z6Z7Z8Z9Z0Z1Z2Z3Z4Z5Z6Z7Z8Z",
      },
    });

    const account = await prisma.account.create({
      data: {
        userId: user.id,
        publicKey: "GACZ7ZELCUC5YGJ6JHIVLEZNR3XKYKOVUWD6H3IRFPRZMALNUYJZQM2U",
        name: "Admin Treasury",
      },
    });

    // 2. Sample Admin CSV payload
    const csvContent = `address,amount,assetCode,memo
GDHJ3K2LQ7F5XQZPX6YWNMYKXWQXVZKBJZQFYX3F6KRLV4WDXHJMB2UY,150.5,XLM,payroll-001
GA5AZNWWOW5PXPNHBVRJOB2ZPZO3PXN5VTXTXOIJTACZZHE5ZA7CAH7H,275.0,XLM,payroll-002
`;

    // 3. Parse CSV into batch recipients
    const file = new File([csvContent], "recipients.csv", { type: "text/csv" });
    const parseResult = await parseRecipientsCsv(file);
    expect(parseResult.errors).toHaveLength(0);
    expect(parseResult.recipients).toHaveLength(2);

    const idempotencyKey = "admin-csv-import-key-001";
    const batchName = "Admin Batch Import";

    // 4. Perform atomic batch import transaction on real PostgreSQL
    const createdBatch = await prisma.$transaction(async (tx) => {
      const batch = await tx.batch.create({
        data: {
          name: batchName,
          description: "Imported via CSV by Admin",
          userId: user.id,
          idempotencyKey,
        },
      });

      await tx.payment.createMany({
        data: parseResult.recipients.map((r) => ({
          batchId: batch.id,
          userId: user.id,
          amount: r.amount,
          assetCode: r.assetCode || "XLM",
          memo: r.memo || "",
          status: "CREATED",
        })),
      });

      await tx.auditLog.create({
        data: {
          action: "batch:csv_import",
          actor: user.id,
          target: batch.id,
          details: {
            batchName,
            recipientCount: parseResult.recipients.length,
            idempotencyKey,
            sourceAccountId: account.id,
          },
        },
      });

      return tx.batch.findUnique({
        where: { id: batch.id },
        include: { payments: true },
      });
    });

    // 5. Assertions on real Postgres state
    expect(createdBatch).not.toBeNull();
    expect(createdBatch?.name).toBe(batchName);
    expect(createdBatch?.payments).toHaveLength(2);

    const payments = await prisma.payment.findMany({
      where: { batchId: createdBatch!.id },
      orderBy: { memo: "asc" },
    });

    expect(payments).toHaveLength(2);
    expect(Number(payments[0].amount)).toBe(150.5);
    expect(payments[0].memo).toBe("payroll-001");
    expect(Number(payments[1].amount)).toBe(275.0);
    expect(payments[1].memo).toBe("payroll-002");

    // 6. Assert AuditLog entry in PostgreSQL
    const auditEntries = await prisma.auditLog.findMany({
      where: { target: createdBatch!.id },
    });

    expect(auditEntries).toHaveLength(1);
    expect(auditEntries[0].action).toBe("batch:csv_import");
    expect(auditEntries[0].actor).toBe(user.id);
    expect((auditEntries[0].details as Record<string, unknown>).recipientCount).toBe(2);
  });
});
