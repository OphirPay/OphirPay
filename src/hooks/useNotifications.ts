"use client";
// SPDX-License-Identifier: MIT

import { useState, useEffect, useCallback, useRef } from "react";
import {
  type PaymentNotification,
  type RawPaymentEventPayload,
  getStoredNotifications,
  saveStoredNotifications,
  normalizePaymentEvent,
} from "@/lib/notifications";

export function useNotifications() {
  // Start from an empty list so the server-rendered HTML and the client's
  // first render always agree (sessionStorage does not exist during SSR, so
  // reading it here would render the seed badge on the server but the stored
  // state on the client — a hydration mismatch that leaves a stale unread
  // badge that never reconciles). The stored notifications are loaded in an
  // effect after mount instead.
  const [notifications, setNotifications] = useState<PaymentNotification[]>([]);

  // Load persisted notifications once the client has hydrated.
  useEffect(() => {
    setNotifications(getStoredNotifications());
  }, []);
  const [isOpen, setIsOpen] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const eventSourceRef = useRef<EventSource | null>(null);

  // Sync to session storage on notification updates
  const updateNotifications = useCallback((updater: (prev: PaymentNotification[]) => PaymentNotification[]) => {
    setNotifications((prev) => {
      const next = updater(prev);
      saveStoredNotifications(next);
      return next;
    });
  }, []);

  // Mark single item as read
  const markAsRead = useCallback((id: string) => {
    updateNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, read: true } : n))
    );
  }, [updateNotifications]);

  // Mark all as read
  const markAllAsRead = useCallback(() => {
    updateNotifications((prev) =>
      prev.map((n) => (n.read ? n : { ...n, read: true }))
    );
  }, [updateNotifications]);

  // Clear all notifications
  const clearAll = useCallback(() => {
    updateNotifications(() => []);
  }, [updateNotifications]);

  // Add a new notification
  const addNotification = useCallback((raw: RawPaymentEventPayload) => {
    const normalized = normalizePaymentEvent(raw);
    updateNotifications((prev) => {
      // Deduplicate by ID or txHash
      if (prev.some((n) => n.id === normalized.id || (n.txHash && normalized.txHash && n.txHash === normalized.txHash))) {
        return prev;
      }
      return [normalized, ...prev].slice(0, 50);
    });
  }, [updateNotifications]);

  // Toggle open and mark all as read on open (per acceptance criteria)
  const toggleOpen = useCallback(() => {
    setIsOpen((prev) => {
      const next = !prev;
      if (next) {
        markAllAsRead();
      }
      return next;
    });
  }, [markAllAsRead]);

  const setOpen = useCallback((open: boolean) => {
    if (open) {
      markAllAsRead();
    }
    setIsOpen(open);
  }, [markAllAsRead]);

  // Listen to custom window events
  useEffect(() => {
    if (typeof window === "undefined") return;

    const handleCustomEvent = (e: Event) => {
      const customEvent = e as CustomEvent<PaymentNotification>;
      if (customEvent.detail) {
        addNotification(customEvent.detail);
      }
    };

    window.addEventListener("ophirpay:notification", handleCustomEvent);
    return () => {
      window.removeEventListener("ophirpay:notification", handleCustomEvent);
    };
  }, [addNotification]);

  // Connect to SSE for live events
  useEffect(() => {
    if (typeof window === "undefined" || typeof EventSource === "undefined") {
      return;
    }

    let es: EventSource | null = null;
    try {
      es = new EventSource("/api/events");
      eventSourceRef.current = es;

      es.addEventListener("connected", () => {
        setIsConnected(true);
      });

      es.addEventListener("payment:created", (e: MessageEvent) => {
        try {
          const data = JSON.parse(e.data);
          addNotification(data);
        } catch {
          // ignore parse error
        }
      });

      es.onerror = () => {
        setIsConnected(false);
      };
    } catch {
      setIsConnected(false);
    }

    return () => {
      if (es) {
        es.close();
      }
      eventSourceRef.current = null;
    };
  }, [addNotification]);

  const unreadCount = notifications.filter((n) => !n.read).length;

  return {
    notifications,
    unreadCount,
    hasUnread: unreadCount > 0,
    isOpen,
    isConnected,
    toggleOpen,
    setOpen,
    markAsRead,
    markAllAsRead,
    clearAll,
    addNotification,
  };
}
