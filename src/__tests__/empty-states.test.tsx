// SPDX-License-Identifier: MIT
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { EmptyState } from "@/components/EmptyState";

describe("EmptyState Component for List Pages", () => {
  it("renders title, description, and icon", () => {
    render(
      <EmptyState
        icon={<span data-testid="empty-icon">📦</span>}
        title="No Records Found"
        description="There are currently no items in this list."
      />
    );

    expect(screen.getByTestId("empty-icon")).toBeInTheDocument();
    expect(screen.getByText("No Records Found")).toBeInTheDocument();
    expect(
      screen.getByText("There are currently no items in this list.")
    ).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("renders primary action button and fires onAction callback", () => {
    const onAction = vi.fn();
    render(
      <EmptyState
        icon={<span>💳</span>}
        title="No Payments Recorded"
        description="Send your first on-chain Stellar payment."
        actionLabel="Send Payment"
        onAction={onAction}
      />
    );

    const button = screen.getByRole("button", { name: /send payment/i });
    expect(button).toBeInTheDocument();

    fireEvent.click(button);
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it("renders batch empty state properly", () => {
    const onAction = vi.fn();
    render(
      <EmptyState
        icon={<span>📦</span>}
        title="No Batch Payments Yet"
        description="Create batch payments for payroll, vendor payments, and grant distributions."
        actionLabel="Create Batch"
        onAction={onAction}
      />
    );

    expect(screen.getByText("No Batch Payments Yet")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /create batch/i })
    ).toBeInTheDocument();
  });

  it("renders webhook empty state properly", () => {
    const onAction = vi.fn();
    render(
      <EmptyState
        icon={<span>🔔</span>}
        title="No Webhooks Configured"
        description="Add a webhook endpoint to receive notifications."
        actionLabel="Add Webhook"
        onAction={onAction}
      />
    );

    expect(screen.getByText("No Webhooks Configured")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /add webhook/i })
    ).toBeInTheDocument();
  });

  it("renders audit log empty state properly", () => {
    render(
      <EmptyState
        icon={<span>📋</span>}
        title="No Audit Entries"
        description="Contract activity will appear here as state changes occur."
      />
    );

    expect(screen.getByText("No Audit Entries")).toBeInTheDocument();
  });
});
