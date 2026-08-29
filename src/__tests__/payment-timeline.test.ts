// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest";
import {
  derivePaymentTimeline,
  parsePaymentMetadata,
  extractAuditEvents,
} from "@/lib/payment-timeline";
import type { Payment } from "@/types";

describe("Payment Timeline derivation logic", () => {
  const basePayment: Payment = {
    id: "cm1234567890123456789012",
    amount: 150.75,
    status: "CREATED",
    assetCode: "XLM",
    createdAt: "2026-08-20T10:00:00.000Z",
    updatedAt: "2026-08-20T10:00:00.000Z",
  };

  it("correctly derives steps for CREATED status", () => {
    const timeline = derivePaymentTimeline(basePayment);

    expect(timeline).toHaveLength(4);
    expect(timeline[0].stage).toBe("created");
    expect(timeline[0].state).toBe("completed");
    expect(timeline[0].timestamp).toBe("2026-08-20T10:00:00.000Z");

    expect(timeline[1].stage).toBe("signed");
    expect(timeline[1].state).toBe("upcoming");

    expect(timeline[2].stage).toBe("submitted");
    expect(timeline[2].state).toBe("upcoming");

    expect(timeline[3].stage).toBe("confirmed");
    expect(timeline[3].state).toBe("upcoming");
  });

  it("correctly derives steps for PENDING status (awaiting signature)", () => {
    const payment: Payment = {
      ...basePayment,
      status: "PENDING",
      updatedAt: "2026-08-20T10:05:00.000Z",
    };
    const timeline = derivePaymentTimeline(payment);

    expect(timeline[0].state).toBe("completed");
    expect(timeline[1].stage).toBe("signed");
    expect(timeline[1].state).toBe("active");
    expect(timeline[2].state).toBe("upcoming");
    expect(timeline[3].state).toBe("upcoming");
  });

  it("correctly derives steps for SIGNED status", () => {
    const payment: Payment = {
      ...basePayment,
      status: "SIGNED",
      updatedAt: "2026-08-20T10:10:00.000Z",
    };
    const timeline = derivePaymentTimeline(payment);

    expect(timeline[0].state).toBe("completed");
    expect(timeline[1].stage).toBe("signed");
    expect(timeline[1].state).toBe("completed");
    expect(timeline[1].timestamp).toBe("2026-08-20T10:10:00.000Z");
    expect(timeline[2].state).toBe("upcoming");
    expect(timeline[3].state).toBe("upcoming");
  });

  it("correctly derives steps for PROCESSING status", () => {
    const payment: Payment = {
      ...basePayment,
      status: "PROCESSING",
      updatedAt: "2026-08-20T10:12:00.000Z",
    };
    const timeline = derivePaymentTimeline(payment);

    expect(timeline[0].state).toBe("completed");
    expect(timeline[1].state).toBe("completed");
    expect(timeline[2].stage).toBe("submitted");
    expect(timeline[2].state).toBe("active");
    expect(timeline[3].stage).toBe("confirmed");
    expect(timeline[3].state).toBe("active");
  });

  it("correctly derives steps for SUBMITTED status with txHash and explorerUrl", () => {
    const payment: Payment = {
      ...basePayment,
      status: "SUBMITTED",
      transactionHash: "a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90",
      updatedAt: "2026-08-20T10:15:00.000Z",
    };
    const timeline = derivePaymentTimeline(payment);

    expect(timeline[0].state).toBe("completed");
    expect(timeline[1].state).toBe("completed");
    expect(timeline[2].stage).toBe("submitted");
    expect(timeline[2].state).toBe("completed");
    expect(timeline[2].txHash).toBe(payment.transactionHash);
    expect(timeline[2].explorerUrl).toContain("stellar.expert");
    expect(timeline[3].stage).toBe("confirmed");
    expect(timeline[3].state).toBe("active");
  });

  it("correctly derives steps for CONFIRMED / COMPLETED status", () => {
    const payment: Payment = {
      ...basePayment,
      status: "COMPLETED",
      transactionHash: "f9e8d7c6b5a40312f9e8d7c6b5a40312f9e8d7c6b5a40312f9e8d7c6b5a40312",
      completedAt: "2026-08-20T10:20:00.000Z",
      updatedAt: "2026-08-20T10:20:00.000Z",
    };
    const timeline = derivePaymentTimeline(payment);

    expect(timeline[0].state).toBe("completed");
    expect(timeline[1].state).toBe("completed");
    expect(timeline[2].state).toBe("completed");
    expect(timeline[3].stage).toBe("confirmed");
    expect(timeline[3].state).toBe("completed");
    expect(timeline[3].timestamp).toBe("2026-08-20T10:20:00.000Z");
    expect(timeline[3].txHash).toBe(payment.transactionHash);
    expect(timeline[3].explorerUrl).toContain(payment.transactionHash);
  });

  it("correctly derives steps for FAILED status with error message", () => {
    const payment: Payment = {
      ...basePayment,
      status: "FAILED",
      errorMessage: "tx_insufficient_balance",
      updatedAt: "2026-08-20T10:25:00.000Z",
    };
    const timeline = derivePaymentTimeline(payment);

    expect(timeline[0].state).toBe("completed");
    expect(timeline[3].stage).toBe("failed");
    expect(timeline[3].state).toBe("failed");
    expect(timeline[3].title).toBe("Failed");
    expect(timeline[3].errorMessage).toBe("tx_insufficient_balance");
    expect(timeline[3].timestamp).toBe("2026-08-20T10:25:00.000Z");
  });

  it("correctly derives steps for CANCELLED status", () => {
    const payment: Payment = {
      ...basePayment,
      status: "CANCELLED",
      updatedAt: "2026-08-20T10:30:00.000Z",
    };
    const timeline = derivePaymentTimeline(payment);

    expect(timeline[0].state).toBe("completed");
    expect(timeline[3].stage).toBe("cancelled");
    expect(timeline[3].state).toBe("cancelled");
    expect(timeline[3].title).toBe("Cancelled");
  });

  it("parses metadata and audit events correctly", () => {
    const metaObj = {
      signedAt: "2026-08-20T10:05:00.000Z",
      submittedAt: "2026-08-20T10:10:00.000Z",
      events: [
        { type: "payment.created", timestamp: "2026-08-20T10:00:00.000Z" },
        { type: "payment.signed", timestamp: "2026-08-20T10:05:00.000Z", note: "Freighter wallet" },
      ],
      audits: [
        { kind: "SignatureAudit", valid: true, note: "Signature verified by ed25519" },
      ],
    };

    const paymentWithMeta: Payment = {
      ...basePayment,
      status: "SUBMITTED",
      metadata: JSON.stringify(metaObj),
    };

    const parsed = parsePaymentMetadata(paymentWithMeta.metadata);
    expect(parsed.signedAt).toBe("2026-08-20T10:05:00.000Z");
    expect(parsed.submittedAt).toBe("2026-08-20T10:10:00.000Z");

    const events = extractAuditEvents(paymentWithMeta);
    expect(events).toHaveLength(3);
    expect(events[0].type).toBe("payment.created");
    expect(events[1].type).toBe("payment.signed");
    expect(events[2].kind).toBe("SignatureAudit");
    expect(events[2].note).toBe("Signature verified by ed25519");

    const timeline = derivePaymentTimeline(paymentWithMeta);
    expect(timeline[1].timestamp).toBe("2026-08-20T10:05:00.000Z");
    expect(timeline[2].timestamp).toBe("2026-08-20T10:10:00.000Z");
  });

  it("handles null, invalid, or non-json metadata gracefully", () => {
    expect(parsePaymentMetadata(null)).toEqual({});
    expect(parsePaymentMetadata(undefined)).toEqual({});
    expect(parsePaymentMetadata("not-valid-json")).toEqual({});
    expect(parsePaymentMetadata("[]")).toEqual({});

    const paymentNoMeta: Payment = { ...basePayment, metadata: "{invalid json" };
    const timeline = derivePaymentTimeline(paymentNoMeta);
    expect(timeline).toHaveLength(4);
    expect(extractAuditEvents(paymentNoMeta)).toEqual([]);
  });
});
