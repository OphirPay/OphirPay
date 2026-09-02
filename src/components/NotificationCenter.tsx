"use client";
// SPDX-License-Identifier: MIT

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { useNotifications } from "@/hooks/useNotifications";
import { useOnClickOutside } from "@/hooks/useOnClickOutside";
import { BellIcon } from "@/components/ui/Icon";
import { shortenAddress, timeAgo } from "@/lib/utils";
import { getStellarExplorerUrl } from "@/lib/stellar";
import type { PaymentNotification, PaymentEventType } from "@/lib/notifications";

function getNotificationIcon(type: PaymentEventType) {
  switch (type) {
    case "payment.sent":
      return (
        <div className="w-8 h-8 rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 flex items-center justify-center shrink-0">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
            <path fillRule="evenodd" d="M5.22 14.78a.75.75 0 001.06 0l7.22-7.22v5.69a.75.75 0 001.5 0v-7.5a.75.75 0 00-.75-.75h-7.5a.75.75 0 000 1.5h5.69l-7.22 7.22a.75.75 0 000 1.06z" clipRule="evenodd" />
          </svg>
        </div>
      );
    case "payment.received":
      return (
        <div className="w-8 h-8 rounded-full bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
            <path fillRule="evenodd" d="M14.78 14.78a.75.75 0 01-1.06 0L6.5 7.56v5.69a.75.75 0 01-1.5 0v-7.5A.75.75 0 015.75 5h7.5a.75.75 0 010 1.5H7.56l7.22 7.22a.75.75 0 010 1.06z" clipRule="evenodd" />
          </svg>
        </div>
      );
    case "payment.batch_completed":
      return (
        <div className="w-8 h-8 rounded-full bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400 flex items-center justify-center shrink-0">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
            <path d="M7 3.5A1.5 1.5 0 018.5 2h3.879a1.5 1.5 0 011.06.44l3.122 3.12A1.5 1.5 0 0117 6.622V12.5a1.5 1.5 0 01-1.5 1.5h-1v-3.379a3 3 0 00-.879-2.121L10.5 5.379A3 3 0 008.379 4.5H7v-1z" />
            <path d="M4.5 6A1.5 1.5 0 003 7.5v9A1.5 1.5 0 004.5 18h7a1.5 1.5 0 001.5-1.5v-5.879a1.5 1.5 0 00-.44-1.06L9.44 6.439A1.5 1.5 0 008.378 6H4.5z" />
          </svg>
        </div>
      );
    case "payment.failed":
      return (
        <div className="w-8 h-8 rounded-full bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 flex items-center justify-center shrink-0">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
            <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-8-5a.75.75 0 01.75.75v4.5a.75.75 0 01-1.5 0v-4.5A.75.75 0 0110 5zm0 10a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
          </svg>
        </div>
      );
    case "payment.created":
    default:
      return (
        <div className="w-8 h-8 rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400 flex items-center justify-center shrink-0">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
            <path fillRule="evenodd" d="M11.3 1.046A1 1 0 0112 2v5h4a1 1 0 01.82 1.573l-7 10A1 1 0 018 18v-5H4a1 1 0 01-.82-1.573l7-10a1 1 0 011.12-.38z" clipRule="evenodd" />
          </svg>
        </div>
      );
  }
}

export function NotificationCenter() {
  const {
    notifications,
    unreadCount,
    hasUnread,
    isOpen,
    isConnected,
    toggleOpen,
    setOpen,
    markAsRead,
    markAllAsRead,
    clearAll,
  } = useNotifications();

  const [activeTab, setActiveTab] = useState<"all" | "unread">("all");
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  // Close dropdown on outside click
  useOnClickOutside(containerRef, () => {
    if (isOpen) {
      setOpen(false);
    }
  });

  // Close dropdown on Escape key
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen, setOpen]);

  const filteredNotifications =
    activeTab === "unread"
      ? notifications.filter((n) => !n.read)
      : notifications;

  return (
    <div ref={containerRef} className="relative">
      {/* Bell Button */}
      <button
        ref={buttonRef}
        onClick={toggleOpen}
        aria-label={hasUnread ? `Notifications (${unreadCount} unread)` : "Notifications"}
        aria-expanded={isOpen}
        aria-haspopup="true"
        title="Payment Notifications"
        data-testid="notification-bell-btn"
        className="relative p-2 rounded-lg text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-gray-700 dark:hover:text-gray-200 transition-colors focus:outline-none focus:ring-2 focus:ring-ophir-500"
      >
        <BellIcon className="w-5 h-5" />
        {hasUnread && (
          <span
            data-testid="notification-badge"
            aria-hidden="true"
            className="absolute -top-0.5 -right-0.5 min-w-[1.25rem] h-5 px-1 flex items-center justify-center text-[10px] font-bold text-white bg-ophir-600 rounded-full border-2 border-white dark:border-gray-950 shadow-sm animate-pulse"
          >
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {/* Notification Dropdown */}
      {isOpen && (
        <div
          role="region"
          aria-label="Payment Notifications"
          data-testid="notification-dropdown"
          className="absolute right-0 top-full mt-2 w-80 sm:w-96 max-w-[calc(100vw-2rem)] bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl shadow-xl z-50 overflow-hidden flex flex-col animate-in fade-in duration-150"
        >
          {/* Header */}
          <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-900/50 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold text-gray-900 dark:text-white">
                Notifications
              </h3>
              <span
                data-testid="sse-status"
                className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium ${
                  isConnected
                    ? "bg-green-100 dark:bg-green-950/40 text-green-700 dark:text-green-400"
                    : "bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400"
                }`}
              >
                <span
                  className={`w-1.5 h-1.5 rounded-full ${
                    isConnected ? "bg-green-500 animate-pulse" : "bg-gray-400"
                  }`}
                />
                {isConnected ? "Live" : "Polling"}
              </span>
            </div>

            <div className="flex items-center gap-2">
              {unreadCount > 0 && (
                <button
                  onClick={markAllAsRead}
                  data-testid="mark-all-read-btn"
                  className="text-xs font-medium text-ophir-600 dark:text-ophir-400 hover:text-ophir-700 dark:hover:text-ophir-300 transition-colors"
                >
                  Mark all read
                </button>
              )}
            </div>
          </div>

          {/* Filter Tabs */}
          <div className="flex border-b border-gray-100 dark:border-gray-800 px-4 pt-2 gap-4 text-xs font-medium bg-white dark:bg-gray-900">
            <button
              onClick={() => setActiveTab("all")}
              data-testid="filter-tab-all"
              className={`pb-2 border-b-2 transition-colors ${
                activeTab === "all"
                  ? "border-ophir-600 text-ophir-600 dark:border-ophir-400 dark:text-ophir-400 font-semibold"
                  : "border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
              }`}
            >
              All ({notifications.length})
            </button>
            <button
              onClick={() => setActiveTab("unread")}
              data-testid="filter-tab-unread"
              className={`pb-2 border-b-2 transition-colors ${
                activeTab === "unread"
                  ? "border-ophir-600 text-ophir-600 dark:border-ophir-400 dark:text-ophir-400 font-semibold"
                  : "border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
              }`}
            >
              Unread ({unreadCount})
            </button>
          </div>

          {/* Notification List */}
          <div className="max-h-80 overflow-y-auto divide-y divide-gray-100 dark:divide-gray-800">
            {filteredNotifications.length === 0 ? (
              <div
                data-testid="empty-notifications"
                className="py-10 px-4 text-center"
              >
                <div className="w-10 h-10 mx-auto rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center text-gray-400 mb-2">
                  <BellIcon className="w-5 h-5 opacity-60" />
                </div>
                <p className="text-xs font-medium text-gray-700 dark:text-gray-300">
                  No notifications yet
                </p>
                <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-0.5">
                  Payment events and transfers will show up here in real time.
                </p>
              </div>
            ) : (
              filteredNotifications.map((item: PaymentNotification) => (
                <div
                  key={item.id}
                  data-testid="notification-item"
                  data-notification-id={item.id}
                  onClick={() => markAsRead(item.id)}
                  className={`p-3.5 flex items-start gap-3 transition-colors cursor-pointer ${
                    !item.read
                      ? "bg-ophir-50/40 dark:bg-ophir-950/20 hover:bg-ophir-50/70 dark:hover:bg-ophir-950/30"
                      : "hover:bg-gray-50 dark:hover:bg-gray-800/40"
                  }`}
                >
                  {getNotificationIcon(item.type)}

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-1">
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-semibold text-gray-900 dark:text-white truncate">
                          {item.title}
                        </span>
                        {!item.read && (
                          <span
                            data-testid="unread-dot"
                            className="w-2 h-2 rounded-full bg-ophir-600 shrink-0"
                          />
                        )}
                      </div>
                      <span className="text-[10px] text-gray-400 dark:text-gray-500 shrink-0 whitespace-nowrap">
                        {timeAgo(new Date(item.timestamp).toISOString())}
                      </span>
                    </div>

                    <p className="text-xs text-gray-600 dark:text-gray-300 mt-0.5 line-clamp-2">
                      {item.message}
                    </p>

                    {/* Metadata tags */}
                    <div className="flex flex-wrap items-center gap-2 mt-1.5 text-[11px]">
                      {item.amount && (
                        <span className="font-mono font-medium text-ophir-600 dark:text-ophir-400 bg-ophir-50 dark:bg-ophir-950/40 px-1.5 py-0.5 rounded">
                          {item.amount}
                        </span>
                      )}

                      {item.counterparty && (
                        <span className="font-mono text-gray-500 dark:text-gray-400">
                          {shortenAddress(item.counterparty, 4)}
                        </span>
                      )}

                      {item.recipientCount && (
                        <span className="text-purple-700 dark:text-purple-300 bg-purple-50 dark:bg-purple-950/40 px-1.5 py-0.5 rounded">
                          {item.recipientCount} recipients
                        </span>
                      )}

                      {item.txHash && (
                        <a
                          href={getStellarExplorerUrl(item.txHash)}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="font-mono text-gray-400 hover:text-ophir-600 dark:hover:text-ophir-400 underline truncate max-w-[120px]"
                          title="View on Stellar Explorer"
                        >
                          {shortenAddress(item.txHash, 4)}
                        </a>
                      )}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Footer */}
          <div className="px-4 py-2.5 bg-gray-50 dark:bg-gray-900/80 border-t border-gray-100 dark:border-gray-800 flex items-center justify-between text-xs">
            {notifications.length > 0 ? (
              <button
                onClick={clearAll}
                data-testid="clear-all-btn"
                className="text-gray-500 hover:text-red-600 dark:text-gray-400 dark:hover:text-red-400 transition-colors"
              >
                Clear all
              </button>
            ) : (
              <span />
            )}

            <Link
              href="/events"
              onClick={() => setOpen(false)}
              className="text-ophir-600 dark:text-ophir-400 hover:underline font-medium inline-flex items-center gap-1"
            >
              Event stream →
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
