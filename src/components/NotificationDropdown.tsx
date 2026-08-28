// SPDX-License-Identifier: MIT

"use client";

import { useEffect, useRef } from "react";

import type { PaymentNotification } from "@/lib/notifications";
import { trapFocus } from "@/lib/focus-trap";
import { Z_INDEX } from "@/lib/z-index";
import { cn, timeAgo } from "@/lib/utils";

interface NotificationDropdownProps {
  notifications: PaymentNotification[];
  onClearAll: () => void;
  onClose: () => void;
}

function notificationIcon(type: PaymentNotification["type"]): JSX.Element {
  const common = "w-5 h-5";
  switch (type) {
    case "payment.sent":
    case "payment.created":
      return (
        <svg className={common} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" />
        </svg>
      );
    case "payment.received":
      return (
        <svg className={common} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 21a9 9 0 100-18 9 9 0 000 18z" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 7v10M9.5 9.5h3.75a2.25 2.25 0 010 4.5H9.5" />
        </svg>
      );
    case "payment.batch_completed":
      return (
        <svg className={common} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      );
    default:
      return (
        <svg className={common} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0" />
        </svg>
      );
  }
}

export function NotificationDropdown({
  notifications,
  onClearAll,
  onClose,
}: NotificationDropdownProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Focus trap while the dropdown is mounted.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const release = trapFocus(el);

    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    el.addEventListener("keydown", handleKey);

    return () => {
      el.removeEventListener("keydown", handleKey);
      release();
    };
  }, [onClose]);

  // Click outside to close.
  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      const el = containerRef.current;
      if (!el) return;
      if (!el.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [onClose]);

  return (
    <div
      ref={containerRef}
      role="dialog"
      aria-label="Notifications"
      className={cn(
        "absolute right-0 top-full mt-2 w-80 sm:w-96 rounded-lg border border-gray-200 dark:border-gray-800",
        "bg-white dark:bg-gray-950 shadow-lg",
        "max-h-[28rem] flex flex-col"
      )}
      style={{ zIndex: Z_INDEX.DROPDOWN }}
    >
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-800">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
          Notifications
        </h3>
        {notifications.length > 0 && (
          <button
            type="button"
            onClick={onClearAll}
            className="text-xs text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
          >
            Clear all
          </button>
        )}
      </div>

      {notifications.length === 0 ? (
        <div className="px-4 py-8 text-center text-sm text-gray-500 dark:text-gray-400">
          No notifications yet
        </div>
      ) : (
        <ul
          className="flex-1 overflow-y-auto divide-y divide-gray-100 dark:divide-gray-900"
          role="list"
        >
          {notifications.map((n) => (
            <li
              key={n.id}
              className={cn(
                "flex gap-3 px-4 py-3",
                n.read
                  ? "bg-white dark:bg-gray-950"
                  : "bg-blue-50/60 dark:bg-blue-950/20"
              )}
            >
              <span
                className={cn(
                  "flex-shrink-0 inline-flex items-center justify-center w-9 h-9 rounded-full",
                  "text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-900"
                )}
                aria-hidden="true"
              >
                {notificationIcon(n.type)}
              </span>

              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                    {n.title}
                  </p>
                  {!n.read && (
                    <span
                      className="mt-1.5 inline-block w-2 h-2 rounded-full bg-blue-500 flex-shrink-0"
                      aria-label="Unread"
                    />
                  )}
                </div>
                <p className="text-sm text-gray-600 dark:text-gray-400 truncate">
                  {n.message}
                </p>
                <p className="mt-0.5 text-xs text-gray-400 dark:text-gray-500">
                  {timeAgo(n.timestamp)}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
