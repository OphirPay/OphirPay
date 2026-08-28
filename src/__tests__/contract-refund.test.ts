import { describe, expect, it } from "vitest";
import {
  ALLOWED_REFUND_REASON_CODES,
  isValidRefundReasonCode,
  RefundContractHandler,
} from "../lib/refund-reasons";

describe("Contract Refund with Structured Reason Codes (#377)", () => {
  const ADMIN = "G_ADMIN_SUPERUSER";
  const ALICE_PAYER = "G_ALICE_PAYER";
  const BOB_RECIPIENT = "G_BOB_RECIPIENT";
  const EVE_STRANGER = "G_EVE_STRANGER";

  it("successfully processes refund initiated by original payer with valid reason code", () => {
    const handler = new RefundContractHandler(ADMIN);
    handler.registerPayment(101, ALICE_PAYER, BOB_RECIPIENT, 50000000n);

    const result = handler.processRefund(101, ALICE_PAYER, "DUPLICATE_PAYMENT");

    expect(result.success).toBe(true);
    expect(result.record).toBeDefined();
    expect(result.record?.reasonCode).toBe("DUPLICATE_PAYMENT");
    expect(result.record?.originalPayer).toBe(ALICE_PAYER);

    // Event emission
    const events = handler.getRefundEvents();
    expect(events.length).toBe(1);
    expect(events[0]?.topic).toBe("payment_refunded");
    expect(events[0]?.paymentId).toBe(101);
    expect(events[0]?.caller).toBe(ALICE_PAYER);
    expect(events[0]?.reasonCode).toBe("DUPLICATE_PAYMENT");
  });

  it("successfully processes refund initiated by contract admin", () => {
    const handler = new RefundContractHandler(ADMIN);
    handler.registerPayment(102, ALICE_PAYER, BOB_RECIPIENT, 30000000n);

    const result = handler.processRefund(102, ADMIN, "FRAUD_DISPUTE");

    expect(result.success).toBe(true);
    expect(result.record?.caller).toBe(ADMIN);
    expect(result.record?.reasonCode).toBe("FRAUD_DISPUTE");
  });

  it("strictly prohibits double-refunds on already refunded payments", () => {
    const handler = new RefundContractHandler(ADMIN);
    handler.registerPayment(103, ALICE_PAYER, BOB_RECIPIENT, 20000000n);

    // First refund succeeds
    const first = handler.processRefund(103, ALICE_PAYER, "MERCHANDISE_RETURN");
    expect(first.success).toBe(true);

    // Second refund attempt must fail
    const second = handler.processRefund(103, ALICE_PAYER, "MERCHANDISE_RETURN");
    expect(second.success).toBe(false);
    expect(second.error).toContain("ALREADY_REFUNDED");
  });

  it("rejects refund attempts from unauthorized third parties", () => {
    const handler = new RefundContractHandler(ADMIN);
    handler.registerPayment(104, ALICE_PAYER, BOB_RECIPIENT, 10000000n);

    const result = handler.processRefund(104, EVE_STRANGER, "DUPLICATE_PAYMENT");
    expect(result.success).toBe(false);
    expect(result.error).toContain("UNAUTHORIZED");
  });

  it("rejects arbitrary / invalid reason codes not in the allowed registry", () => {
    const handler = new RefundContractHandler(ADMIN);
    handler.registerPayment(105, ALICE_PAYER, BOB_RECIPIENT, 15000000n);

    const invalidCodes = [
      "SOME_RANDOM_TEXT",
      "HACK_THE_SYSTEM",
      "<script>alert(1)</script>",
      "INVALID_CODE",
    ];

    for (const code of invalidCodes) {
      expect(isValidRefundReasonCode(code)).toBe(false);
      const result = handler.processRefund(105, ALICE_PAYER, code);
      expect(result.success).toBe(false);
      expect(result.error).toContain("INVALID_REASON_CODE");
    }
  });

  it("validates all canonical reason codes in the specification", () => {
    for (const code of ALLOWED_REFUND_REASON_CODES) {
      expect(isValidRefundReasonCode(code)).toBe(true);
    }
  });
});
