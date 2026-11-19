// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest";
import { Prisma, type Payment } from "@prisma/client";
import {
  PAYMENT_EXPORT_COLUMNS,
  PAYMENT_EXPORT_CONTENT_TYPES,
  PAYMENT_EXPORT_PAGE_SIZE,
  buildPaymentExportFilename,
  paymentRowToJson,
  paymentToCsvRow,
  paymentToExportRow,
  toPaymentJson,
} from "@/lib/payment-export";
import {
  buildCsvHeader,
  buildCsvRow,
  toCsvString,
  createCsvResponse,
} from "@/lib/export-csv";

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
    sourceAccountId:
      "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
    destAccountId:
      "GBH3O5IHGJ6GUKZCINS3UZGHVKDKYDLVIRKZY7GYA27B54WT3Q7H4KXO",
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

describe("paymentToExportRow", () => {
  it("maps the export contract fields", () => {
    const row = paymentToExportRow(makePayment());
    expect(row.id).toBe("cm0pymt00000000000000001");
    expect(row.timestamp).toBe("2026-08-26T10:00:00.000Z");
    expect(row.transactionHash).toBe(
      "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789"
    );
    expect(row.sender).toBe(
      "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN"
    );
    expect(row.recipient).toBe(
      "GBH3O5IHGJ6GUKZCINS3UZGHVKDKYDLVIRKZY7GYA27B54WT3Q7H4KXO"
    );
    expect(row.asset).toBe("XLM");
    expect(row.memo).toBe("invoice-42");
    expect(row.status).toBe("COMPLETED");
  });

  it("renders Decimal amounts at the schema scale (no scientific notation)", () => {
    const row = paymentToExportRow(
      makePayment({ amount: new Prisma.Decimal("0.0000001") })
    );
    expect(row.amount).toBe("0.0000001");
  });

  it("renders whole amounts with the schema scale", () => {
    const row = paymentToExportRow(
      makePayment({ amount: new Prisma.Decimal("100.25") })
    );
    expect(row.amount).toBe("100.2500000");
  });

  it("maps null optional fields to empty strings", () => {
    const row = paymentToExportRow(
      makePayment({
        memo: null,
        transactionHash: null,
        sourceAccountId: null,
        destAccountId: null,
      })
    );
    expect(row.memo).toBe("");
    expect(row.transactionHash).toBe("");
    expect(row.sender).toBe("");
    expect(row.recipient).toBe("");
  });

  it("reads a recorded fee from metadata and never invents one", () => {
    expect(
      paymentToExportRow(makePayment({ metadata: '{"fee":"100"}' })).fee
    ).toBe("100");
    expect(
      paymentToExportRow(makePayment({ metadata: '{"networkFee":0.5}' })).fee
    ).toBe("0.5");
    expect(
      paymentToExportRow(makePayment({ metadata: "plain memo" })).fee
    ).toBe("");
    expect(paymentToExportRow(makePayment({ metadata: null })).fee).toBe("");
  });

  it("keeps the CSV alias pointing at the same row shape", () => {
    const payment = makePayment();
    expect(paymentToCsvRow(payment)).toEqual(paymentToExportRow(payment));
  });
});

describe("PAYMENT_EXPORT_COLUMNS", () => {
  it("contains every column the export contract requires", () => {
    const headers = PAYMENT_EXPORT_COLUMNS.map((c) => c.header);
    expect(headers).toEqual([
      "Timestamp",
      "Transaction Hash",
      "Sender",
      "Recipient",
      "Asset",
      "Amount",
      "Fee",
      "Memo",
      "Status",
      "Payment ID",
    ]);
  });
});

describe("JSON serialization", () => {
  it("emits the same keys as the CSV columns", () => {
    const json = paymentRowToJson(paymentToExportRow(makePayment()));
    expect(Object.keys(json)).toEqual(
      PAYMENT_EXPORT_COLUMNS.map((column) => column.key)
    );
    expect(json).toMatchObject({
      timestamp: "2026-08-26T10:00:00.000Z",
      asset: "XLM",
      amount: "100.2500000",
      memo: "invoice-42",
      status: "COMPLETED",
    });
  });

  it("produces a parseable JSON array with one object per row", () => {
    const rows = [
      paymentToExportRow(makePayment()),
      paymentToExportRow(
        makePayment({ id: "p2", memo: 'needs, "quoting"', metadata: null })
      ),
    ];
    const parsed = JSON.parse(toPaymentJson(rows)) as Record<string, string>[];

    expect(parsed).toHaveLength(2);
    expect(parsed[1].memo).toBe('needs, "quoting"');
    expect(parsed[0].id).toBe("cm0pymt00000000000000001");
    // No CSV escaping leaks into JSON values.
    expect(parsed[1].memo).not.toContain('""');
  });
});

describe("CSV builder output", () => {
  it("renders a header plus one row per payment via toCsvString", () => {
    const csv = toCsvString(
      [paymentToExportRow(makePayment()), paymentToExportRow(makePayment())],
      PAYMENT_EXPORT_COLUMNS
    );
    const lines = csv.split("\n");
    expect(lines[0]).toBe(
      "Timestamp,Transaction Hash,Sender,Recipient,Asset,Amount,Fee,Memo,Status,Payment ID"
    );
    expect(lines).toHaveLength(3);
    expect(lines[1]).toContain("invoice-42");
    expect(lines[1]).toContain("100.2500000");
    expect(lines[1]).toContain(
      "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN"
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
  it("uses the requested format as the extension", () => {
    const date = new Date("2026-08-26T23:59:00.000Z");
    expect(buildPaymentExportFilename("csv", date)).toBe(
      "ophirpay-payments-2026-08-26.csv"
    );
    expect(buildPaymentExportFilename("json", date)).toBe(
      "ophirpay-payments-2026-08-26.json"
    );
    expect(buildPaymentExportFilename()).toMatch(
      /^ophirpay-payments-\d{4}-\d{2}-\d{2}\.csv$/
    );
  });

  it("declares a content type per format", () => {
    expect(PAYMENT_EXPORT_CONTENT_TYPES.csv).toBe("text/csv; charset=utf-8");
    expect(PAYMENT_EXPORT_CONTENT_TYPES.json).toBe(
      "application/json; charset=utf-8"
    );
  });
});

describe("createCsvResponse", () => {
  it("preserves download headers and attaches extra metadata headers", () => {
    const res = createCsvResponse(
      buildPaymentExportFilename("csv", new Date("2026-08-26T10:00:00.000Z")),
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

describe("PAYMENT_EXPORT_PAGE_SIZE", () => {
  it("is the 250-row page the streaming export flushes at a time", () => {
    expect(PAYMENT_EXPORT_PAGE_SIZE).toBe(250);
  });
});

describe("streaming helpers", () => {
  const columns = PAYMENT_EXPORT_COLUMNS;

  it("buildCsvHeader matches the first line of toCsvString", () => {
    const row = paymentToExportRow(makePayment());
    const streamed = [buildCsvHeader(columns), buildCsvRow(row, columns)].join(
      "\n"
    );
    expect(streamed).toBe(toCsvString([row], columns));
  });

  it("applies the CSV-injection guard to streamed rows", () => {
    const row = paymentToExportRow(
      makePayment({ memo: '=HYPERLINK("x")' })
    );
    expect(buildCsvRow(row, columns)).toContain("'=HYPERLINK(");
  });
});
