// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest";
import { Prisma, type Payment } from "@prisma/client";
import {
  MAX_EXPORT_ROWS,
  PAYMENT_EXPORT_COLUMNS,
  STANDARD_PAYMENT_EXPORT_COLUMNS,
  paymentToCsvRow,
  serializePaymentsToJson,
  buildPaymentExportFilename,
} from "@/lib/payment-export";
import { toCsvString, createCsvResponse, createJsonResponse } from "@/lib/export-csv";

/** Build a realistic Prisma Payment row for the mapper under test. */
function makePayment(overrides: Partial<Payment> = {}): Payment {
  return {
    id: "cm0pymt00000000000000001",
    userId: "user-1",
    amount: new Prisma.Decimal("100.25"),
    assetCode: "XLM",
    assetIssuer: null,
    description: "Invoice #42",
    memo: "invoice-42",
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

describe("paymentToCsvRow", () => {
  it("includes all key fields plus memo and transaction hash", () => {
    const row = paymentToCsvRow(makePayment());
    expect(row.memo).toBe("invoice-42");
    expect(row.transactionHash).toBe(
      "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789"
    );
    expect(row.id).toBe("cm0pymt00000000000000001");
    expect(row.amount).toBe("100.2500000");
    expect(row.assetCode).toBe("XLM");
    expect(row.description).toBe("Invoice #42");
    expect(row.status).toBe("COMPLETED");
  });

  it("renders Decimal amounts at the schema scale (no scientific notation)", () => {
    const row = paymentToCsvRow(
      makePayment({ amount: new Prisma.Decimal("0.0000001") })
    );
    expect(row.amount).toBe("0.0000001");
  });

  it("renders whole amounts with the schema scale", () => {
    const row = paymentToCsvRow(makePayment({ amount: new Prisma.Decimal("100.25") }));
    expect(row.amount).toBe("100.2500000");
  });

  it("writes dates as ISO-8601", () => {
    const row = paymentToCsvRow(makePayment());
    expect(row.createdAt).toBe("2026-08-26T10:00:00.000Z");
  });

  it("maps null optional fields to empty strings", () => {
    const row = paymentToCsvRow(
      makePayment({ memo: null, transactionHash: null, description: null })
    );
    expect(row.memo).toBe("");
    expect(row.transactionHash).toBe("");
    expect(row.description).toBe("");
    expect(row.assetIssuer).toBe("");
  });
});

describe("PAYMENT_EXPORT_COLUMNS", () => {
  it("exposes memo and transaction hash columns", () => {
    const headers = PAYMENT_EXPORT_COLUMNS.map((c) => c.header);
    expect(headers).toContain("Memo");
    expect(headers).toContain("Transaction Hash");
    expect(headers).toContain("Payment ID");
    expect(headers).toContain("Amount");
    expect(headers).toContain("Status");
    expect(headers).toContain("Created At");
  });
});

describe("CSV builder output", () => {
  it("renders a header plus one row per payment via toCsvString", () => {
    const csv = toCsvString(
      [paymentToCsvRow(makePayment()), paymentToCsvRow(makePayment())],
      PAYMENT_EXPORT_COLUMNS
    );
    const lines = csv.split("\n");
    expect(lines[0]).toBe(
      "Payment ID,Amount,Asset Code,Asset Issuer,Description,Memo,Status,Transaction Hash,Source Account,Destination Account,Created At"
    );
    expect(lines).toHaveLength(3);
    expect(lines[1]).toContain("invoice-42");
    expect(lines[1]).toContain("100.2500000");
    expect(lines[1]).toContain(
      "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789"
    );
  });

  it("escapes values containing commas, quotes, newlines and carriage returns", () => {
    const csv = toCsvString(
      [
        {
          description: 'Invoice "42", urgent',
          memo: "line1\nline2",
          status: "COMPLETED\r\nvia CRLF",
        },
      ],
      [
        { key: "description", header: "Description" },
        { key: "memo", header: "Memo" },
        { key: "status", header: "Status" },
      ]
    );
    // Commas and quotes → quoted with doubled quotes (RFC 4180 §2.4).
    expect(csv).toContain('"Invoice ""42"", urgent"');
    // Embedded newlines stay inside quotes.
    expect(csv).toContain('"line1\nline2"');
    // Carriage returns are quoted too (regression for CR split records).
    expect(csv).toContain('"COMPLETED\r\nvia CRLF"');
  });
});

describe("buildPaymentExportFilename", () => {
  it("includes the date", () => {
    expect(buildPaymentExportFilename(new Date("2026-08-26T23:59:00.000Z"))).toBe(
      "ophirpay-payments-2026-08-26.csv"
    );
    expect(buildPaymentExportFilename()).toMatch(
      /^ophirpay-payments-\d{4}-\d{2}-\d{2}\.csv$/
    );
  });
});

describe("createCsvResponse", () => {
  it("preserves download headers and attaches extra metadata headers", () => {
    const res = createCsvResponse(
      buildPaymentExportFilename(new Date("2026-08-26T10:00:00.000Z")),
      "a,b\n1,2",
      { "X-Export-Truncated": "true" }
    );
    expect(res.headers.get("Content-Type")).toBe("text/csv; charset=utf-8");
    expect(res.headers.get("Content-Disposition")).toContain(
      "ophirpay-payments-2026-08-26.csv"
    );
    expect(res.headers.get("X-Export-Truncated")).toBe("true");
  });
});

describe("MAX_EXPORT_ROWS", () => {
  it("is a positive cap for the in-memory CSV", () => {
    expect(MAX_EXPORT_ROWS).toBeGreaterThan(0);
  });
});

describe("JSON export serialization (issue #1296)", () => {
  it("serializes payment rows into parseable JSON with all standard fields", () => {
    const payment = makePayment({
      sourceAccountId: "G_SENDER_123",
      destAccountId: "G_RECIPIENT_456",
      assetCode: "USDC",
      memo: "refund-order-99",
    });
    const jsonStr = serializePaymentsToJson([payment]);
    const parsed = JSON.parse(jsonStr);

    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toHaveLength(1);
    const item = parsed[0];

    // Standard columns required by issue #1296:
    // timestamp, transaction hash, sender, recipient, asset, amount, fee, memo, status
    expect(item.timestamp).toBe("2026-08-26T10:00:00.000Z");
    expect(item.transactionHash).toBe(
      "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789"
    );
    expect(item.sender).toBe("G_SENDER_123");
    expect(item.recipient).toBe("G_RECIPIENT_456");
    expect(item.asset).toBe("USDC");
    expect(item.amount).toBe("100.2500000");
    expect(item.fee).toBe("0.0000100");
    expect(item.memo).toBe("refund-order-99");
    expect(item.status).toBe("COMPLETED");
  });

  it("exposes all 9 standard columns in STANDARD_PAYMENT_EXPORT_COLUMNS", () => {
    const headers = STANDARD_PAYMENT_EXPORT_COLUMNS.map((c) => c.header);
    expect(headers).toContain("Timestamp");
    expect(headers).toContain("Transaction Hash");
    expect(headers).toContain("Sender");
    expect(headers).toContain("Recipient");
    expect(headers).toContain("Asset");
    expect(headers).toContain("Amount");
    expect(headers).toContain("Fee");
    expect(headers).toContain("Memo");
    expect(headers).toContain("Status");
    expect(headers).toHaveLength(9);
  });

  it("buildPaymentExportFilename supports both csv and json extensions", () => {
    const date = new Date("2026-10-18T10:00:00.000Z");
    expect(buildPaymentExportFilename("csv", date)).toBe("ophirpay-payments-2026-10-18.csv");
    expect(buildPaymentExportFilename("json", date)).toBe("ophirpay-payments-2026-10-18.json");
  });

  it("createJsonResponse sets json headers and attachment filename", async () => {
    const res = createJsonResponse("ophirpay-payments-2026-10-18.json", '{"test":true}');
    expect(res.headers.get("Content-Type")).toBe("application/json; charset=utf-8");
    expect(res.headers.get("Content-Disposition")).toContain("ophirpay-payments-2026-10-18.json");
    const body = await res.json();
    expect(body).toEqual({ test: true });
  });
});

