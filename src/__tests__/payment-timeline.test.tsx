// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PaymentTimeline } from "@/components/payments/PaymentTimeline";
import { derivePaymentLifecycle } from "@/lib/payment-lifecycle";

const EXPLORER = "https://stellar.expert/explorer/testnet/tx/abcdef";

function renderFor(input: Parameters<typeof derivePaymentLifecycle>[0]) {
  const steps = derivePaymentLifecycle(input);
  return render(<PaymentTimeline steps={steps} explorerUrl={EXPLORER} />);
}

describe("PaymentTimeline", () => {
  it("renders the pipeline with an accessible label", () => {
    renderFor({ status: "CREATED" });
    expect(screen.getByRole("list", { name: /payment lifecycle/i })).toBeInTheDocument();
    expect(screen.getByText("Created")).toBeInTheDocument();
    expect(screen.getByText("Signed")).toBeInTheDocument();
    expect(screen.getByText("Submitted")).toBeInTheDocument();
    expect(screen.getByText("Confirmed")).toBeInTheDocument();
  });

  it("CREATED render: marks created as current, others pending", () => {
    renderFor({ status: "CREATED" });
    const current = screen.getAllByText("Current");
    expect(current).toHaveLength(1);
    // No completed check icons yet — nothing past created is reached
    expect(screen.queryByText("View on explorer")).toBeNull();
  });

  it("SIGNED render: signed is current", () => {
    renderFor({ status: "SIGNED" });
    expect(screen.getAllByText("Current")).toHaveLength(1);
    expect(screen.getByText("Transaction signed by the wallet")).toBeInTheDocument();
  });

  it("SUBMITTED render: submitted is current", () => {
    renderFor({ status: "SUBMITTED" });
    expect(screen.getAllByText("Current")).toHaveLength(1);
    expect(screen.getByText("Transaction submitted to the network")).toBeInTheDocument();
  });

  it("CONFIRMED render: confirmed is current with an explorer link", () => {
    renderFor({ status: "CONFIRMED", createdAt: "2024-01-01T00:00:00Z" });
    expect(screen.getAllByText("Current")).toHaveLength(1);
    expect(screen.getByText("Transaction confirmed on-chain")).toBeInTheDocument();
    const link = screen.getByRole("link", { name: /view on explorer/i });
    expect(link).toHaveAttribute("href", EXPLORER);
    expect(link).toHaveAttribute("target", "_blank");
  });

  it("FAILED render: failed terminal step with explorer link", () => {
    renderFor({ status: "FAILED" });
    expect(screen.getByText("Failed")).toBeInTheDocument();
    expect(screen.getByText("Payment failed before confirmation")).toBeInTheDocument();
    const failed = screen.getByText("Failed").closest("p");
    expect(failed?.className).toContain("red");
    expect(screen.getByRole("link", { name: /view on explorer/i })).toBeInTheDocument();
  });

  it("CANCELLED render: labels the terminal step Cancelled", () => {
    renderFor({ status: "CANCELLED" });
    expect(screen.getByText("Cancelled")).toBeInTheDocument();
    expect(screen.getByText("Payment was cancelled before completion")).toBeInTheDocument();
  });

  it("renders reached-step timestamps as <time> elements", () => {
    renderFor({ status: "CONFIRMED", createdAt: "2024-01-01T00:00:00Z" });
    const times = document.querySelectorAll("time");
    expect(times.length).toBeGreaterThan(0);
    expect(times[0]).toHaveAttribute("datetime");
  });

  it("does not render the explorer link before the terminal step is reached", () => {
    renderFor({ status: "CREATED" });
    expect(screen.queryByRole("link", { name: /view on explorer/i })).toBeNull();
  });
});
