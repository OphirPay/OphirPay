// SPDX-License-Identifier: MIT

"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  type AppNotification,
  type NotificationType,
  appendNotification,
  createNotification,
} from "@/lib/notifications";
import { STORAGE_KEYS } from "@/lib/storage-keys";

interface SSEPaymentEvent {
  event: "payment:created";
  timestamp: string;
  paymentId?: string;
  status?: string;
  emitter?: string;
  payer?: string;
  payee?: string;
  amount?: string;
  txHash?: string;
}

function loadNotifications(): AppNotification[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = sessionStorage.getItem(STORAGE_KEYS.NOTIFICATIONS);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed as AppNotification[];
  } catch {
    return [];
  }
}

function saveNotifications(list: AppNotification[]): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(STORAGE_KEYS.NOTIFICATIONS, JSON.stringify(list));
  } catch {
    // Ignore quota errors.
  }
}

export interface UseNotificationsResult {
  notifications: AppNotification[];
  unreadCount: number;
  isOpen: boolean;
  toggleOpen: () => void;
  setOpen: (open: boolean) => void;
  markAllRead: () => void;
  clearAll: () => void;
}

export function useNotifications(): UseNotificationsResult {
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const isOpenRef = useRef(false);

  // Derived unread count from the notifications list.
  const unreadCount = useMemo(
    () => notifications.filter((n) => !n.read).length,
    [notifications]
  );

  // Keep ref in sync so SSE handler can read current open state.
  useEffect(() => {
    isOpenRef.current = isOpen;
  }, [isOpen]);

  // Load persisted notifications on mount.
  useEffect(() => {
    setNotifications(loadNotifications());
  }, []);

  // Persist notifications whenever the list changes.
  useEffect(() => {
    saveNotifications(notifications);
  }, [notifications]);

  const addNotification = useCallback((type: NotificationType, data: {
    amount?: string;
    from?: string;
    to?: string;
    txHash?: string;
    recipients?: number;
  }) => {
    const n = createNotification(type, data);
    // If the dropdown is open, the new notification arrives already read.
    if (isOpenRef.current) {
      n.read = true;
    }
    setNotifications((prev) => appendNotification(prev, n));
  }, []);

  // Connect to SSE /api/events and listen for named "payment:created" events.
  // The SSE endpoint emits: event: payment:created\ndata: {...}\n\n
  // Using addEventListener with the event name ensures we only receive
  // payment:created events, not heartbeat or connected events.
  useEffect(() => {
    if (typeof window === "undefined") return;
    let es: EventSource | null = null;
    try {
      es = new EventSource("/api/events");
    } catch {
      return;
    }

    const handler = (e: MessageEvent) => {
      let payload: SSEPaymentEvent;
      try {
        payload = JSON.parse(e.data) as SSEPaymentEvent;
      } catch {
        return;
      }
      if (!payload || payload.event !== "payment:created") return;
      addNotification("payment:created", {
        amount: payload.amount,
        from: payload.payer,
        to: payload.payee,
        txHash: payload.txHash,
      });
    };

    es.addEventListener("payment:created", handler);

    return () => {
      es.removeEventListener("payment:created", handler);
      es.close();
    };
  }, [addNotification]);

  const toggleOpen = useCallback(() => {
    setIsOpen((prev) => !prev);
  }, []);

  const setOpen = useCallback((open: boolean) => {
    setIsOpen(open);
  }, []);

  const markAllRead = useCallback(() => {
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
  }, []);

  const clearAll = useCallback(() => {
    setNotifications([]);
  }, []);

  // When the dropdown opens, automatically mark all as read.
  useEffect(() => {
    if (isOpen) {
      markAllRead();
    }
  }, [isOpen, markAllRead]);

  return {
    notifications,
    unreadCount,
    isOpen,
    toggleOpen,
    setOpen,
    markAllRead,
    clearAll,
  };
}
