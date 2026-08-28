import { describe, expect, it } from "vitest";

/**
 * State machine model representing OphirPay Soroban contract storage for payments.
 */
export interface PaymentRecord {
  id: number;
  sender: string;
  recipient: string;
  amount: bigint;
  asset: string;
  memo?: string;
  status: "COMPLETED" | "REFUNDED" | "CANCELLED";
  timestamp: number;
}

export type ContractOperation =
  | { type: "RECORD_PAYMENT"; sender: string; recipient: string; amount: bigint; memo?: string }
  | { type: "RECORD_BATCH"; items: Array<{ sender: string; recipient: string; amount: bigint }> }
  | { type: "REFUND_PAYMENT"; paymentId: number; reason: string }
  | { type: "CANCEL_PAYMENT"; paymentId: number };

export class ContractPaymentModel {
  private paymentCounter: number = 0;
  private records: Map<number, PaymentRecord> = new Map();

  public getPaymentCounter(): number {
    return this.paymentCounter;
  }

  public getRecord(id: number): PaymentRecord | undefined {
    return this.records.get(id);
  }

  public getAllRecords(): PaymentRecord[] {
    return Array.from(this.records.values());
  }

  public applyOperation(op: ContractOperation): void {
    switch (op.type) {
      case "RECORD_PAYMENT": {
        this.paymentCounter += 1;
        const newRecord: PaymentRecord = {
          id: this.paymentCounter,
          sender: op.sender,
          recipient: op.recipient,
          amount: op.amount,
          asset: "XLM",
          memo: op.memo,
          status: "COMPLETED",
          timestamp: Date.now(),
        };
        this.records.set(this.paymentCounter, newRecord);
        break;
      }

      case "RECORD_BATCH": {
        for (const item of op.items) {
          this.paymentCounter += 1;
          const newRecord: PaymentRecord = {
            id: this.paymentCounter,
            sender: item.sender,
            recipient: item.recipient,
            amount: item.amount,
            asset: "XLM",
            status: "COMPLETED",
            timestamp: Date.now(),
          };
          this.records.set(this.paymentCounter, newRecord);
        }
        break;
      }

      case "REFUND_PAYMENT": {
        const target = this.records.get(op.paymentId);
        if (target && target.status === "COMPLETED") {
          target.status = "REFUNDED";
        }
        break;
      }

      case "CANCEL_PAYMENT": {
        const target = this.records.get(op.paymentId);
        if (target && target.status === "COMPLETED") {
          target.status = "CANCELLED";
        }
        break;
      }
    }
  }

  /**
   * Asserts all contract state invariants.
   */
  public assertInvariants(replaySequence: ContractOperation[]): void {
    const counter = this.getPaymentCounter();
    const records = this.getAllRecords();

    // Invariant 1: Payment counter equals the total count of stored records
    if (counter !== records.length) {
      throw new Error(
        `Invariant Violated: paymentCounter (${counter}) != totalRecords (${records.length}). Replay: ${JSON.stringify(replaySequence)}`,
      );
    }

    // Invariant 2: IDs 1..paymentCounter are contiguous and present
    for (let id = 1; id <= counter; id++) {
      if (!this.records.has(id)) {
        throw new Error(
          `Invariant Violated: Missing record for ID ${id} in contiguous sequence 1..${counter}. Replay: ${JSON.stringify(replaySequence)}`,
        );
      }
    }
  }
}

describe("Contract Payment Counter Invariant Tests (#384)", () => {
  it("maintains invariant across sequential single and batch payments", () => {
    const model = new ContractPaymentModel();
    const history: ContractOperation[] = [];

    const op1: ContractOperation = {
      type: "RECORD_PAYMENT",
      sender: "G_ALICE",
      recipient: "G_BOB",
      amount: 10000000n,
    };
    history.push(op1);
    model.applyOperation(op1);
    model.assertInvariants(history);

    const op2: ContractOperation = {
      type: "RECORD_BATCH",
      items: [
        { sender: "G_ALICE", recipient: "G_CHARLIE", amount: 5000000n },
        { sender: "G_ALICE", recipient: "G_DAVE", amount: 2500000n },
      ],
    };
    history.push(op2);
    model.applyOperation(op2);
    model.assertInvariants(history);

    expect(model.getPaymentCounter()).toBe(3);
    expect(model.getAllRecords().length).toBe(3);
  });

  it("maintains invariant across state transitions (refunds and cancellations)", () => {
    const model = new ContractPaymentModel();
    const history: ContractOperation[] = [];

    const p1: ContractOperation = {
      type: "RECORD_PAYMENT",
      sender: "G_USER1",
      recipient: "G_USER2",
      amount: 50000000n,
    };
    history.push(p1);
    model.applyOperation(p1);
    model.assertInvariants(history);

    const ref: ContractOperation = {
      type: "REFUND_PAYMENT",
      paymentId: 1,
      reason: "MERCHANDISE_RETURN",
    };
    history.push(ref);
    model.applyOperation(ref);
    model.assertInvariants(history);

    expect(model.getRecord(1)?.status).toBe("REFUNDED");
    expect(model.getPaymentCounter()).toBe(1);
    expect(model.getAllRecords().length).toBe(1);
  });

  it("property fuzz test: asserts invariant across 100 randomized operation sequences", () => {
    const accounts = ["G_ALICE", "G_BOB", "G_CHARLIE", "G_DAVE", "G_EVE"];

    for (let seq = 0; seq < 100; seq++) {
      const model = new ContractPaymentModel();
      const history: ContractOperation[] = [];
      const opCount = Math.floor(Math.random() * 40) + 10;

      for (let i = 0; i < opCount; i++) {
        const randType = Math.random();
        let op: ContractOperation;

        if (randType < 0.5) {
          // Single payment
          op = {
            type: "RECORD_PAYMENT",
            sender: accounts[Math.floor(Math.random() * accounts.length)]!,
            recipient: accounts[Math.floor(Math.random() * accounts.length)]!,
            amount: BigInt(Math.floor(Math.random() * 100000000) + 1),
            memo: `memo_${i}`,
          };
        } else if (randType < 0.8) {
          // Batch payment
          const batchSize = Math.floor(Math.random() * 5) + 1;
          const items = Array.from({ length: batchSize }, () => ({
            sender: accounts[Math.floor(Math.random() * accounts.length)]!,
            recipient: accounts[Math.floor(Math.random() * accounts.length)]!,
            amount: BigInt(Math.floor(Math.random() * 10000000) + 1),
          }));
          op = { type: "RECORD_BATCH", items };
        } else if (randType < 0.9) {
          // Refund
          const targetId = Math.floor(Math.random() * (model.getPaymentCounter() + 2)) + 1;
          op = { type: "REFUND_PAYMENT", paymentId: targetId, reason: "OVERPAYMENT" };
        } else {
          // Cancel
          const targetId = Math.floor(Math.random() * (model.getPaymentCounter() + 2)) + 1;
          op = { type: "CANCEL_PAYMENT", paymentId: targetId };
        }

        history.push(op);
        model.applyOperation(op);
        model.assertInvariants(history);
      }

      // Final invariant check
      expect(model.getPaymentCounter()).toBe(model.getAllRecords().length);
    }
  });
});
