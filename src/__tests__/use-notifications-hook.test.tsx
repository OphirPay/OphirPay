// SPDX-License-Identifier: MIT

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useNotifications } from "@/hooks/useNotifications";
import {
  saveStoredNotifications,
  type PaymentNotification,
} from "@/lib/notifications";

// ── Minimal EventSource stand-in so the SSE effect can be exercised ──

type SSEHandler = (event: { data?: string }) => void;

class MockEventSource {
  static instances: MockEventSource[] = [];

  readonly url: string;
  listeners: Record<string, SSEHandler[]> = {};
  onerror: (() => void) | null = null;
  closed = false;

  constructor(url: string) {
    this.url = url;
    MockEventSource.instances.push(this);
  }

  addEventListener(type: string, handler: SSEHandler): void {
    const list = this.listeners[type] ?? [];
    list.push(handler);
    this.listeners[type] = list;
  }

  removeEventListener(type: string, handler: SSEHandler): void {
    this.listeners[type] = (this.listeners[type] ?? []).filter(
      (h) => h !== handler
    );
  }

  /** Fire a typed SSE event, JSON-encoding the payload like the browser would. */
  emit(type: string, payload?: unknown): void {
    const event = payload === undefined ? {} : { data: JSON.stringify(payload) };
    for (const handler of this.listeners[type] ?? []) handler(event);
  }

  close(): void {
    this.closed = true;
  }
}

const makeNotif = (id: string, read = false): PaymentNotification => ({
  id,
  type: "payment.sent",
  title: `Title ${id}`,
  message: "Test message",
  timestamp: Date.now(),
  read,
});

beforeEach(() => {
  window.sessionStorage.clear();
  MockEventSource.instances.length = 0;
  (globalThis as Record<string, unknown>).EventSource = MockEventSource;
});

afterEach(() => {
  Reflect.deleteProperty(globalThis, "EventSource");
});

describe("useNotifications", () => {
  it("initializes from stored notifications", () => {
    saveStoredNotifications([makeNotif("n1"), makeNotif("n2", true)]);
    const { result } = renderHook(() => useNotifications());

    expect(result.current.notifications).toHaveLength(2);
    expect(result.current.unreadCount).toBe(1);
    expect(result.current.hasUnread).toBe(true);
  });

  it("marks a single notification as read", () => {
    saveStoredNotifications([makeNotif("n1")]);
    const { result } = renderHook(() => useNotifications());

    act(() => result.current.markAsRead("n1"));

    expect(result.current.notifications[0].read).toBe(true);
    expect(result.current.unreadCount).toBe(0);
  });

  it("marks all notifications as read", () => {
    saveStoredNotifications([makeNotif("n1"), makeNotif("n2")]);
    const { result } = renderHook(() => useNotifications());

    act(() => result.current.markAllAsRead());

    expect(result.current.unreadCount).toBe(0);
  });

  it("clears all notifications", () => {
    saveStoredNotifications([makeNotif("n1")]);
    const { result } = renderHook(() => useNotifications());

    act(() => result.current.clearAll());

    expect(result.current.notifications).toHaveLength(0);
    expect(result.current.unreadCount).toBe(0);
  });

  it("adds a new notification to the front of the list", () => {
    saveStoredNotifications([]);
    const { result } = renderHook(() => useNotifications());

    act(() =>
      result.current.addNotification({
        type: "payment.received",
        amount: "10 XLM",
        payer: "GCAL...5678",
        txHash: "tx-1",
      })
    );

    expect(result.current.notifications[0].txHash).toBe("tx-1");
    expect(result.current.unreadCount).toBe(1);
  });

  it("deduplicates notifications that share a txHash", () => {
    saveStoredNotifications([]);
    const { result } = renderHook(() => useNotifications());

    act(() => {
      result.current.addNotification({
        type: "payment.received",
        amount: "10 XLM",
        payer: "GCAL...5678",
        txHash: "tx-dup",
      });
      result.current.addNotification({
        type: "payment.received",
        amount: "10 XLM",
        payer: "GCAL...5678",
        txHash: "tx-dup",
      });
    });

    expect(result.current.notifications).toHaveLength(1);
  });

  it("caps the list at 50 notifications", () => {
    saveStoredNotifications([]);
    const { result } = renderHook(() => useNotifications());

    act(() => {
      for (let i = 0; i < 55; i += 1) {
        result.current.addNotification({
          type: "payment.received",
          amount: "10 XLM",
          payer: "GCAL...5678",
          txHash: `tx-${i}`,
        });
      }
    });

    expect(result.current.notifications).toHaveLength(50);
  });

  it("toggleOpen opens the panel and marks everything read", () => {
    saveStoredNotifications([makeNotif("n1"), makeNotif("n2")]);
    const { result } = renderHook(() => useNotifications());

    act(() => result.current.toggleOpen());
    expect(result.current.isOpen).toBe(true);
    expect(result.current.unreadCount).toBe(0);

    act(() => result.current.toggleOpen());
    expect(result.current.isOpen).toBe(false);
  });

  it("setOpen(true) marks everything read", () => {
    saveStoredNotifications([makeNotif("n1")]);
    const { result } = renderHook(() => useNotifications());

    act(() => result.current.setOpen(true));

    expect(result.current.isOpen).toBe(true);
    expect(result.current.unreadCount).toBe(0);
  });

  it("connects to the SSE stream and flips isConnected on 'connected'", () => {
    const { result } = renderHook(() => useNotifications());

    expect(MockEventSource.instances).toHaveLength(1);
    expect(MockEventSource.instances[0].url).toBe("/api/events");
    expect(result.current.isConnected).toBe(false);

    act(() => MockEventSource.instances[0].emit("connected"));
    expect(result.current.isConnected).toBe(true);
  });

  it("appends notifications from payment:created SSE events", () => {
    const { result } = renderHook(() => useNotifications());

    act(() =>
      MockEventSource.instances[0].emit("payment:created", {
        type: "payment.sent",
        amount: "50000000",
        payee: "GBBD7KVXOMWBKLY2C7Q6RN2P2VY3NXN3T1234",
        txHash: "sse-tx-1",
      })
    );

    expect(result.current.notifications[0].txHash).toBe("sse-tx-1");
  });

  it("ignores malformed SSE payloads", () => {
    saveStoredNotifications([]);
    const { result } = renderHook(() => useNotifications());

    act(() => {
      for (const handler of MockEventSource.instances[0].listeners["payment:created"] ?? []) {
        handler({ data: "{ definitely not json" });
      }
    });

    expect(result.current.notifications).toHaveLength(0);
  });

  it("marks the stream disconnected on error", () => {
    const { result } = renderHook(() => useNotifications());

    act(() => {
      MockEventSource.instances[0].onerror?.();
    });

    expect(result.current.isConnected).toBe(false);
  });

  it("listens for custom window events and dedupes by id", () => {
    saveStoredNotifications([]);
    const { result } = renderHook(() => useNotifications());
    const notif: PaymentNotification = { ...makeNotif("dup-1"), txHash: "tx-same" };

    act(() => {
      window.dispatchEvent(new CustomEvent("ophirpay:notification", { detail: notif }));
      window.dispatchEvent(new CustomEvent("ophirpay:notification", { detail: notif }));
    });

    expect(result.current.notifications).toHaveLength(1);
    expect(result.current.notifications[0].id).toBe("dup-1");
  });

  it("closes the stream on unmount", () => {
    const { unmount } = renderHook(() => useNotifications());

    unmount();

    expect(MockEventSource.instances[0].closed).toBe(true);
  });
});
