"use client";
// SPDX-License-Identifier: MIT


import { MultiWalletProvider } from "@/hooks/useMultiWallet";
import { ToastProvider } from "@/components/ui/Toast";
import { ThemeProvider } from "@/hooks/useTheme";
import { QueryProvider } from "@/components/QueryProvider";
import { Sidebar } from "@/components/Sidebar";
import { Header } from "@/components/Header";
import { OfflineBanner } from "@/components/OfflineBanner";
import { InstallPrompt } from "@/components/InstallPrompt";

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider>
      <QueryProvider>
        {/* Skip to main content link for keyboard/accessibility */}
        <a
          href="#main-content"
          className="
            sr-only
            focus:not-sr-only
            focus:absolute
            focus:top-2
            focus:left-2
            focus:z-50
            focus:px-4
            focus:py-2
            focus:bg-ophir-600
            focus:text-white
            focus:rounded-lg
            focus:shadow-lg
            focus:outline-none
            focus:ring-2
            focus:ring-white
            focus:ring-opacity-30
          "
          aria-label="Skip to main content"
        >
          Skip to main content
        </a>
      <MultiWalletProvider>
        <ToastProvider>
          <OfflineBanner />
          <InstallPrompt />
          <div className="flex min-h-screen">
            <Sidebar />
            <div className="flex-1 lg:ml-64">
              <Header />
              <main id="main-content" className="p-4 md:p-6">{children}</main>
            </div>
          </div>
        </ToastProvider>
      </MultiWalletProvider>
      </QueryProvider>
    </ThemeProvider>
  );
}
