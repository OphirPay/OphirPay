"use client";
// SPDX-License-Identifier: MIT

import { WalletButton } from "./WalletButton";
import { NotificationCenter } from "./NotificationCenter";
import { ThemeToggle } from "./ThemeToggle";

export function Header() {
  return (
    <header className="sticky top-0 z-30 h-16 bg-white/80 dark:bg-gray-950/80 backdrop-blur-md border-b border-gray-200 dark:border-gray-800">
      <div className="flex items-center justify-between h-full px-4 md:px-6">
        {/* Left: Page title / breadcrumb area */}
        <div className="flex items-center gap-4">
          <h2 className="text-sm font-medium text-gray-500 dark:text-gray-400 hidden md:block">
            Financial Operations Platform
          </h2>
        </div>

        {/* Right: Notifications + Theme toggle + Wallet button */}
        <div className="flex items-center gap-2 md:gap-3">
          <NotificationCenter />
          {/* Dark mode theme toggle */}
          <ThemeToggle />
          <WalletButton />
        </div>
      </div>
    </header>
  );
}
