// SPDX-License-Identifier: MIT
// @vitest-environment jsdom
/**
 * Tests for preventing Flash of Unstyled Content (FOUC) and theme flicker
 * on initial page load (#1376).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";
import {
  ThemeProvider,
  useTheme,
  THEME_STORAGE_KEY,
  LEGACY_THEME_STORAGE_KEY,
  readStoredTheme,
  readPreHydratedResolvedTheme,
  resolveTheme,
} from "@/hooks/useTheme";

const mockGetHeader = vi.fn();

vi.mock("next/headers", () => ({
  headers: vi.fn(async () => ({
    get: (name: string) => mockGetHeader(name),
  })),
}));

vi.mock("next/font/google", () => ({
  Geist: () => ({ variable: "--font-geist-sans" }),
  Geist_Mono: () => ({ variable: "--font-geist-mono" }),
}));

vi.mock("@/components/AppShell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="app-shell">{children}</div>
  ),
}));

vi.mock("@/components/WalletButton", () => ({
  WalletButton: () => <div data-testid="wallet-button" />,
}));

vi.mock("@/components/NotificationCenter", () => ({
  NotificationCenter: () => <div data-testid="notification-center" />,
}));

vi.mock("@/components/KeyboardShortcutsHelp", () => ({
  KeyboardShortcutsHelp: () => <div data-testid="keyboard-shortcuts" />,
}));

import RootLayout, { THEME_INIT_SCRIPT } from "@/app/layout";
import { Header } from "@/components/Header";

type MatchMediaListener = (e: MediaQueryListEvent) => void;

function installMatchMediaMock(initialMatches: boolean) {
  let matches = initialMatches;
  const listeners = new Set<MatchMediaListener>();

  const matchMediaMock = vi.fn().mockImplementation((query: string) => ({
    matches,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn((_event: string, cb: MatchMediaListener) => {
      listeners.add(cb);
    }),
    removeEventListener: vi.fn((_event: string, cb: MatchMediaListener) => {
      listeners.delete(cb);
    }),
    dispatchEvent: vi.fn(),
  }));

  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: matchMediaMock,
  });

  return {
    setMatches(next: boolean) {
      matches = next;
      for (const listener of listeners) {
        listener({ matches: next } as MediaQueryListEvent);
      }
    },
  };
}

function runBlockingThemeInitScript() {
  const fn = new Function(THEME_INIT_SCRIPT);
  fn();
}

describe("Prevent Theme FOUC & Hydration Flicker (#1376)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    document.documentElement.className = "";
    document.documentElement.removeAttribute("data-theme");
    document.documentElement.style.colorScheme = "";
    installMatchMediaMock(false);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("Blocking <head> THEME_INIT_SCRIPT", () => {
    it("applies .dark class and data-theme='dark' when localStorage 'theme' is 'dark'", () => {
      window.localStorage.setItem("theme", "dark");
      runBlockingThemeInitScript();

      expect(document.documentElement.classList.contains("dark")).toBe(true);
      expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
      expect(document.documentElement.style.colorScheme).toBe("dark");
    });

    it("removes .dark class and sets data-theme='light' when localStorage 'theme' is 'light' even if OS is dark", () => {
      installMatchMediaMock(true);
      document.documentElement.classList.add("dark");
      window.localStorage.setItem("theme", "light");

      runBlockingThemeInitScript();

      expect(document.documentElement.classList.contains("dark")).toBe(false);
      expect(document.documentElement.getAttribute("data-theme")).toBe("light");
      expect(document.documentElement.style.colorScheme).toBe("light");
    });

    it("supports legacy 'ophirpay-theme' localStorage key", () => {
      window.localStorage.setItem("ophirpay-theme", "dark");
      runBlockingThemeInitScript();

      expect(document.documentElement.classList.contains("dark")).toBe(true);
      expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    });

    it("falls back to window.matchMedia('(prefers-color-scheme: dark)') when no theme is stored", () => {
      installMatchMediaMock(true);
      runBlockingThemeInitScript();

      expect(document.documentElement.classList.contains("dark")).toBe(true);
      expect(document.documentElement.getAttribute("data-theme")).toBe("dark");

      installMatchMediaMock(false);
      runBlockingThemeInitScript();

      expect(document.documentElement.classList.contains("dark")).toBe(false);
      expect(document.documentElement.getAttribute("data-theme")).toBe("light");
    });

    it("does not throw if localStorage access throws SecurityError", () => {
      vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
        throw new Error("SecurityError");
      });

      expect(() => runBlockingThemeInitScript()).not.toThrow();
    });
  });

  describe("useTheme & ThemeProvider pre-hydration synchronization", () => {
    it("reads pre-hydrated DOM state on initial render without flashing", () => {
      window.localStorage.setItem("theme", "dark");
      runBlockingThemeInitScript();

      const observedRenderStates: Array<{ theme: string; resolved: string }> = [];

      function Inspector() {
        const { theme, resolved } = useTheme();
        observedRenderStates.push({ theme, resolved });
        return <div data-testid="resolved-theme">{resolved}</div>;
      }

      render(
        <ThemeProvider>
          <Inspector />
        </ThemeProvider>
      );

      expect(screen.getByTestId("resolved-theme").textContent).toBe("dark");
      // Every render pass from the very first synchronous pass must resolve to 'dark'
      expect(observedRenderStates.every((s) => s.resolved === "dark")).toBe(true);
    });

    it("persists theme changes to both 'theme' and 'ophirpay-theme' keys and updates DOM", () => {
      runBlockingThemeInitScript();

      function Controls() {
        const { theme, resolved, setTheme, toggle } = useTheme();
        return (
          <div>
            <span data-testid="theme">{theme}</span>
            <span data-testid="resolved">{resolved}</span>
            <button onClick={() => setTheme("dark")} data-testid="set-dark">
              Dark
            </button>
            <button onClick={toggle} data-testid="toggle">
              Toggle
            </button>
          </div>
        );
      }

      render(
        <ThemeProvider>
          <Controls />
        </ThemeProvider>
      );

      expect(screen.getByTestId("resolved").textContent).toBe("light");

      fireEvent.click(screen.getByTestId("set-dark"));
      expect(screen.getByTestId("theme").textContent).toBe("dark");
      expect(screen.getByTestId("resolved").textContent).toBe("dark");
      expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
      expect(window.localStorage.getItem(LEGACY_THEME_STORAGE_KEY)).toBe("dark");
      expect(document.documentElement.classList.contains("dark")).toBe(true);
      expect(document.documentElement.getAttribute("data-theme")).toBe("dark");

      fireEvent.click(screen.getByTestId("toggle"));
      expect(screen.getByTestId("resolved").textContent).toBe("light");
      expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");
      expect(document.documentElement.classList.contains("dark")).toBe(false);
      expect(document.documentElement.getAttribute("data-theme")).toBe("light");
    });

    it("updates resolved theme when system color scheme changes in 'system' mode", () => {
      const mq = installMatchMediaMock(false);
      runBlockingThemeInitScript();

      function Consumer() {
        const { resolved } = useTheme();
        return <span data-testid="resolved">{resolved}</span>;
      }

      render(
        <ThemeProvider>
          <Consumer />
        </ThemeProvider>
      );

      expect(screen.getByTestId("resolved").textContent).toBe("light");

      act(() => {
        mq.setMatches(true);
      });

      expect(screen.getByTestId("resolved").textContent).toBe("dark");
      expect(document.documentElement.classList.contains("dark")).toBe(true);
    });

    it("helper functions readStoredTheme, resolveTheme, and readPreHydratedResolvedTheme handle edge cases", () => {
      expect(readStoredTheme()).toBe("system");
      window.localStorage.setItem("ophirpay-theme", "light");
      expect(readStoredTheme()).toBe("light");
      window.localStorage.setItem("theme", "dark");
      expect(readStoredTheme()).toBe("dark");

      expect(resolveTheme("light")).toBe("light");
      expect(resolveTheme("dark")).toBe("dark");

      document.documentElement.setAttribute("data-theme", "dark");
      expect(readPreHydratedResolvedTheme()).toBe("dark");
    });
  });

  describe("Header theme toggle component", () => {
    it("renders the matching icon immediately from pre-hydrated dark mode and toggles cleanly", () => {
      window.localStorage.setItem("theme", "dark");
      runBlockingThemeInitScript();

      render(
        <ThemeProvider>
          <Header />
        </ThemeProvider>
      );

      const btn = screen.getByRole("button", { name: "Switch to light mode" });
      expect(btn).toBeTruthy();

      fireEvent.click(btn);
      expect(
        screen.getByRole("button", { name: "Switch to dark mode" })
      ).toBeTruthy();
      expect(document.documentElement.classList.contains("dark")).toBe(false);
    });
  });

  describe("RootLayout blocking script and CSP nonce integration", () => {
    it("injects THEME_INIT_SCRIPT with CSP nonce and suppressHydrationWarning on <html>", async () => {
      mockGetHeader.mockImplementation((name: string) =>
        name === "x-nonce" ? "test-csp-nonce-1376" : null
      );

      const element = await RootLayout({
        children: <div>Child Content</div>,
      });

      expect(element.type).toBe("html");
      expect(element.props.suppressHydrationWarning).toBe(true);

      const childrenArray = React.Children.toArray(
        element.props.children
      ) as React.ReactElement[];
      const headElement = childrenArray.find((child) => child.type === "head");
      expect(headElement).toBeDefined();

      const headScripts = React.Children.toArray(
        (headElement as React.ReactElement<{ children: React.ReactNode }>).props
          .children
      ) as React.ReactElement<{
        id?: string;
        nonce?: string;
        dangerouslySetInnerHTML?: { __html: string };
      }>[];

      const themeScript = headScripts.find(
        (s) => s.props?.id === "ophirpay-theme-init"
      );
      expect(themeScript).toBeDefined();
      expect(themeScript?.props.nonce).toBe("test-csp-nonce-1376");
      expect(themeScript?.props.dangerouslySetInnerHTML?.__html).toBe(
        THEME_INIT_SCRIPT
      );
    });
  });
});
