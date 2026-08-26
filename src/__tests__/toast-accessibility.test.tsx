// SPDX-License-Identifier: MIT
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { ToastProvider, useToast } from "@/components/ui/Toast";

function ToastTestHost() {
  const toast = useToast();
  return (
    <div>
      <button
        data-testid="success-btn"
        onClick={() => toast.success("Payment Sent", "100 XLM transferred successfully")}
      >
        Send Success Toast
      </button>
      <button
        data-testid="error-btn"
        onClick={() => toast.error("Transaction Failed", "Insufficient account balance")}
      >
        Send Error Toast
      </button>
      <button
        data-testid="info-btn"
        onClick={() => toast.info("Network Update", "New ledger confirmed")}
      >
        Send Info Toast
      </button>
      <button
        data-testid="warning-btn"
        onClick={() => toast.warning("High Congestion", "Fees may be higher")}
      >
        Send Warning Toast
      </button>
    </div>
  );
}

describe("Toast / Payment Announcement Accessibility (aria-live)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders polite live region and announces success outcome with role status", () => {
    render(
      <ToastProvider>
        <ToastTestHost />
      </ToastProvider>
    );

    const politeRegion = screen.getByTestId("toast-live-polite");
    expect(politeRegion).toHaveAttribute("aria-live", "polite");
    expect(politeRegion).toHaveAttribute("role", "status");

    fireEvent.click(screen.getByTestId("success-btn"));

    expect(politeRegion).toHaveTextContent("Payment Sent: 100 XLM transferred successfully");
    expect(screen.getByTestId("toast-success")).toBeInTheDocument();
  });

  it("renders assertive live region and announces error outcome with role alert", () => {
    render(
      <ToastProvider>
        <ToastTestHost />
      </ToastProvider>
    );

    const assertiveRegion = screen.getByTestId("toast-live-assertive");
    expect(assertiveRegion).toHaveAttribute("aria-live", "assertive");
    expect(assertiveRegion).toHaveAttribute("role", "alert");

    fireEvent.click(screen.getByTestId("error-btn"));

    expect(assertiveRegion).toHaveTextContent("Transaction Failed: Insufficient account balance");
    expect(screen.getByTestId("toast-error")).toBeInTheDocument();
  });

  it("announces info and warning variants politely", () => {
    render(
      <ToastProvider>
        <ToastTestHost />
      </ToastProvider>
    );

    const politeRegion = screen.getByTestId("toast-live-polite");

    fireEvent.click(screen.getByTestId("info-btn"));
    expect(politeRegion).toHaveTextContent("Network Update: New ledger confirmed");

    fireEvent.click(screen.getByTestId("warning-btn"));
    expect(politeRegion).toHaveTextContent("High Congestion: Fees may be higher");
  });

  it("deduplicates announcements and does not re-announce on re-renders", () => {
    const { rerender } = render(
      <ToastProvider>
        <ToastTestHost />
      </ToastProvider>
    );

    const politeRegion = screen.getByTestId("toast-live-polite");
    fireEvent.click(screen.getByTestId("success-btn"));
    expect(politeRegion).toHaveTextContent("Payment Sent: 100 XLM transferred successfully");

    // Re-render the parent tree
    rerender(
      <ToastProvider>
        <ToastTestHost />
      </ToastProvider>
    );

    // Announcement text remains stable without emitting duplicate text
    expect(politeRegion).toHaveTextContent("Payment Sent: 100 XLM transferred successfully");
  });

  it("provides accessible dismiss button and removes toast on click", () => {
    render(
      <ToastProvider>
        <ToastTestHost />
      </ToastProvider>
    );

    fireEvent.click(screen.getByTestId("success-btn"));
    const dismissBtn = screen.getByRole("button", { name: "Dismiss notification" });
    expect(dismissBtn).toBeInTheDocument();

    fireEvent.click(dismissBtn);
    expect(screen.queryByTestId("toast-success")).toBeNull();
  });

  it("automatically dismisses toast after timeout", () => {
    render(
      <ToastProvider>
        <ToastTestHost />
      </ToastProvider>
    );

    fireEvent.click(screen.getByTestId("success-btn"));
    expect(screen.getByTestId("toast-success")).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(5100);
    });

    expect(screen.queryByTestId("toast-success")).toBeNull();
  });
});
