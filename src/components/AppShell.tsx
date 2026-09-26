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
import { ARIA } from "@/lib/aria-labels";

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider>
      <QueryProvider>
      <MultiWalletProvider>
        <ToastProvider>
          <a
            href="#main-content"
            className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-50 focus:px-4 focus:py-2 focus:bg-ophir-600 focus:text-white focus:rounded-lg focus:shadow-lg focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-ophir-500 font-medium text-sm transition-all"
          >
            {ARIA.SKIP_TO_CONTENT}
          </a>
          <OfflineBanner />
          <InstallPrompt />
          <div className="flex min-h-screen">
            <Sidebar />
            <div className="flex-1 lg:ml-64">
              <Header />
              <main id="main-content" tabIndex={-1} className="p-4 md:p-6 focus:outline-none">
                {children}
              </main>
            </div>
          </div>
        </ToastProvider>
      </MultiWalletProvider>
      </QueryProvider>
    </ThemeProvider>
  );
}
