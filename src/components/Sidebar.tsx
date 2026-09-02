"use client";
// SPDX-License-Identifier: MIT


import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  DashboardIcon,
  SendIcon,
  PaymentsIcon,
  BatchesIcon,
  RecurringIcon,
  RequestsIcon,
  WebhookIcon,
  ContractsIcon,
  AnalyticsIcon,
  EventsIcon,
  MenuIcon,
  XIcon,
} from "@/components/ui/Icon";

const navItems = [
  { href: "/", label: "Treasury", Icon: DashboardIcon },
  { href: "/send", label: "Send", Icon: SendIcon },
  { href: "/address-book", label: "Address Book", Icon: AddressBookIcon },
  { href: "/payments", label: "Payments", Icon: PaymentsIcon },
  { href: "/batches", label: "Batches", Icon: BatchesIcon },
  { href: "/recurring", label: "Recurring", Icon: RecurringIcon },
  { href: "/requests", label: "Requests", Icon: RequestsIcon },
  { href: "/webhooks", label: "Webhooks", Icon: WebhookIcon },
  { href: "/contracts", label: "Contracts", Icon: ContractsIcon },
  { href: "/analytics", label: "Analytics", Icon: AnalyticsIcon },
  { href: "/keys", label: "API Keys", Icon: ApiKeysIcon },
  { href: "/events", label: "Events", Icon: EventsIcon },
  { href: "/multisig", label: "Multisig", Icon: MultisigIcon },
  { href: "/governance", label: "Governance", Icon: GovernanceIcon },
  { href: "/audit-log", label: "Audit Log", Icon: AuditLogIcon },
  { href: "/refunds", label: "Refunds", Icon: RefundsIcon },
  { href: "/hooks", label: "Hooks", Icon: HooksIcon },
  { href: "/rbac", label: "RBAC", Icon: RbacIcon },
  { href: "/keys", label: "API Keys", Icon: ApiKeysIcon },
  { href: "/fee-config", label: "Fee Config", Icon: FeeConfigIcon },
  { href: "/pause-controls", label: "Pause Controls", Icon: PauseControlsIcon },
  { href: "/timelock", label: "Timelock", Icon: TimelockIcon },
  { href: "/policy-versions", label: "Policy Versions", Icon: PolicyVersionsIcon },
  { href: "/keys", label: "API Keys", Icon: PolicyVersionsIcon },
];

function ApiKeysIcon({ className }: { className?: string }) {
  return <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className={className}><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 5.25a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.5 19.5a7.5 7.5 0 0115 0M15 8.25l3 3m0 0l2.25-2.25M18 11.25l-2.25 2.25" /></svg>;
}

// Inline SVG icons for new feature pages
function AddressBookIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className={className}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" />
    </svg>
  );
}

function MultisigIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className={className}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
    </svg>
  );
}

function GovernanceIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className={className}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 21a9.004 9.004 0 008.716-6.747M12 21a9.004 9.004 0 01-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 017.843 4.582M12 3a8.997 8.997 0 00-7.843 4.582m15.686 0A11.953 11.953 0 0112 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0121 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0112 16.5c-3.162 0-6.133-.815-8.716-2.247m0 0A9.015 9.015 0 013 12c0-1.605.42-3.113 1.157-4.418" />
    </svg>
  );
}

function HooksIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className={className}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0" />
    </svg>
  );
}

function RbacIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className={className}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
    </svg>
  );
}

function FeeConfigIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className={className}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v12m-3-2.818l.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  );
}

function PauseControlsIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className={className}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 5.25v13.5m-7.5-13.5v13.5" />
    </svg>
  );
}

function TimelockIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className={className}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
    </svg>
  );
}

function PolicyVersionsIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className={className}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
    </svg>
  );
}

function RefundsIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className={className}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 15L3 9m0 0l6-6M3 9h12a6 6 0 010 12h-3" />
    </svg>
  );
}

function AuditLogIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className={className}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
    </svg>
  );
}

function ApiKeysIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className={className}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 5.25a3 3 0 013 3m3 0a6 6 0 01-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1121.75 8.25z" />
    </svg>
  );
}

export function Sidebar() {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  // Navigation can happen through router transitions, keyboard shortcuts, or
  // browser history. Keep the drawer closed after every route change.
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  // Keyboard navigation: Ctrl+1..9 for nav items
  const handleKeyDown = (e: KeyboardEvent) => {
    const num = parseInt(e.key);
    if ((e.ctrlKey || e.metaKey) && num >= 1 && num <= navItems.length) {
      e.preventDefault();
      window.location.href = navItems[num - 1].href;
    }
  };

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown as EventListener);
    return () => window.removeEventListener("keydown", handleKeyDown as EventListener);
  }, []);

  const links = navItems.map((item) => {
    const isActive = pathname === item.href || (item.href !== "/" && pathname.startsWith(item.href));
    return (
      <Link
        key={item.href}
        href={item.href}
        onClick={() => setMobileOpen(false)}
        className={cn(
          "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 group",
          isActive
            ? "bg-ophir-50 dark:bg-ophir-950/30 text-ophir-700 dark:text-ophir-400"
            : "text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-900 hover:text-gray-900 dark:hover:text-white"
        )}
      >
        <span className={cn("transition-colors duration-200", isActive ? "text-ophir-600 dark:text-ophir-400" : "text-gray-400 dark:text-gray-500 group-hover:text-gray-600 dark:group-hover:text-gray-300")}>
          <item.Icon className="w-5 h-5" />
        </span>
        {item.label}
        {isActive && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-ophir-500" />}
      </Link>
    );
  });

  const footer = (
    <div className="px-6 py-4 border-t border-gray-200 dark:border-gray-800">
      <div className="flex items-center gap-2 text-xs text-gray-400 dark:text-gray-500">
        <span className="relative flex h-2 w-2">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-stellar opacity-75" />
          <span className="relative inline-flex rounded-full h-2 w-2 bg-stellar" />
        </span>
        Stellar Testnet
      </div>
      <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">OphirPay v1.0.0-rc1</p>
    </div>
  );

  return (
    <>
      {/* Mobile hamburger */}
      <button
        onClick={() => setMobileOpen(!mobileOpen)}
        className="lg:hidden fixed top-3 left-3 z-50 p-2 rounded-lg bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 shadow-md"
        aria-label="Toggle menu"
      >
        <div className="w-6 h-6 text-gray-700 dark:text-gray-300">
          {mobileOpen ? <XIcon className="w-6 h-6" /> : <MenuIcon className="w-6 h-6" />}
        </div>
      </button>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div className="lg:hidden fixed inset-0 bg-black/40 z-40" onClick={() => setMobileOpen(false)} />
      )}

      {/* Desktop sidebar */}
      <aside className="hidden lg:flex fixed left-0 top-0 h-full w-64 bg-white dark:bg-gray-950 border-r border-gray-200 dark:border-gray-800 z-40 flex-col">
        <div className="flex items-center gap-3 px-6 h-16 border-b border-gray-200 dark:border-gray-800">
          <div className="h-9 w-9 rounded-lg bg-gradient-to-br from-ophir-600 to-stellar flex items-center justify-center shadow-lg shadow-ophir-500/30">
            <span className="text-white font-bold text-lg">O</span>
          </div>
          <div>
            <h1 className="text-lg font-bold text-gray-900 dark:text-white leading-none">OphirPay</h1>
            <p className="text-xs text-gray-500 dark:text-gray-400">Stellar Payments</p>
          </div>
        </div>
        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">{links}</nav>
        {footer}
      </aside>

      {/* Mobile sidebar */}
      <aside className={cn(
        "lg:hidden fixed left-0 top-0 h-full w-64 bg-white dark:bg-gray-950 border-r border-gray-200 dark:border-gray-800 z-40 flex-col transition-transform duration-300",
        mobileOpen ? "translate-x-0 flex" : "-translate-x-full"
      )}>
        <div className="flex items-center gap-3 px-6 h-16 border-b border-gray-200 dark:border-gray-800">
          <div className="h-9 w-9 rounded-lg bg-gradient-to-br from-ophir-600 to-stellar flex items-center justify-center shadow-lg shadow-ophir-500/30">
            <span className="text-white font-bold text-lg">O</span>
          </div>
          <div><h1 className="text-lg font-bold text-gray-900 dark:text-white leading-none">OphirPay</h1></div>
        </div>
        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">{links}</nav>
        {footer}
      </aside>
    </>
  );
}
