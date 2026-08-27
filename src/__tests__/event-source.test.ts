// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest";
import { normalizeEvent } from "@/lib/events/event-source";

describe("normalizeEvent", () => {
  it("maps a raw emitter event into the shared LiveEvent shape", () => {
    const raw = {
      id: 7,
      emitter: "OphirPay",
      payer: "GPAYER",
      payee: "GPAYEE",
      amount: "10000000",
      tx_hash: "abcdef",
    };
    const event = normalizeEvent(raw, 7);
    expect(event.id).toBe(7);
    expect(event.event).toBe("payment:created");
    expect(event.paymentId).toBe("evt_7");
    expect(event.status).toBe("COMPLETED");
    expect(event.payer).toBe("GPAYER");
    expect(event.txHash).toBe("abcdef");
    expect(typeof event.timestamp).toBe("string");
    expect(new Date(event.timestamp).getTime()).not.toBeNaN();
  });

  it("falls back to the poll id when the raw event has no id", () => {
    const event = normalizeEvent({}, 42);
    expect(event.id).toBe(42);
    expect(event.paymentId).toBe("evt_42");
  });

  it("defaults missing optional fields", () => {
    const event = normalizeEvent({}, 1);
    expect(event.emitter).toBe("OphirPay");
    expect(event.payer).toBe("");
    expect(event.payee).toBe("");
    expect(event.amount).toBe("0");
    expect(event.txHash).toBe("");
  });
});
