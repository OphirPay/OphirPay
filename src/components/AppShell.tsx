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
            <div className="flex-1 lg:ml-64">
              <Header />
              <main id="main-content" tabIndex={-1} className="p-4 md:p-6">
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
