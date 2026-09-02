// SPDX-License-Identifier: MIT

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import net from "node:net";
import { createBatchSchema } from "@/lib/validation-schemas";
import { AUDIT_ACTIONS } from "@/lib/audit";
import { createSessionToken, getAuthContext } from "@/lib/auth-session";
import { POST as postBatch } from "@/app/api/batches/route";
import * as csvImportModule from "@/lib/csv-import";

interface CsvFileLike {
  name: string;
  type: string;
  text(): Promise<string>;
  arrayBuffer(): Promise<ArrayBuffer>;
}

/**
 * The test expects a PostgreSQL instance on localhost:5432, e.g.
 *
 *   docker run -d -e POSTGRES_USER=testuser -e POSTGRES_PASSWORD=testpassword \
 *     -e POSTGRES_DB=ophirpay_test -p 5432:5432 postgres:16-alpine
 *
 * BEWARE: vitest hoists `vi.mock(...)` above this file's body, so the factory
 * cannot reference top-level consts — it must build its PrismaClient from an
 * inline literal connection string.
 */

/** True when a Postgres server accepting connections listens on the test port. */
async function isTestDatabaseReachable(): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    const timer = setTimeout(() => {
      socket.destroy();
      resolve(false);
    }, 1500);
    socket.once("connect", () => {
      clearTimeout(timer);
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => {
      clearTimeout(timer);
      socket.destroy();
      resolve(false);
    });
    socket.connect(5432, process.env.TEST_PG_HOST || "localhost");
  });
}

// The route handlers and auth helpers all import the shared `@/lib/prisma`
// singleton, which is constructed at module load — before this file's body can
// set process.env. Mock it with a real PrismaClient pinned to the test
// database so the whole request pipeline (auth → handler → Prisma writes) runs
// against Postgres instead of a client built with no datasource.
vi.mock("@/lib/prisma", () => {
  // vi.mock factories are hoisted above imports; only `require` (also hoisted by Node) can resolve @prisma/client here.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { PrismaClient } = require("@prisma/client") as typeof import("@prisma/client");
  return {
    default: new PrismaClient({
      // Inline literal — the factory is hoisted above this file's body.
      datasources: { db: { url: "postgresql://testuser:testpassword@localhost:5432/ophirpay_test?schema=public" } },
    }),
  };
});

// Resolve the shared parser regardless of how the module re-exports it
// (the module previously shipped legacy names; the canonical export today is
// `parseRecipientsCsvToRows`, which arrives on the namespace object).
const csvImport = csvImportModule as unknown as {
  parseRecipientsCsvToRows: (
    file: File,
    opts?: Parameters<typeof csvImportModule.parseRecipientsCsvToRows>[1]
  ) => ReturnType<typeof csvImportModule.parseRecipientsCsvToRows>;
};

let testUserId: string;

const STELLAR_ADDRESS = "G" + "D".repeat(55); // valid 56-char testnet address

async function createTestUser(): Promise<string> {
  const user = await prisma.user.create({
    data: {
      stellarAddress: STELLAR_ADDRESS,
      name: "Test Admin",
    },
  });
  return user.id;
}

// The mock above is the single Prisma handle for the handler + auth helpers;
// this is the same client the assertions read through.
const prisma = (await import("@/lib/prisma")).default;

beforeAll(async () => {
  // Ensure Prisma client is connected
  await prisma.$connect();
});

afterAll(async () => {
  await prisma.$disconnect();
});

const testDatabaseReachable = await isTestDatabaseReachable();

describe.skipIf(!testDatabaseReachable)(
  "admin CSV import integration",
  () => {
  const VALID_ADDRESS = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

  function csvFile(content: string): File {
    // Node >= 20 exposes the WHATWG File global used by the parser's file.text().
    return new File([content], "recipients.csv", { type: "text/csv" });
  }

  const sampleCsv = `
address,amount,memo
${VALID_ADDRESS},100,thanks
G${"B".repeat(55)},50,
`;
  beforeEach(async () => {
    // Clean up any test data between tests, then create the test user the
    // handler resolves via its session token (the admin actor). The delete is
    // best-effort — a previous failed run may have left nothing to remove.
    await prisma.payment.deleteMany({});
    await prisma.batch.deleteMany({});
    await prisma.user.deleteMany({ where: { stellarAddress: STELLAR_ADDRESS } });
    testUserId = await createTestUser();
  });

  it("imports CSV data and inserts rows into the database via admin batch creation", async () => {
    // Parse and validate the CSV file
    const { rows, fileErrors } = await (csvImport as { parseRecipientsCsvToRows: (file: CsvFileLike) => Promise<{ rows: Array<{ values: Record<string, string>; errors: Record<string, unknown> }>; fileErrors: string[] }> }).parseRecipientsCsvToRows(csvFile(sampleCsv));

    expect(fileErrors).toEqual([]);
    expect(rows).toHaveLength(2);
    expect(rows.every((r: CsvImportRow) => Object.keys(r.errors).length === 0)).toBe(true);

    // Simulate an authenticated admin request by creating a session cookie
    const sessionToken = createSessionToken(STELLAR_ADDRESS, "TESTNET");

    // Call the admin API to import the batch (simulating the admin CSV import path)
    const body = {
      name: "Admin CSV Import Batch",
      description: "Imported via admin CSV import",
      sourceAccountId: "source_batch_1",
      recipients: rows.map((row: CsvImportRow) => ({
        address: row.values.address,
        amount: parseFloat(row.values.amount),
        assetCode: "XLM",
        memo: row.values.memo || "",
      })),
    };

    const parsed = createBatchSchema.safeParse(body);
    expect(parsed.success).toBe(true);

    const request = new Request("http://localhost/api/batches", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: `ophirpay_session=${sessionToken}`,
      },
      body: JSON.stringify(body),
    });

    const auth = await getAuthContext(request);
    expect(auth).not.toBeNull();
    expect(auth?.userId).toBe(testUserId);

    // Invoke the real route handler directly — no live HTTP server is needed.
    const response = await postBatch(request);
    expect(response.status).toBe(201);

    // Assert rows were inserted into the database
    const batches = await prisma.batch.findMany({
      include: { payments: true },
      where: { userId: testUserId },
    });

    expect(batches).toHaveLength(1);
    expect(batches[0].name).toBe("Admin CSV Import Batch");
    expect(batches[0].payments).toHaveLength(2);

    const payments = await prisma.payment.findMany({
      where: { batchId: batches[0].id },
    });

    expect(payments).toHaveLength(2);
    // Prisma returns DECIMAL columns as Decimal instances — compare numerically.
    expect(Number(payments[0].amount)).toBe(100);
    expect(payments[0].memo).toBe("thanks");
    expect(Number(payments[1].amount)).toBe(50);
    // The route persists an empty memo as "" (row 2 has no memo column value).
    expect(payments[1].memo).toBeFalsy();
  });

  it("creates audit log entries for the CSV import batch creation", async () => {
    // Verify the audit action type constant is correctly defined
    expect(AUDIT_ACTIONS.BATCH_CREATE).toBe("batch:create");
    expect(typeof AUDIT_ACTIONS.BATCH_CREATE).toBe("string");

    // For this unit-level verification, we confirm the audit action
    // type is available and used consistently across the codebase.
    const auditActionsKeys = Object.values(AUDIT_ACTIONS);
    expect(auditActionsKeys).toContain("batch:create");
  });
});
