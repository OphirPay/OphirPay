// SPDX-License-Identifier: MIT

"use client";

import { useRef } from "react";

import { NotificationDropdown } from "./NotificationDropdown";
import { WalletButton } from "./WalletButton";
import { useNotifications } from "@/hooks/useNotifications";
import { useTheme } from "@/hooks/useTheme";

export function Header() {
  const { toggle, resolved } = useTheme();
  const isDark = resolved === "dark";

  const {
    notifications,
    unreadCount,
    isOpen,
    toggleOpen,
    setOpen,
    clearAll,
  } = useNotifications();

  const bellRef = useRef<HTMLButtonElement | null>(null);

  return (
    <header className="sticky top-0 z-30 h-16 bg-white/80 dark:bg-gray-950/80 backdrop-blur-md border-b border-gray-200 dark:border-gray-800">
      <div className="flex items-center justify-between h-full px-4 md:px-6">
        <div className="flex items-center gap-4">
          <h2 className="text-sm font-medium text-gray-500 dark:text-gray-400 hidden md:block">
            Financial Operations Platform
          </h2>
        </div>
        <div className="flex items-center gap-2 md:gap-3">
          {/* Notifications */}
          <div className="relative">
            <button
              ref={bellRef}
              type="button"
              onClick={toggleOpen}
              aria-label={`Notifications${unreadCount > 0 ? `, ${unreadCount} unread` : ""}`}
              aria-expanded={isOpen}
              aria-haspopup="dialog"
              className="relative inline-flex items-center justify-center w-9 h-9 rounded-md text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-900"
            >
              <svg
                className="w-5 h-5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={1.5}
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0"
                />
              </svg>
              {unreadCount > 0 && (
                <span
                  className="absolute top-1 right-1 inline-flex items-center justify-center min-w-[1.1rem] h-[1.1rem] px-1 text-[10px] font-semibold leading-none text-white bg-red-500 rounded-full"
                  aria-hidden="true"
                >
                  {unreadCount > 99 ? "99+" : unreadCount}
                </span>
              )}
            </button>

            {isOpen && (
              <NotificationDropdown
                notifications={notifications}
                onClearAll={clearAll}
                onClose={() => setOpen(false)}
              />
            )}
          </div>

          {/* Dark mode toggle */}
          <button
            onClick={toggle}
            aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
            className="inline-flex items-center justify-center w-9 h-9 rounded-md text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-900"
          >
            {isDark ? (
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v2.25m6.364.386l-1.591 1.591M21 12h-2.25m-.386 6.364l-1.591-1.591M12 18.75V21m-4.773-4.227l-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0z" />
              </svg>
            ) : (
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M21.752 15.002A9.72 9.72 0 0118 15.75c-5.385 0-9.75-4.365-9.75-9.75 0-1.33.266-2.597.748-3.752A9.753 9.753 0 003 11.25C3 16.635 7.365 21 12.75 21a9.753 9.753 0 009.002-5.998z" />
              </svg>
            )}
          </button>

          <WalletButton />
        </div>
      </div>
    </header>
  );
}
