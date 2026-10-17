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
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { usePathname } from "next/navigation";

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() || "/";
  const segment = pathname.split("/").filter(Boolean)[0] || "dashboard";

  return (
    <ThemeProvider>
      <QueryProvider>
      <MultiWalletProvider>
        <ToastProvider>
          <OfflineBanner />
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
