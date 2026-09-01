// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest";
import { Prisma, type Payment } from "@prisma/client";
import {
  MAX_DONATION_EXPORT_ROWS,
  DONATION_EXPORT_COLUMNS,
  donationToExportRow,
  buildDonationExportFilename,
} from "@/lib/donation-export";
import { toCsvString } from "@/lib/export-csv";

/** Build a realistic Prisma Payment row for the mapper under test. */
function makePayment(overrides: Partial<Payment> = {}): Payment {
  return {
    id: "cm0donation0000000000001",
    userId: "user-1",
    amount: new Prisma.Decimal("50"),
    assetCode: "XLM",
    assetIssuer: null,
    description: "Monthly support",
    memo: "donation",
    status: "COMPLETED",
    transactionHash:
      "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
    stellarOpId: null,
    sourceAccountId: null,
    destAccountId: null,
    batchId: null,
    recurrenceId: null,
    metadata: null,
    errorMessage: null,
    createdAt: new Date("2026-08-26T10:00:00.000Z"),
    updatedAt: new Date("2026-08-26T10:00:00.000Z"),
    completedAt: null,
    deletedAt: null,
    ...overrides,
  } as Payment;
}

describe("donationToExportRow", () => {
  it("includes all donation-history fields", () => {
    const row = donationToExportRow(makePayment());
    expect(row.id).toBe("cm0donation0000000000001");
    expect(row.amount).toBe("50.0000000");
    expect(row.assetCode).toBe("XLM");
    expect(row.description).toBe("Monthly support");
    expect(row.memo).toBe("donation");
    expect(row.status).toBe("COMPLETED");
    expect(row.transactionHash).toBe(
      "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789"
    );
  });

  it("renders Decimal amounts at the schema scale (no scientific notation)", () => {
    const row = donationToExportRow(
      makePayment({ amount: new Prisma.Decimal("0.0000001") })
    );
    expect(row.amount).toBe("0.0000001");
  });

  it("writes dates as ISO-8601", () => {
    const row = donationToExportRow(makePayment());
    expect(row.createdAt).toBe("2026-08-26T10:00:00.000Z");
  });

  it("maps null optional fields to empty strings", () => {
    const row = donationToExportRow(
      makePayment({ memo: null, transactionHash: null, description: null })
    );
    expect(row.memo).toBe("");
    expect(row.transactionHash).toBe("");
    expect(row.description).toBe("");
    expect(row.assetIssuer).toBe("");
  });
});

describe("DONATION_EXPORT_COLUMNS", () => {
  it("has a stable, documented column order", () => {
    expect(DONATION_EXPORT_COLUMNS.map((c) => c.header)).toEqual([
      "Donation ID",
      "Amount",
      "Asset Code",
      "Asset Issuer",
      "Description",
      "Memo",
      "Status",
      "Transaction Hash",
      "Donated At",
    ]);
  });

  it("covers every key of the export row exactly once", () => {
    const keys = DONATION_EXPORT_COLUMNS.map((c) => c.key).sort();
    const rowKeys = Object.keys(donationToExportRow(makePayment())).sort();
    expect(keys).toEqual(rowKeys);
  });
});

describe("CSV builder output", () => {
  it("renders a header plus one row per donation via toCsvString", () => {
    const csv = toCsvString(
      [donationToExportRow(makePayment()), donationToExportRow(makePayment())],
      DONATION_EXPORT_COLUMNS
    );
    const lines = csv.split("\n");
    expect(lines[0]).toBe(
      "Donation ID,Amount,Asset Code,Asset Issuer,Description,Memo,Status,Transaction Hash,Donated At"
    );
    expect(lines).toHaveLength(3);
    expect(lines[1]).toContain("50.0000000");
    expect(lines[1]).toContain("donation");
  });

  it("escapes values containing commas, quotes, newlines and carriage returns", () => {
    const csv = toCsvString(
      [
        donationToExportRow(
          makePayment({
            description: 'Donation "big", urgent',
            memo: "line1\nline2",
            status: "COMPLETED\r\nvia CRLF" as Payment["status"],
          })
        ),
      ],
      DONATION_EXPORT_COLUMNS
    );
    // Commas and quotes → quoted with doubled quotes (RFC 4180 §2.4).
    expect(csv).toContain('"Donation ""big"", urgent"');
    // Embedded newlines stay inside quotes.
    expect(csv).toContain('"line1\nline2"');
    // Carriage returns are quoted too (regression for CR split records).
    expect(csv).toContain('"COMPLETED\r\nvia CRLF"');
  });

  it("neutralizes formula-injection leading characters (OWASP)", () => {
    const csv = toCsvString(
      [donationToExportRow(makePayment({ description: "=SUM(A1:A2)" }))],
      DONATION_EXPORT_COLUMNS
    );
    expect(csv).toContain("'=SUM(A1:A2)");
  });
});

describe("buildDonationExportFilename", () => {
  it("includes the date", () => {
    expect(
      buildDonationExportFilename(new Date("2026-09-01T23:59:00.000Z"))
    ).toBe("ophirpay-donations-2026-09-01.csv");
    expect(buildDonationExportFilename()).toMatch(
      /^ophirpay-donations-\d{4}-\d{2}-\d{2}\.csv$/
    );
  });
});

describe("MAX_DONATION_EXPORT_ROWS", () => {
  it("is a positive cap for the in-memory export", () => {
    expect(MAX_DONATION_EXPORT_ROWS).toBeGreaterThan(0);
  });
});
