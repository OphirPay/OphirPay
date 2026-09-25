// SPDX-License-Identifier: MIT

import { describe, it, expect, vi, beforeAll } from "vitest";
import { render, screen } from "@testing-library/react";
import { AppShell } from "@/components/AppShell";
import { Sidebar } from "@/components/Sidebar";
import { Header } from "@/components/Header";
import { ThemeProvider } from "@/hooks/useTheme";

vi.mock("next/navigation", () => ({
  usePathname: () => "/payments",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(""),
}));

vi.mock("@/hooks/useMultiWallet", () => ({
  MultiWalletProvider: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  useMultiWallet: () => ({
    activeWallet: null,
    wallets: [],
    connect: vi.fn(),
    disconnect: vi.fn(),
  }),
}));

vi.mock("@/components/WalletButton", () => ({
  WalletButton: () => <button type="button">Connect Wallet</button>,
}));

vi.mock("@/components/NotificationCenter", () => ({
  NotificationCenter: () => <div>Notifications</div>,
}));

vi.mock("@/components/OfflineBanner", () => ({
  OfflineBanner: () => null,
}));

vi.mock("@/components/InstallPrompt", () => ({
  InstallPrompt: () => null,
}));

beforeAll(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
});

describe("AppShell, Landmarks and Accessibility Structure", () => {
  it("renders a skip-to-content link as the first focusable element targeting #main-content", () => {
    const { container } = render(
      <AppShell>
        <h1>Page Title</h1>
        <p>Page Content</p>
      </AppShell>
    );

    const skipLink = screen.getByRole("link", { name: /skip to main content/i });
    expect(skipLink).toBeInTheDocument();
    expect(skipLink).toHaveAttribute("href", "#main-content");

    // Must be the first focusable anchor/element in document order
    const focusable = container.querySelectorAll("a, button, input, select, textarea");
    expect(focusable[0]).toBe(skipLink);
  });

  it("exposes exactly one main landmark with id='main-content' and tabIndex={-1}", () => {
    render(
      <AppShell>
        <h1>Payments</h1>
        <div>Table content</div>
      </AppShell>
    );

    const mainLandmarks = screen.getAllByRole("main");
    expect(mainLandmarks).toHaveLength(1);

    const main = mainLandmarks[0];
    expect(main).toHaveAttribute("id", "main-content");
    expect(main).toHaveAttribute("tabindex", "-1");
  });

  it("renders banner landmark in Header", () => {
    render(
      <ThemeProvider>
        <Header />
      </ThemeProvider>
    );
    const header = screen.getByRole("banner");
    expect(header).toBeInTheDocument();
  });

  it("renders navigation and aside landmarks with distinct accessible names in Sidebar", () => {
    render(<Sidebar />);
    const asides = screen.getAllByRole("complementary");
    expect(asides.length).toBeGreaterThanOrEqual(1);

    // Sidebar landmarks have clear labels
    expect(screen.getByLabelText("Main sidebar")).toBeInTheDocument();
    expect(screen.getByLabelText("Main navigation")).toBeInTheDocument();
  });

  it("does not render h1 in the Sidebar logo, preserving exactly one h1 per page", () => {
    const { container } = render(
      <AppShell>
        <h1 className="text-2xl font-bold">Payments</h1>
      </AppShell>
    );

    const h1s = container.querySelectorAll("h1");
    expect(h1s).toHaveLength(1);
    expect(h1s[0].textContent).toBe("Payments");

    // The logo in sidebar is a span, not h1
    const logoTexts = screen.getAllByText("OphirPay");
    for (const logo of logoTexts) {
      expect(logo.tagName.toLowerCase()).not.toBe("h1");
    }
  });
});
