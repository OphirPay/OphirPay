// SPDX-License-Identifier: MIT

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { AppShell } from "@/components/AppShell";
import { Sidebar } from "@/components/Sidebar";
import { SkipLink } from "@/components/SkipLink";
import { ARIA } from "@/lib/aria-labels";
import { Z_INDEX } from "@/lib/z-index";

// Mock next/navigation
vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
}));

// Mock multi-wallet and theme hooks
vi.mock("@/hooks/useMultiWallet", () => ({
  MultiWalletProvider: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  useMultiWallet: () => ({
    wallets: [],
    activeWallet: null,
    connect: vi.fn(),
    disconnect: vi.fn(),
  }),
  useWallet: () => ({
    wallet: null,
    connect: vi.fn(),
    disconnect: vi.fn(),
    fetchBalance: vi.fn(),
    isConnecting: false,
    error: null,
  }),
}));

vi.mock("@/hooks/useTheme", () => ({
  ThemeProvider: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  useTheme: () => ({
    theme: "light",
    resolved: "light",
    toggle: vi.fn(),
  }),
}));

vi.mock("@/components/QueryProvider", () => ({
  QueryProvider: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/components/OfflineBanner", () => ({
  OfflineBanner: () => null,
}));

vi.mock("@/components/InstallPrompt", () => ({
  InstallPrompt: () => null,
}));

vi.mock("@/components/WalletButton", () => ({
  WalletButton: () => <button>Wallet</button>,
}));

vi.mock("@/components/NotificationCenter", () => ({
  NotificationCenter: () => <div>Notifications</div>,
}));

describe("SkipLink and Landmark Accessibility (Issue #789)", () => {
  it("renders skip link with correct target, aria label, and z-index", () => {
    render(<SkipLink />);
    const link = screen.getByRole("link", { name: ARIA.SKIP_TO_CONTENT });

    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute("href", "#main-content");
    expect(link.className).toContain("sr-only");
    expect(link.className).toContain("focus:not-sr-only");
    expect(link).toHaveStyle({ zIndex: Z_INDEX.SKIP_LINK });
  });

  it("renders SkipLink before other content in AppShell", () => {
    render(
      <AppShell>
        <div>Content Area</div>
      </AppShell>
    );

    const skipLink = screen.getByRole("link", { name: ARIA.SKIP_TO_CONTENT });
    const mainLandmark = screen.getByRole("main");

    expect(skipLink).toBeInTheDocument();
    expect(mainLandmark).toBeInTheDocument();
    expect(mainLandmark).toHaveAttribute("id", "main-content");
    expect(mainLandmark).toHaveAttribute("tabindex", "-1");

    // Skip link should appear before main in document order
    expect(skipLink.compareDocumentPosition(mainLandmark)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING
    );
  });

  it("does not render h1 in Sidebar branding, leaving h1 unique to page content", () => {
    render(<Sidebar />);

    // Sidebar branding should be a span or text, not an h1
    const headings = screen.queryAllByRole("heading", { level: 1 });
    expect(headings).toHaveLength(0);

    // Sidebar should have accessible landmarks
    const aside = screen.getByLabelText("Sidebar");
    expect(aside).toBeInTheDocument();

    const nav = screen.getByRole("navigation", { name: "Main Navigation" });
    expect(nav).toBeInTheDocument();
  });
});
