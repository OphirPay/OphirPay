"use client";
// SPDX-License-Identifier: MIT


import { usePathname } from "next/navigation";

import { ErrorBoundary } from "@/components/ErrorBoundary";
import { Header } from "@/components/Header";
import { InstallPrompt } from "@/components/InstallPrompt";
import { NetworkStatusBanner } from "@/components/NetworkStatusBanner";
import { OfflineBanner } from "@/components/OfflineBanner";
import { QueryProvider } from "@/components/QueryProvider";
import { Sidebar } from "@/components/Sidebar";
import { ToastProvider } from "@/components/ui/Toast";
import { MultiWalletProvider } from "@/hooks/useMultiWallet";
import { ThemeProvider } from "@/hooks/useTheme";

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() || "/";
  const segment = pathname.split("/").filter(Boolean)[0] || "dashboard";

  return (
    <ThemeProvider>
      <QueryProvider>
      <MultiWalletProvider>
        <ToastProvider>
          <OfflineBanner />
          {/* Outside the route ErrorBoundary below: a degraded RPC is a
              network warning, never a page-level error state. */}
          <NetworkStatusBanner />
          <InstallPrompt />
          <div className="flex min-h-screen">
            <Sidebar />
            {/* `min-w-0` is required on the flex child: without it the default
                `min-width: auto` lets a wide data grid push the column past the
                viewport and produce a page-level horizontal scrollbar on
                tablet widths (768–1024px). The table scrolls inside its own
                container instead (issue #1385). */}
            <div className="flex-1 min-w-0 lg:ml-64">
              <Header />
              <main id="main-content" tabIndex={-1} className="p-4 md:p-6 min-w-0">
                <ErrorBoundary key={pathname} segment={segment}>
                  {children}
                </ErrorBoundary>
              </main>
            </div>
          </div>
        </ToastProvider>
      </MultiWalletProvider>
      </QueryProvider>
    </ThemeProvider>
  );
}
