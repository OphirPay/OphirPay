// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest";
import { derivePaymentLifecycle, type LifecycleInput } from "@/lib/payment-lifecycle";

function states(input: LifecycleInput): string[] {
  return derivePaymentLifecycle(input).map((s) => s.state);
}

function stepState(input: LifecycleInput, state: string) {
  return derivePaymentLifecycle(input).find((s) => s.state === state);
}

describe("derivePaymentLifecycle", () => {
  it("always returns the fixed pipeline order", () => {
    expect(states({})).toEqual(["CREATED", "SIGNED", "SUBMITTED", "CONFIRMED"]);
  });

  it("CREATED: only the created step is reached", () => {
    const steps = derivePaymentLifecycle({ status: "CREATED" });
    expect(steps.map((s) => s.reached)).toEqual([true, false, false, false]);
    expect(stepState({ status: "CREATED" }, "CREATED")?.current).toBe(true);
  });

  it("SIGNED: created and signed reached", () => {
    const steps = derivePaymentLifecycle({ status: "SIGNED" });
    expect(steps.map((s) => s.reached)).toEqual([true, true, false, false]);
    expect(stepState({ status: "SIGNED" }, "SIGNED")?.current).toBe(true);
  });

  it("SUBMITTED: created, signed, submitted reached", () => {
    const steps = derivePaymentLifecycle({ status: "SUBMITTED" });
    expect(steps.map((s) => s.reached)).toEqual([true, true, true, false]);
    expect(stepState({ status: "SUBMITTED" }, "SUBMITTED")?.current).toBe(true);
  });

  it("PENDING/PROCESSING map to the submitted position", () => {
    expect(stepState({ status: "PENDING" }, "SUBMITTED")?.current).toBe(true);
    expect(stepState({ status: "PROCESSING" }, "SUBMITTED")?.current).toBe(true);
  });

  it("CONFIRMED: everything reached, terminal confirmed current", () => {
    const steps = derivePaymentLifecycle({ status: "CONFIRMED" });
    expect(steps.map((s) => s.reached)).toEqual([true, true, true, true]);
    const terminal = steps[steps.length - 1];
    expect(terminal.state).toBe("CONFIRMED");
    expect(terminal.current).toBe(true);
    expect(terminal.terminal).toBe(true);
  });

  it("COMPLETED maps to confirmed", () => {
    const steps = derivePaymentLifecycle({ status: "COMPLETED" });
    expect(steps[steps.length - 1].state).toBe("CONFIRMED");
    expect(steps[steps.length - 1].reached).toBe(true);
  });

  it("FAILED: only creation is reached, terminal step is failed (no fabricated stages)", () => {
    const steps = derivePaymentLifecycle({ status: "FAILED" });
    // The failure stage is not tracked — the timeline must not claim the
    // payment was signed or submitted.
    expect(steps.map((s) => s.reached)).toEqual([true, false, false, true]);
    const terminal = steps[steps.length - 1];
    expect(terminal.state).toBe("FAILED");
    expect(terminal.label).toBe("Failed");
    expect(terminal.current).toBe(true);
    expect(terminal.terminal).toBe(true);
  });

  it("CANCELLED: stops before signing and labels the terminal step Cancelled", () => {
    const steps = derivePaymentLifecycle({ status: "CANCELLED" });
    expect(steps.map((s) => s.reached)).toEqual([true, false, false, true]);
    const terminal = steps[steps.length - 1];
    expect(terminal.state).toBe("FAILED");
    expect(terminal.label).toBe("Cancelled");
    expect(terminal.current).toBe(true);
  });

  it("on-chain CANCELLED metadata marker terminates as cancelled", () => {
    const steps = derivePaymentLifecycle({ metadata: "CANCELLED", txHash: "abc" });
    expect(steps[steps.length - 1].label).toBe("Cancelled");
    expect(steps.map((s) => s.reached)).toEqual([true, false, false, true]);
  });

  it("on-chain record with a tx hash reaches confirmed", () => {
    const steps = derivePaymentLifecycle({ metadata: "RECORDED", txHash: "abc", timestamp: 1700000000 });
    expect(steps[steps.length - 1].state).toBe("CONFIRMED");
    expect(steps.map((s) => s.reached)).toEqual([true, true, true, true]);
  });

  it("on-chain record without a tx hash stays at created", () => {
    const steps = derivePaymentLifecycle({ metadata: "RECORDED" });
    expect(stepState({ metadata: "RECORDED" }, "CREATED")?.current).toBe(true);
    expect(steps.map((s) => s.reached)).toEqual([true, false, false, false]);
  });

  it("derives timestamps from ISO strings (DB records)", () => {
    const steps = derivePaymentLifecycle({
      status: "CONFIRMED",
      createdAt: "2024-01-01T00:00:00Z",
      completedAt: "2024-01-02T00:00:00Z",
    });
    expect(stepState({ status: "CONFIRMED", createdAt: "2024-01-01T00:00:00Z", completedAt: "2024-01-02T00:00:00Z" }, "CREATED")?.timestamp).toBe(1704067200);
    expect(steps[steps.length - 1].timestamp).toBe(1704153600);
  });

  it("uses on-chain unix-second timestamps", () => {
    const steps = derivePaymentLifecycle({ txHash: "abc", timestamp: 1700000000 });
    expect(stepState({ txHash: "abc", timestamp: 1700000000 }, "CREATED")?.timestamp).toBe(1700000000);
    expect(steps[steps.length - 1].timestamp).toBe(1700000000);
  });

  it("prefers DB createdAt over the on-chain timestamp", () => {
    const input: LifecycleInput = {
      createdAt: "2024-01-01T00:00:00Z",
      timestamp: 1700000000,
    };
    expect(stepState(input, "CREATED")?.timestamp).toBe(1704067200);
  });

  it("does not stamp timestamps on unreached steps", () => {
    const steps = derivePaymentLifecycle({ status: "SIGNED" });
    expect(stepState({ status: "SIGNED" }, "SUBMITTED")?.timestamp).toBeUndefined();
    expect(steps[steps.length - 1].timestamp).toBeUndefined();
  });
});
