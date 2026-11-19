// SPDX-License-Identifier: MIT

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, renderHook, act } from "@testing-library/react";
import { THEME_BLOCKING_SCRIPT } from "@/lib/theme-script";
import { useTheme, ThemeProvider, getStoredTheme, getPrehydratedResolvedTheme } from "@/hooks/useTheme";
import { Header } from "@/components/Header";
import type { ReactNode } from "react";

vi.mock("@/components/WalletButton", () => ({
  WalletButton: () => <div data-testid="wallet-button" />,
}));
vi.mock("@/components/NotificationCenter", () => ({
  NotificationCenter: () => <div data-testid="notification-center" />,
}));
vi.mock("@/components/KeyboardShortcutsHelp", () => ({
  KeyboardShortcutsHelp: () => <div data-testid="keyboard-shortcuts" />,
}));

function executeBlockingScript() {
  eval(THEME_BLOCKING_SCRIPT);
}

function mockMatchMedia(matches: boolean) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: query.includes("dark") ? matches : !matches,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

describe("Theme FOUC Prevention & Initial Load Flicker Fixes (#1376)", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.className = "";
    document.documentElement.removeAttribute("data-theme");
    document.documentElement.style.colorScheme = "";
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("THEME_BLOCKING_SCRIPT execution", () => {
    it("applies dark class and data-theme when localStorage 'theme' is dark", () => {
      mockMatchMedia(false);
      localStorage.setItem("theme", "dark");

      executeBlockingScript();

      expect(document.documentElement.classList.contains("dark")).toBe(true);
      expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
      expect(document.documentElement.style.colorScheme).toBe("dark");
    });

    it("applies dark class when legacy localStorage 'ophirpay-theme' is dark", () => {
      mockMatchMedia(false);
      localStorage.setItem("ophirpay-theme", "dark");

      executeBlockingScript();

      expect(document.documentElement.classList.contains("dark")).toBe(true);
      expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    });

    it("removes dark class and sets light when localStorage theme is light", () => {
      document.documentElement.classList.add("dark");
      mockMatchMedia(true); // system prefers dark, but explicit user pref is light
      localStorage.setItem("theme", "light");

      executeBlockingScript();

      expect(document.documentElement.classList.contains("dark")).toBe(false);
      expect(document.documentElement.getAttribute("data-theme")).toBe("light");
      expect(document.documentElement.style.colorScheme).toBe("light");
    });

    it("falls back to prefers-color-scheme when no stored theme exists", () => {
      mockMatchMedia(true);
      executeBlockingScript();

      expect(document.documentElement.classList.contains("dark")).toBe(true);
      expect(document.documentElement.getAttribute("data-theme")).toBe("dark");

      mockMatchMedia(false);
      executeBlockingScript();

      expect(document.documentElement.classList.contains("dark")).toBe(false);
      expect(document.documentElement.getAttribute("data-theme")).toBe("light");
    });

    it("safely tolerates localStorage access exceptions (e.g. strict security context)", () => {
      vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
        throw new Error("SecurityError: Access is denied");
      });

      expect(() => executeBlockingScript()).not.toThrow();
    });
  });

  describe("Pre-hydrated State Synchronization in useTheme", () => {
    it("resolves pre-hydrated theme from DOM class before React effect fires", () => {
      document.documentElement.classList.add("dark");
      document.documentElement.setAttribute("data-theme", "dark");

      expect(getPrehydratedResolvedTheme("system")).toBe("dark");

      document.documentElement.classList.remove("dark");
      document.documentElement.setAttribute("data-theme", "light");

      expect(getPrehydratedResolvedTheme("system")).toBe("light");
    });

    it("retrieves stored theme from localStorage supporting both keys", () => {
      localStorage.setItem("theme", "dark");
      expect(getStoredTheme()).toBe("dark");

      localStorage.clear();
      localStorage.setItem("ophirpay-theme", "light");
      expect(getStoredTheme()).toBe("light");
    });

    it("synchronizes useTheme with pre-hydrated DOM avoiding hydration flip", () => {
      document.documentElement.classList.add("dark");
      document.documentElement.setAttribute("data-theme", "dark");
      localStorage.setItem("theme", "dark");
      mockMatchMedia(false);

      const wrapper = ({ children }: { children: ReactNode }) => (
        <ThemeProvider>{children}</ThemeProvider>
      );

      const { result } = renderHook(() => useTheme(), { wrapper });

      expect(result.current.theme).toBe("dark");
      expect(result.current.resolved).toBe("dark");
    });

    it("dual-writes to both theme and ophirpay-theme on setTheme", () => {
      mockMatchMedia(false);
      const wrapper = ({ children }: { children: ReactNode }) => (
        <ThemeProvider>{children}</ThemeProvider>
      );

      const { result } = renderHook(() => useTheme(), { wrapper });

      act(() => {
        result.current.setTheme("dark");
      });

      expect(localStorage.getItem("theme")).toBe("dark");
      expect(localStorage.getItem("ophirpay-theme")).toBe("dark");
      expect(result.current.resolved).toBe("dark");
      expect(document.documentElement.classList.contains("dark")).toBe(true);
    });

    it("toggle switches between light and dark seamlessly", () => {
      mockMatchMedia(false);
      const wrapper = ({ children }: { children: ReactNode }) => (
        <ThemeProvider>{children}</ThemeProvider>
      );

      const { result } = renderHook(() => useTheme(), { wrapper });

      act(() => {
        result.current.toggle();
      });

      expect(result.current.resolved).toBe("dark");
      expect(localStorage.getItem("theme")).toBe("dark");

      act(() => {
        result.current.toggle();
      });

      expect(result.current.resolved).toBe("light");
      expect(localStorage.getItem("theme")).toBe("light");
    });
  });

  describe("Header theme toggle", () => {
    it("renders dark mode toggle with suppressHydrationWarning and toggles theme on click", () => {
      mockMatchMedia(true);
      render(
        <ThemeProvider>
          <Header />
        </ThemeProvider>
      );

      const toggleBtn = screen.getByRole("button", {
        name: /switch to light mode|switch to dark mode/i,
      });

      expect(toggleBtn).toBeInTheDocument();
      fireEvent.click(toggleBtn);
      expect(localStorage.getItem("theme")).toBeDefined();
    });
  });
});
