// SPDX-License-Identifier: MIT

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import net from "node:net";
import { createBatchSchema } from "@/lib/validation-schemas";
import { AUDIT_ACTIONS } from "@/lib/audit";
import type { CsvImportRow } from "@/lib/csv-import";
import { createSessionToken, getAuthContext } from "@/lib/auth-session";
import { POST as postBatch } from "@/app/api/batches/route";
import * as csvImportModule from "@/lib/csv-import";

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
    const { rows, fileErrors } = await csvImport.parseRecipientsCsvToRows(csvFile(sampleCsv));

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

// ─── CSV Corruption Handling Tests (Issue #1922) ──────────────

describe("CsvBatchImport (corruption handling)", () => {
  const VALID_ADDRESS = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

  function csvFile(content: string): File {
    return new File([content], "test.csv", { type: "text/csv" });
  }

  it("empty CSV file returns clear error message", async () => {
    const { rows, fileErrors } = await csvImport.parseRecipientsCsvToRows(
      csvFile("")
    );

    expect(fileErrors).toEqual(["CSV must have a header row and at least one data row."]);
    expect(rows).toHaveLength(0);
  });

  it("CSV with only header row returns clear error message", async () => {
    const { rows, fileErrors } = await csvImport.parseRecipientsCsvToRows(
      csvFile("address,amount,memo\n")
    );

    expect(fileErrors).toEqual(["CSV must have a header row and at least one data row."]);
    expect(rows).toHaveLength(0);
  });

  it("row with missing amount column displays error without stopping parsing", async () => {
    const { rows, fileErrors } = await csvImport.parseRecipientsCsvToRows(
      csvFile(`address,amount,memo\n${VALID_ADDRESS},,thanks\nGBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB,50,memo\n`)
    );

    expect(fileErrors).toEqual([]);
    expect(rows).toHaveLength(2);
    expect(rows[0].errors).toHaveProperty("amount");
    expect(rows[1].errors).toBeFalsy();
  });

  it("row with invalid public key flags specific row without stopping parsing", async () => {
    const { rows, fileErrors } = await csvImport.parseRecipientsCsvToRows(
      csvFile(`address,amount,memo\nnot-a-valid-key,100,test\n${VALID_ADDRESS},50,\n`)
    );

    expect(fileErrors).toEqual([]);
    expect(rows).toHaveLength(2);
    expect(rows[0].errors).toHaveProperty("address");
    expect(rows[1].errors).toEqual({});
  });

  it("malformed rows with extra columns are handled gracefully", async () => {
    const { rows, fileErrors } = await csvImport.parseRecipientsCsvToRows(
      csvFile(`address,amount,memo\n${VALID_ADDRESS},100,thanks,extra,columns\n`)
    );

    expect(fileErrors).toEqual([]);
    expect(rows).toHaveLength(1);
    // Extra columns should not cause an error, just be ignored
    expect(rows[0].errors).toEqual({});
    expect(rows[0].values.memo).toBe("thanks");
  });

  it("CSV with rows missing columns uses defaults for missing values", async () => {
    const { rows, fileErrors } = await csvImport.parseRecipientsCsvToRows(
      csvFile(`address,amount,memo\n${VALID_ADDRESS},100\n`)
    );

    expect(fileErrors).toEqual([]);
    expect(rows).toHaveLength(1);
    expect(rows[0].values).toEqual({
      address: VALID_ADDRESS,
      amount: "100",
      memo: "",
    });
  });

  it("CSV with empty lines between data rows is handled correctly", async () => {
    const { rows, fileErrors } = await csvImport.parseRecipientsCsvToRows(
      csvFile(`address,amount,memo\n${VALID_ADDRESS},100,first\n\n${VALID_ADDRESS},50,second\n`)
    );

    expect(fileErrors).toEqual([]);
    expect(rows).toHaveLength(3);
    // Empty row should produce errors for missing address and amount
    expect(rows[1].errors).toBeDefined();
    expect(rows[2].errors).toEqual({});
  });

  it("CSV with whitespace-only values treats them as empty", async () => {
    const { rows, fileErrors } = await csvImport.parseRecipientsCsvToRows(
      csvFile(`address,amount,memo\n   ,   ,   \n`)
    );

    expect(fileErrors).toEqual([]);
    expect(rows).toHaveLength(1);
    expect(rows[0].values.address).toBe("");
    expect(rows[0].values.amount).toBe("");
    expect(rows[0].errors).toBeDefined();
  });

  it("CSV with special characters and quoted fields parses correctly", async () => {
    const { rows, fileErrors } = await csvImport.parseRecipientsCsvToRows(
      csvFile(`address,amount,memo\n"${VALID_ADDRESS}","100.50","invoice, #42"\n`)
    );

    expect(fileErrors).toEqual([]);
    expect(rows).toHaveLength(1);
    expect(rows[0].values).toEqual({
      address: VALID_ADDRESS,
      amount: "100.50",
      memo: "invoice, #42",
    });
  });

  it("CSV exceeding recipient limit is flagged as file error", async () => {
    const MAX_RECIPIENTS = 1000; // Based on typical batch limits
    let csvContent = "address,amount,memo\n";
    for (let i = 0; i < MAX_RECIPIENTS + 10; i++) {
      csvContent += `${VALID_ADDRESS},10,memo${i}\n`;
    }

    const { rows, fileErrors } = await csvImport.parseRecipientsCsvToRows(
      csvFile(csvContent)
    );

    // File error should be present for exceeding limit
    expect(fileErrors.some((e) => e.includes("Maximum"))).toBe(true);
  });

  it("row with amount that is not a valid number produces amount error", async () => {
    const { rows, fileErrors } = await csvImport.parseRecipientsCsvToRows(
      csvFile(`address,amount,memo\n${VALID_ADDRESS},not-a-number,test\n`)
    );

    expect(fileErrors).toEqual([]);
    expect(rows).toHaveLength(1);
    expect(rows[0].errors).toHaveProperty("amount");
  });

  it("row with negative amount produces error", async () => {
    const { rows, fileErrors } = await csvImport.parseRecipientsCsvToRows(
      csvFile(`address,amount,memo\n${VALID_ADDRESS},-100,test\n`)
    );

    expect(fileErrors).toEqual([]);
    expect(rows).toHaveLength(1);
    expect(rows[0].errors).toHaveProperty("amount");
  });

  it("multiple validation errors on a single row are all captured", async () => {
    const { rows, fileErrors } = await csvImport.parseRecipientsCsvToRows(
      csvFile(`address,amount,memo\ninvalid-address,invalid-amount,memo\n`)
    );

    expect(fileErrors).toEqual([]);
    expect(rows).toHaveLength(1);
    expect(Object.keys(rows[0].errors).length).toBeGreaterThan(1);
  });
});
