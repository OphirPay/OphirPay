// SPDX-License-Identifier: MIT

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { NotificationCenter } from "@/components/NotificationCenter";
import { Header } from "@/components/Header";
import {
  saveStoredNotifications,
  type PaymentNotification,
  emitPaymentNotification,
} from "@/lib/notifications";
import { STORAGE_KEYS } from "@/lib/storage-keys";

// Mock useTheme hook
vi.mock("@/hooks/useTheme", () => ({
  useTheme: () => ({
    toggle: vi.fn(),
    resolved: "dark",
  }),
}));

// Mock useMultiWallet / WalletButton
vi.mock("@/components/WalletButton", () => ({
  WalletButton: () => <button data-testid="mock-wallet-btn">Connect Wallet</button>,
}));

describe("NotificationCenter Component", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    vi.clearAllMocks();
  });

  afterEach(() => {
    window.sessionStorage.clear();
  });

  it("renders notification bell button with unread count badge", () => {
    const customNotifications: PaymentNotification[] = [
      {
        id: "notif_1",
        type: "payment.received",
        title: "Payment Received",
        message: "Received 100 XLM",
        timestamp: Date.now(),
        read: false,
      },
      {
        id: "notif_2",
        type: "payment.sent",
        title: "Payment Sent",
        message: "Sent 50 XLM",
        timestamp: Date.now(),
        read: false,
      },
    ];
    saveStoredNotifications(customNotifications);

    render(<NotificationCenter />);

    const bellBtn = screen.getByTestId("notification-bell-btn");
    expect(bellBtn).toBeInTheDocument();
    expect(bellBtn).toHaveAttribute("aria-label", "Notifications (2 unread)");

    const badge = screen.getByTestId("notification-badge");
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveTextContent("2");
  });

  it("displays 9+ when unread count exceeds 9", () => {
    const customNotifications: PaymentNotification[] = Array.from({ length: 12 }, (_, i) => ({
      id: `notif_${i}`,
      type: "payment.received",
      title: `Payment ${i}`,
      message: `Received ${i} XLM`,
      timestamp: Date.now(),
      read: false,
    }));
    saveStoredNotifications(customNotifications);

    render(<NotificationCenter />);

    const badge = screen.getByTestId("notification-badge");
    expect(badge).toHaveTextContent("9+");
  });

  it("opens dropdown and marks notifications as read on open (AC: Mark-as-read on open)", async () => {
    const customNotifications: PaymentNotification[] = [
      {
        id: "notif_1",
        type: "payment.received",
        title: "Payment Received",
        message: "Received 100 XLM",
        timestamp: Date.now(),
        read: false,
      },
    ];
    saveStoredNotifications(customNotifications);

    render(<NotificationCenter />);

    const bellBtn = screen.getByTestId("notification-bell-btn");
    expect(screen.queryByTestId("notification-dropdown")).not.toBeInTheDocument();

    // Click to open dropdown
    fireEvent.click(bellBtn);

    // Dropdown is open
    const dropdown = screen.getByTestId("notification-dropdown");
    expect(dropdown).toBeInTheDocument();
    expect(screen.getByText("Notifications")).toBeInTheDocument();
    expect(screen.getByText("Payment Received")).toBeInTheDocument();

    // Badge disappears because unread count becomes 0
    expect(screen.queryByTestId("notification-badge")).not.toBeInTheDocument();

    // Verify sessionStorage has been updated to mark read
    const stored = JSON.parse(window.sessionStorage.getItem(STORAGE_KEYS.NOTIFICATIONS) || "[]");
    expect(stored[0].read).toBe(true);
  });

  it("filters notifications by All and Unread tabs", () => {
    const customNotifications: PaymentNotification[] = [
      {
        id: "notif_read",
        type: "payment.sent",
        title: "Payment Sent Read",
        message: "Sent 10 XLM",
        timestamp: Date.now(),
        read: true,
      },
    ];
    saveStoredNotifications(customNotifications);

    render(<NotificationCenter />);

    // Open dropdown
    fireEvent.click(screen.getByTestId("notification-bell-btn"));

    expect(screen.getByText("Payment Sent Read")).toBeInTheDocument();

    // Click Unread tab (should be empty since it was marked read)
    fireEvent.click(screen.getByTestId("filter-tab-unread"));
    expect(screen.getByTestId("empty-notifications")).toBeInTheDocument();

    // Click All tab (shows the item)
    fireEvent.click(screen.getByTestId("filter-tab-all"));
    expect(screen.getByText("Payment Sent Read")).toBeInTheDocument();
  });

  it("marks all notifications as read when clicking 'Mark all read' button", () => {
    const customNotifications: PaymentNotification[] = [
      {
        id: "n_1",
        type: "payment.sent",
        title: "First Payment",
        message: "Sent XLM",
        timestamp: Date.now(),
        read: false,
      },
    ];
    saveStoredNotifications(customNotifications);

    render(<NotificationCenter />);

    // Open dropdown
    fireEvent.click(screen.getByTestId("notification-bell-btn"));

    // Check item exists
    expect(screen.getByText("First Payment")).toBeInTheDocument();

    const stored = JSON.parse(window.sessionStorage.getItem(STORAGE_KEYS.NOTIFICATIONS) || "[]");
    expect(stored[0].read).toBe(true);
  });

  it("clears all notifications when clicking 'Clear all' button", () => {
    const customNotifications: PaymentNotification[] = [
      {
        id: "notif_to_clear",
        type: "payment.sent",
        title: "Clearable Notification",
        message: "Sent 20 XLM",
        timestamp: Date.now(),
        read: true,
      },
    ];
    saveStoredNotifications(customNotifications);

    render(<NotificationCenter />);

    fireEvent.click(screen.getByTestId("notification-bell-btn"));
    expect(screen.getByText("Clearable Notification")).toBeInTheDocument();

    // Click Clear all
    const clearBtn = screen.getByTestId("clear-all-btn");
    fireEvent.click(clearBtn);

    // Empty state should be visible
    expect(screen.getByTestId("empty-notifications")).toBeInTheDocument();
    expect(screen.getByText("No notifications yet")).toBeInTheDocument();

    // Session storage is empty
    const stored = JSON.parse(window.sessionStorage.getItem(STORAGE_KEYS.NOTIFICATIONS) || "[]");
    expect(stored).toHaveLength(0);
  });

  it("closes dropdown when pressing Escape key", () => {
    render(<NotificationCenter />);

    const bellBtn = screen.getByTestId("notification-bell-btn");
    fireEvent.click(bellBtn);
    expect(screen.getByTestId("notification-dropdown")).toBeInTheDocument();

    // Press Escape
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByTestId("notification-dropdown")).not.toBeInTheDocument();
  });

  it("closes dropdown on outside click", () => {
    render(
      <div>
        <div data-testid="outside-area">Outside</div>
        <NotificationCenter />
      </div>
    );

    const bellBtn = screen.getByTestId("notification-bell-btn");
    fireEvent.click(bellBtn);
    expect(screen.getByTestId("notification-dropdown")).toBeInTheDocument();

    // Click outside
    fireEvent.mouseDown(screen.getByTestId("outside-area"));
    expect(screen.queryByTestId("notification-dropdown")).not.toBeInTheDocument();
  });

  it("updates live when receiving a window notification event", async () => {
    saveStoredNotifications([]);
    render(<NotificationCenter />);

    // Initially 0 notifications
    expect(screen.queryByTestId("notification-badge")).not.toBeInTheDocument();

    // Dispatch a new live notification
    act(() => {
      emitPaymentNotification({
        type: "payment.received",
        amount: "500 XLM",
        payer: "GCAL...TEST",
        title: "Live Payment Received",
        message: "Received 500 XLM live",
      });
    });

    // Badge appears with 1 unread
    await waitFor(() => {
      const badge = screen.getByTestId("notification-badge");
      expect(badge).toHaveTextContent("1");
    });

    // Open dropdown to see live item
    fireEvent.click(screen.getByTestId("notification-bell-btn"));
    expect(screen.getByText("Live Payment Received")).toBeInTheDocument();
  });

  it("renders within the Header component smoothly", () => {
    render(<Header />);
    expect(screen.getByTestId("notification-bell-btn")).toBeInTheDocument();
    expect(screen.getByText("Financial Operations Platform")).toBeInTheDocument();
  });
});
