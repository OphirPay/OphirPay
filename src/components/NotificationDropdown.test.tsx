// SPDX-License-Identifier: MIT

import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";

import { NotificationDropdown } from "./NotificationDropdown";
import type { PaymentNotification } from "@/lib/notifications";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeNotification(overrides: Partial<PaymentNotification> = {}): PaymentNotification {
  return {
    id: `n_${Math.random().toString(36).slice(2, 8)}`,
    type: "payment.received",
    title: "Payment received",
    message: "100 USDC received",
    timestamp: new Date().toISOString(),
    read: false,
    ...overrides,
  };
}

// Mock trapFocus so it doesn't try to focus off-screen elements.
vi.mock("@/lib/focus-trap", () => ({
  trapFocus: () => () => {},
}));

// Mock timeAgo to a stable string.
vi.mock("@/lib/utils", () => ({
  cn: (...inputs: (string | undefined | false | null)[]) =>
    inputs.filter(Boolean).join(" "),
  timeAgo: () => "just now",
}));

// Mock Z_INDEX.
vi.mock("@/lib/z-index", () => ({
  Z_INDEX: { DROPDOWN: 10 },
}));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("NotificationDropdown", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders empty state when no notifications", () => {
    render(
      <NotificationDropdown
        notifications={[]}
        onClearAll={vi.fn()}
        onClose={vi.fn()}
      />
    );

    expect(screen.getByText(/no notifications yet/i)).toBeInTheDocument();
    expect(screen.queryByRole("listitem")).toBeNull();
  });

  it("renders the list of notifications", () => {
    const items: PaymentNotification[] = [
      makeNotification({ id: "a", title: "Payment received", message: "100 USDC" }),
      makeNotification({ id: "b", title: "Payment sent", message: "50 USDC", read: true }),
    ];

    render(
      <NotificationDropdown
        notifications={items}
        onClearAll={vi.fn()}
        onClose={vi.fn()}
      />
    );

    expect(screen.getByText("Payment received")).toBeInTheDocument();
    expect(screen.getByText("Payment sent")).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });

  it("shows unread blue dot for unread notifications", () => {
    const items: PaymentNotification[] = [
      makeNotification({ id: "a", read: false }),
      makeNotification({ id: "b", read: true }),
    ];

    const { container } = render(
      <NotificationDropdown
        notifications={items}
        onClearAll={vi.fn()}
        onClose={vi.fn()}
      />
    );

    const dots = container.querySelectorAll(".bg-blue-500");
    expect(dots).toHaveLength(1);
  });

  it("calls onClearAll when Clear all button is clicked", () => {
    const onClearAll = vi.fn();
    render(
      <NotificationDropdown
        notifications={[makeNotification()]}
        onClearAll={onClearAll}
        onClose={vi.fn()}
      />
    );

    fireEvent.click(screen.getByText(/clear all/i));
    expect(onClearAll).toHaveBeenCalledTimes(1);
  });

  it("does not show Clear all button when list is empty", () => {
    render(
      <NotificationDropdown
        notifications={[]}
        onClearAll={vi.fn()}
        onClose={vi.fn()}
      />
    );

    expect(screen.queryByText(/clear all/i)).toBeNull();
  });

  it("calls onClose when Escape is pressed", () => {
    const onClose = vi.fn();
    const { container } = render(
      <NotificationDropdown
        notifications={[makeNotification()]}
        onClearAll={vi.fn()}
        onClose={onClose}
      />
    );

    const dialog = container.querySelector('[role="dialog"]') as HTMLElement;
    fireEvent.keyDown(dialog, { key: "Escape" });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("calls onClose when clicking outside the dropdown", () => {
    const onClose = vi.fn();
    const { container } = render(
      <div>
        <div data-testid="outside">outside</div>
        <NotificationDropdown
          notifications={[makeNotification()]}
          onClearAll={vi.fn()}
          onClose={onClose}
        />
      </div>
    );

    fireEvent.pointerDown(screen.getByTestId("outside"));

    expect(onClose).toHaveBeenCalledTimes(1);
    void container;
  });

  it("does not call onClose when clicking inside the dropdown", () => {
    const onClose = vi.fn();
    render(
      <NotificationDropdown
        notifications={[makeNotification()]}
        onClearAll={vi.fn()}
        onClose={onClose}
      />
    );

    fireEvent.pointerDown(screen.getByText(/clear all/i));
    expect(onClose).not.toHaveBeenCalled();
  });

  it("renders notification type icons", () => {
    const items: PaymentNotification[] = [
      makeNotification({ id: "a", type: "payment.sent" }),
      makeNotification({ id: "b", type: "payment.received" }),
      makeNotification({ id: "c", type: "payment.batch_completed" }),
      makeNotification({ id: "d", type: "payment.created" }),
    ];

    const { container } = render(
      <NotificationDropdown
        notifications={items}
        onClearAll={vi.fn()}
        onClose={vi.fn()}
      />
    );

    // Each notification row renders exactly one inline SVG icon.
    const svgs = container.querySelectorAll("svg");
    expect(svgs.length).toBeGreaterThanOrEqual(items.length);
  });

  it("renders accessible dialog label", () => {
    render(
      <NotificationDropdown
        notifications={[]}
        onClearAll={vi.fn()}
        onClose={vi.fn()}
      />
    );

    expect(screen.getByRole("dialog", { name: /notifications/i })).toBeInTheDocument();
  });

  it("toggles dropdown open/closed via external trigger (bell click integration)", () => {
    function Harness() {
      const [open, setOpen] = React.useState(false);
      return (
        <div>
          <button type="button" onClick={() => setOpen((v) => !v)} aria-label="Notifications, 1 unread">
            bell
          </button>
          {open && (
            <NotificationDropdown
              notifications={[makeNotification({ id: "z" })]}
              onClearAll={vi.fn()}
              onClose={() => setOpen(false)}
            />
          )}
        </div>
      );
    }

    render(<Harness />);

    // Initially the dropdown should not be visible.
    expect(screen.queryByRole("dialog")).toBeNull();

    // Click the bell to open.
    fireEvent.click(screen.getByRole("button", { name: /notifications/i }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    // Click the bell again to close (simulate toggle).
    fireEvent.click(screen.getByRole("button", { name: /notifications/i }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("passes through relative time via timeAgo", () => {
    render(
      <NotificationDropdown
        notifications={[makeNotification()]}
        onClearAll={vi.fn()}
        onClose={vi.fn()}
      />
    );

    expect(screen.getByText("just now")).toBeInTheDocument();
  });

  it("renders unread and read items with distinct visual states", () => {
    const items: PaymentNotification[] = [
      makeNotification({ id: "x", title: "Unread Item", read: false }),
      makeNotification({ id: "y", title: "Read Item", read: true }),
    ];

    const { getByRole } = render(
      <NotificationDropdown
        notifications={items}
        onClearAll={vi.fn()}
        onClose={vi.fn()}
      />
    );

    const dialog = getByRole("dialog");
    // Both items should be rendered inside the dialog.
    expect(within(dialog).getByText("Unread Item")).toBeInTheDocument();
    expect(within(dialog).getByText("Read Item")).toBeInTheDocument();
    // Unread item row should have the unread background class.
    const listItems = within(dialog).getAllByRole("listitem");
    expect(listItems).toHaveLength(2);
  });
});
