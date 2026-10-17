// SPDX-License-Identifier: MIT
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, renderHook, act } from "@testing-library/react";
import React, { type ReactNode } from "react";
import {
  ThemeProvider,
  useTheme,
  THEME_STORAGE_KEY,
  THEME_FALLBACK_KEY,
  THEME_BLOCKING_SCRIPT,
  getStoredTheme,
  getPrehydratedResolvedTheme,
} from "@/hooks/useTheme";
import { Header } from "@/components/Header";

// Mock WalletButton which depends on full wallet provider context
vi.mock("@/components/WalletButton", () => ({
  WalletButton: () => <button data-testid="mock-wallet-btn">Connect Wallet</button>,
}));

// Mock matchMedia
function setupMatchMedia(matchesDark: boolean) {
  const listeners: Array<(e: { matches: boolean }) => void> = [];
  const mql = {
    matches: matchesDark,
    media: "(prefers-color-scheme: dark)",
    onchange: null,
    addListener: vi.fn((cb) => listeners.push(cb)),
    removeListener: vi.fn(),
    addEventListener: vi.fn((_, cb) => listeners.push(cb)),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  };

  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => {
      return {
        ...mql,
        matches: query.includes("dark") ? matchesDark : !matchesDark,
      };
    }),
  });

  return {
    setMatches: (matches: boolean) => {
      matchesDark = matches;
      listeners.forEach((l) => l({ matches }));
    },
  };
}

describe("Theme FOUC Prevention & Pre-hydration Synchronization (Issue #1376)", () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.className = "";
    document.documentElement.removeAttribute("data-theme");
    document.documentElement.style.colorScheme = "";
    setupMatchMedia(false);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("THEME_BLOCKING_SCRIPT inline execution", () => {
    it("applies dark class and data-theme when localStorage('theme') is dark", () => {
      window.localStorage.setItem(THEME_FALLBACK_KEY, "dark");
      setupMatchMedia(false);

      // Execute blocking script
      eval(THEME_BLOCKING_SCRIPT);

      expect(document.documentElement.classList.contains("dark")).toBe(true);
      expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
      expect(document.documentElement.style.colorScheme).toBe("dark");
    });

    it("applies dark class and data-theme when localStorage('ophirpay-theme') is dark", () => {
      window.localStorage.setItem(THEME_STORAGE_KEY, "dark");
      setupMatchMedia(false);

      eval(THEME_BLOCKING_SCRIPT);

      expect(document.documentElement.classList.contains("dark")).toBe(true);
      expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
      expect(document.documentElement.style.colorScheme).toBe("dark");
    });

    it("removes dark class and sets light theme when storage is explicitly 'light'", () => {
      document.documentElement.classList.add("dark");
      window.localStorage.setItem(THEME_FALLBACK_KEY, "light");
      setupMatchMedia(true); // prefers dark, but explicit light takes precedence

      eval(THEME_BLOCKING_SCRIPT);

      expect(document.documentElement.classList.contains("dark")).toBe(false);
      expect(document.documentElement.getAttribute("data-theme")).toBe("light");
      expect(document.documentElement.style.colorScheme).toBe("light");
    });

    it("falls back to matchMedia prefers-color-scheme when theme is 'system'", () => {
      window.localStorage.setItem(THEME_FALLBACK_KEY, "system");
      setupMatchMedia(true);

      eval(THEME_BLOCKING_SCRIPT);

      expect(document.documentElement.classList.contains("dark")).toBe(true);
      expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
      expect(document.documentElement.style.colorScheme).toBe("dark");
    });

    it("falls back to matchMedia prefers-color-scheme when no storage entry exists", () => {
      setupMatchMedia(true);

      eval(THEME_BLOCKING_SCRIPT);

      expect(document.documentElement.classList.contains("dark")).toBe(true);
      expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
      expect(document.documentElement.style.colorScheme).toBe("dark");
    });

    it("gracefully catches errors when localStorage throws (e.g. strict security / private mode)", () => {
      const getItemSpy = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
        throw new Error("SecurityError: Access is denied for this document");
      });

      expect(() => eval(THEME_BLOCKING_SCRIPT)).not.toThrow();
      getItemSpy.mockRestore();
    });
  });

  describe("DOM Pre-hydrated Theme Detection & useTheme state", () => {
    it("detects pre-hydrated dark theme from documentElement data-theme attribute", () => {
      document.documentElement.setAttribute("data-theme", "dark");
      expect(getPrehydratedResolvedTheme()).toBe("dark");

      document.documentElement.setAttribute("data-theme", "light");
      expect(getPrehydratedResolvedTheme()).toBe("light");
    });

    it("detects pre-hydrated dark theme from documentElement dark class if attribute is missing", () => {
      document.documentElement.classList.add("dark");
      expect(getPrehydratedResolvedTheme()).toBe("dark");
    });

    it("reads persisted theme from storage keys", () => {
      expect(getStoredTheme()).toBeNull();

      window.localStorage.setItem(THEME_STORAGE_KEY, "light");
      expect(getStoredTheme()).toBe("light");

      window.localStorage.removeItem(THEME_STORAGE_KEY);
      window.localStorage.setItem(THEME_FALLBACK_KEY, "dark");
      expect(getStoredTheme()).toBe("dark");
    });

    it("initializes useTheme with pre-hydrated DOM state to eliminate hydration flash", () => {
      // Simulate HTML head script already ran before React hydration
      document.documentElement.classList.add("dark");
      document.documentElement.setAttribute("data-theme", "dark");
      window.localStorage.setItem(THEME_STORAGE_KEY, "dark");

      const wrapper = ({ children }: { children: ReactNode }) => (
        <ThemeProvider>{children}</ThemeProvider>
      );

      const { result } = renderHook(() => useTheme(), { wrapper });

      expect(result.current.theme).toBe("dark");
      expect(result.current.resolved).toBe("dark");
      expect(result.current.mounted).toBe(true);
    });

    it("persists theme updates to both storage keys for cross-compatibility", () => {
      const wrapper = ({ children }: { children: ReactNode }) => (
        <ThemeProvider>{children}</ThemeProvider>
      );

      const { result } = renderHook(() => useTheme(), { wrapper });

      act(() => {
        result.current.setTheme("dark");
      });

      expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
      expect(window.localStorage.getItem(THEME_FALLBACK_KEY)).toBe("dark");
      expect(result.current.resolved).toBe("dark");
      expect(document.documentElement.classList.contains("dark")).toBe(true);
      expect(document.documentElement.style.colorScheme).toBe("dark");

      act(() => {
        result.current.setTheme("light");
      });

      expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");
      expect(window.localStorage.getItem(THEME_FALLBACK_KEY)).toBe("light");
      expect(result.current.resolved).toBe("light");
      expect(document.documentElement.classList.contains("dark")).toBe(false);
      expect(document.documentElement.style.colorScheme).toBe("light");
    });
  });

  describe("Header component theme toggle & SSR/pre-hydration compatibility", () => {
    it("renders smoothly within ThemeProvider and toggles theme on click", () => {
      render(
        <ThemeProvider>
          <Header />
        </ThemeProvider>
      );

      const button = screen.getByRole("button", { name: /switch to (dark|light) mode/i });
      expect(button).toBeInTheDocument();

      // Initial state is light (matchMedia false)
      expect(button).toHaveAttribute("aria-label", "Switch to dark mode");

      // Click to toggle to dark
      fireEvent.click(button);
      expect(button).toHaveAttribute("aria-label", "Switch to light mode");
      expect(document.documentElement.classList.contains("dark")).toBe(true);
      expect(window.localStorage.getItem(THEME_FALLBACK_KEY)).toBe("dark");

      // Click to toggle back to light
      fireEvent.click(button);
      expect(button).toHaveAttribute("aria-label", "Switch to dark mode");
      expect(document.documentElement.classList.contains("dark")).toBe(false);
      expect(window.localStorage.getItem(THEME_FALLBACK_KEY)).toBe("light");
    });
  });
});
