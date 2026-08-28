// SPDX-License-Identifier: MIT

/**
 * Structured refund reason codes for OphirPay payment contracts (#377).
 */
export const ALLOWED_REFUND_REASON_CODES = [
  "DUPLICATE_PAYMENT",
  "INCORRECT_AMOUNT",
  "MERCHANDISE_RETURN",
  "SERVICE_UNFULFILLED",
  "FRAUD_DISPUTE",
  "MUTUAL_AGREEMENT",
] as const;

export type RefundReasonCode = (typeof ALLOWED_REFUND_REASON_CODES)[number];

export interface RefundRecord {
  paymentId: number;
  caller: string;
  originalPayer: string;
  recipient: string;
  amount: bigint;
  asset: string;
  reasonCode: RefundReasonCode;
  timestamp: number;
}

export interface RefundEvent {
  topic: "payment_refunded";
  paymentId: number;
  caller: string;
  amount: string;
  reasonCode: RefundReasonCode;
  timestamp: number;
}

/**
 * Validate whether a string matches one of the canonical allowed refund reason codes.
 */
export function isValidRefundReasonCode(code: string): code is RefundReasonCode {
  return (ALLOWED_REFUND_REASON_CODES as readonly string[]).includes(code);
}

export class RefundContractHandler {
  private paymentStatus: Map<
    number,
    { status: "COMPLETED" | "REFUNDED"; payer: string; recipient: string; amount: bigint }
  > = new Map();
  private refundHistory: RefundRecord[] = [];
  private emittedEvents: RefundEvent[] = [];
  private adminAddress: string;

  constructor(adminAddress: string) {
    this.adminAddress = adminAddress;
  }

  public registerPayment(id: number, payer: string, recipient: string, amount: bigint): void {
    this.paymentStatus.set(id, { status: "COMPLETED", payer, recipient, amount });
  }

  public processRefund(
    paymentId: number,
    caller: string,
    reasonCode: string,
  ): { success: boolean; error?: string; record?: RefundRecord } {
    // 1. Check reason code validity
    if (!isValidRefundReasonCode(reasonCode)) {
      return {
        success: false,
        error: `INVALID_REASON_CODE: Reason '${reasonCode}' is not in the allowed refund code registry.`,
      };
    }

    // 2. Lookup payment
    const payment = this.paymentStatus.get(paymentId);
    if (!payment) {
      return { success: false, error: "PAYMENT_NOT_FOUND" };
    }

    // 3. Double-refund prevention
    if (payment.status === "REFUNDED") {
      return {
        success: false,
        error: "ALREADY_REFUNDED: This payment has already been refunded and cannot be refunded twice.",
      };
    }

    // 4. Authorization check: Only original payer or admin can refund
    const isPayer = caller === payment.payer;
    const isAdmin = caller === this.adminAddress;
    if (!isPayer && !isAdmin) {
      return {
        success: false,
        error: "UNAUTHORIZED: Only the original payer or contract admin can trigger a refund.",
      };
    }

    // 5. Update state
    payment.status = "REFUNDED";
    const record: RefundRecord = {
      paymentId,
      caller,
      originalPayer: payment.payer,
      recipient: payment.recipient,
      amount: payment.amount,
      reasonCode,
      timestamp: Date.now(),
    };

    this.refundHistory.push(record);
    this.emittedEvents.push({
      topic: "payment_refunded",
      paymentId,
      caller,
      amount: payment.amount.toString(),
      reasonCode,
      timestamp: record.timestamp,
    });

    return { success: true, record };
  }

  public getRefundEvents(): RefundEvent[] {
    return this.emittedEvents;
  }

  public getRefundHistory(): RefundRecord[] {
    return this.refundHistory;
  }
}
