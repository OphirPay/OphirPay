// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import {
  buildPaymentTimeline,
  isTerminalStatus,
  PAYMENT_STATUSES,
  type TimelineStep,
} from "@/lib/payment-timeline";
import { PaymentTimeline } from "@/components/PaymentTimeline";

const stateOf = (steps: TimelineStep[], key: string) =>
  steps.find((s) => s.key === key)?.state;

// ─── Timeline derivation ────────────────────────────────────────

describe("buildPaymentTimeline", () => {
  it("always returns the four lifecycle steps in order", () => {
    for (const status of PAYMENT_STATUSES) {
      const steps = buildPaymentTimeline({ status });
      expect(steps.map((s) => s.key)).toEqual([
        "created",
        "signed",
        "submitted",
        "confirmed",
      ]);
    }
  });

  it("marks every step done once completed", () => {
    const steps = buildPaymentTimeline({ status: "COMPLETED" });
    expect(steps.every((s) => s.state === "done")).toBe(true);
  });

  it("awaits confirmation while processing", () => {
    const steps = buildPaymentTimeline({ status: "PROCESSING" });
    expect(stateOf(steps, "submitted")).toBe("done");
    expect(stateOf(steps, "confirmed")).toBe("current");
  });

  it("awaits submission while pending", () => {
    const steps = buildPaymentTimeline({ status: "PENDING" });
    expect(stateOf(steps, "signed")).toBe("done");
    expect(stateOf(steps, "submitted")).toBe("current");
    expect(stateOf(steps, "confirmed")).toBe("upcoming");
  });

  it("awaits signing when only created", () => {
    const steps = buildPaymentTimeline({ status: "CREATED" });
    expect(stateOf(steps, "created")).toBe("done");
    expect(stateOf(steps, "signed")).toBe("current");
  });

  it("places a failure AFTER submission when a transaction hash exists", () => {
    // The network saw it and rejected it.
    const steps = buildPaymentTimeline({
      status: "FAILED",
      transactionHash: "abc123",
    });
    expect(stateOf(steps, "submitted")).toBe("done");
    expect(stateOf(steps, "confirmed")).toBe("failed");
  });

  it("places a failure AT submission when no transaction hash exists", () => {
    // It never reached the network, so claiming it was submitted would be wrong.
    const steps = buildPaymentTimeline({ status: "FAILED" });
    expect(stateOf(steps, "submitted")).toBe("failed");
    expect(stateOf(steps, "confirmed")).toBe("skipped");
  });

  it("treats an empty transaction hash as absent", () => {
    const steps = buildPaymentTimeline({ status: "FAILED", transactionHash: "" });
    expect(stateOf(steps, "submitted")).toBe("failed");
  });

  it("skips the remaining steps when cancelled rather than leaving them upcoming", () => {
    // `upcoming` would tell the user a cancelled payment is still on its way.
    const steps = buildPaymentTimeline({ status: "CANCELLED" });
    expect(stateOf(steps, "created")).toBe("done");
    expect(stateOf(steps, "signed")).toBe("skipped");
    expect(stateOf(steps, "submitted")).toBe("skipped");
    expect(stateOf(steps, "confirmed")).toBe("skipped");
  });

  it("falls back to the created state for an unrecognised status", () => {
    // The page must still render if the enum gains a value the UI is unaware of.
    const steps = buildPaymentTimeline({ status: "SOMETHING_NEW" });
    expect(stateOf(steps, "created")).toBe("done");
    expect(stateOf(steps, "signed")).toBe("current");
  });

  it("never reports more than one current step", () => {
    for (const status of PAYMENT_STATUSES) {
      const steps = buildPaymentTimeline({ status });
      expect(steps.filter((s) => s.state === "current").length).toBeLessThanOrEqual(1);
    }
  });
});

describe("isTerminalStatus", () => {
  it.each(["COMPLETED", "FAILED", "CANCELLED"])("%s is terminal", (s) => {
    expect(isTerminalStatus(s)).toBe(true);
  });

  it.each(["CREATED", "PENDING", "PROCESSING"])("%s is not terminal", (s) => {
    expect(isTerminalStatus(s)).toBe(false);
  });
});

// ─── Component render, per status ───────────────────────────────

describe("PaymentTimeline", () => {
  it.each(PAYMENT_STATUSES)("renders all four steps for %s", (status) => {
    render(<PaymentTimeline steps={buildPaymentTimeline({ status })} />);
    const list = screen.getByRole("list", { name: /payment lifecycle/i });
    expect(within(list).getAllByRole("listitem")).toHaveLength(4);
    for (const label of ["Created", "Signed", "Submitted", "Confirmed"]) {
      expect(within(list).getByText(label)).toBeInTheDocument();
    }
  });

  it("describes a completed payment as fully completed", () => {
    render(<PaymentTimeline steps={buildPaymentTimeline({ status: "COMPLETED" })} />);
    expect(screen.getAllByText("completed")).toHaveLength(4);
  });

  it("shows a failed step for a rejected transaction", () => {
    render(
      <PaymentTimeline
        steps={buildPaymentTimeline({ status: "FAILED", transactionHash: "h" })}
      />
    );
    expect(screen.getByText("failed")).toBeInTheDocument();
  });

  it("shows skipped steps for a cancelled payment", () => {
    render(<PaymentTimeline steps={buildPaymentTimeline({ status: "CANCELLED" })} />);
    expect(screen.getAllByText("skipped")).toHaveLength(3);
  });

  it("shows an in-progress step while processing", () => {
    render(<PaymentTimeline steps={buildPaymentTimeline({ status: "PROCESSING" })} />);
    expect(screen.getByText("in progress")).toBeInTheDocument();
  });

  it("states each step's status in text, not by colour alone", () => {
    // Marker colour is the only other signal, so the text is what makes this
    // readable to assistive tech and to colour-blind users.
    render(<PaymentTimeline steps={buildPaymentTimeline({ status: "PENDING" })} />);
    const list = screen.getByRole("list", { name: /payment lifecycle/i });
    for (const item of within(list).getAllByRole("listitem")) {
      expect(item.textContent).toMatch(
        /completed|in progress|not started|failed|skipped/
      );
    }
  });
});
