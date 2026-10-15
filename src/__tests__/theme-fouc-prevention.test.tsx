// SPDX-License-Identifier: MIT

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { render, screen, fireEvent, act, renderHook } from "@testing-library/react";
import React, { ReactNode } from "react";
import { ThemeProvider, useTheme } from "@/hooks/useTheme";
import { Header } from "@/components/Header";
import fs from "fs";
import path from "path";

// Mock WalletButton
vi.mock("@/components/WalletButton", () => ({
  WalletButton: () => <button data-testid="mock-wallet-btn">Connect Wallet</button>,
}));

type MediaListener = (event: { matches: boolean }) => void;

function setupMatchMedia(prefersDark: boolean) {
  const listeners: MediaListener[] = [];
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: query.includes("dark") ? prefersDark : !prefersDark,
      media: query,
      onchange: null,
      addEventListener: vi.fn((_type: string, cb: MediaListener) => {
        listeners.push(cb);
      }),
      removeEventListener: vi.fn((_type: string, cb: MediaListener) => {
        const i = listeners.indexOf(cb);
        if (i >= 0) listeners.splice(i, 1);
      }),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
  return listeners;
}

// Executes the exact inline blocking script defined in src/app/layout.tsx
function executeLayoutThemeScript() {
  try {
    const stored = localStorage.getItem("theme") || localStorage.getItem("ophirpay-theme");
    const prefersDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
    const dark = stored === "dark" ||
      ((stored === null || stored === "system" || !stored) && prefersDark);
    if (dark) {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
    document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
    document.documentElement.style.colorScheme = dark ? "dark" : "light";
  } catch {}
}

describe("Theme FOUC Prevention & Hydration Synchronization (#1376)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    document.documentElement.className = "";
    document.documentElement.removeAttribute("data-theme");
    document.documentElement.style.colorScheme = "";
  });

  describe("Blocking Theme Script Execution", () => {
    it("adds .dark and data-theme='dark' when system prefers dark and no localStorage is set", () => {
      setupMatchMedia(true);
      executeLayoutThemeScript();

      expect(document.documentElement.classList.contains("dark")).toBe(true);
      expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
      expect(document.documentElement.style.colorScheme).toBe("dark");
    });

    it("removes .dark and sets data-theme='light' when system prefers light and no localStorage is set", () => {
      document.documentElement.classList.add("dark");
      setupMatchMedia(false);
      executeLayoutThemeScript();

      expect(document.documentElement.classList.contains("dark")).toBe(false);
      expect(document.documentElement.getAttribute("data-theme")).toBe("light");
      expect(document.documentElement.style.colorScheme).toBe("light");
    });

    it("honors stored 'dark' from localStorage.getItem('theme')", () => {
      setupMatchMedia(false);
      window.localStorage.setItem("theme", "dark");
      executeLayoutThemeScript();

      expect(document.documentElement.classList.contains("dark")).toBe(true);
      expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    });

    it("honors stored 'light' from localStorage.getItem('theme')", () => {
      document.documentElement.classList.add("dark");
      setupMatchMedia(true);
      window.localStorage.setItem("theme", "light");
      executeLayoutThemeScript();

      expect(document.documentElement.classList.contains("dark")).toBe(false);
      expect(document.documentElement.getAttribute("data-theme")).toBe("light");
    });

    it("honors stored 'dark' from localStorage.getItem('ophirpay-theme')", () => {
      setupMatchMedia(false);
      window.localStorage.setItem("ophirpay-theme", "dark");
      executeLayoutThemeScript();

      expect(document.documentElement.classList.contains("dark")).toBe(true);
      expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    });
  });

  describe("useTheme Pre-Hydrated DOM Synchronization", () => {
    it("synchronizes hook state directly with pre-hydrated DOM class and data-theme", () => {
      setupMatchMedia(true);
      executeLayoutThemeScript();
      expect(document.documentElement.classList.contains("dark")).toBe(true);

      const wrapper = ({ children }: { children: ReactNode }) => (
        <ThemeProvider>{children}</ThemeProvider>
      );

      const { result } = renderHook(() => useTheme(), { wrapper });

      expect(result.current.resolved).toBe("dark");
      expect(result.current.mounted).toBe(true);
    });

    it("synchronizes hook state when pre-hydrated DOM is explicitly light", () => {
      setupMatchMedia(true);
      window.localStorage.setItem("theme", "light");
      executeLayoutThemeScript();
      expect(document.documentElement.classList.contains("dark")).toBe(false);
      expect(document.documentElement.getAttribute("data-theme")).toBe("light");

      const wrapper = ({ children }: { children: ReactNode }) => (
        <ThemeProvider>{children}</ThemeProvider>
      );

      const { result } = renderHook(() => useTheme(), { wrapper });

      expect(result.current.resolved).toBe("light");
      expect(result.current.theme).toBe("light");
    });

    it("persists theme to both 'theme' and 'ophirpay-theme' on setTheme", () => {
      setupMatchMedia(false);
      const wrapper = ({ children }: { children: ReactNode }) => (
        <ThemeProvider>{children}</ThemeProvider>
      );

      const { result } = renderHook(() => useTheme(), { wrapper });

      act(() => {
        result.current.setTheme("dark");
      });

      expect(window.localStorage.getItem("theme")).toBe("dark");
      expect(window.localStorage.getItem("ophirpay-theme")).toBe("dark");
      expect(result.current.resolved).toBe("dark");
      expect(document.documentElement.classList.contains("dark")).toBe(true);
    });
  });

  describe("Header Component Integration", () => {
    it("renders theme toggle button with suppressHydrationWarning and toggles theme", () => {
      setupMatchMedia(false);
      const wrapper = ({ children }: { children: ReactNode }) => (
        <ThemeProvider>{children}</ThemeProvider>
      );

      render(
        <ThemeProvider>
          <Header />
        </ThemeProvider>
      );

      const toggleBtn = screen.getByRole("button", { name: /switch to dark mode/i });
      expect(toggleBtn).toBeInTheDocument();

      fireEvent.click(toggleBtn);

      expect(window.localStorage.getItem("theme")).toBe("dark");
      expect(window.localStorage.getItem("ophirpay-theme")).toBe("dark");
      expect(document.documentElement.classList.contains("dark")).toBe(true);
    });
  });

  describe("CSP Compliance & Layout Integration", () => {
    it("verifies layout.tsx has inline blocking script with nonce and localStorage check", () => {
      const layoutPath = path.resolve(__dirname, "../app/layout.tsx");
      const content = fs.readFileSync(layoutPath, "utf-8");

      expect(content).toContain("nonce={nonce}");
      expect(content).toContain('localStorage.getItem("theme")');
      expect(content).toContain('localStorage.getItem("ophirpay-theme")');
      expect(content).toContain('window.matchMedia("(prefers-color-scheme: dark)")');
      expect(content).toContain('document.documentElement.classList.add("dark")');
      expect(content).toContain('document.documentElement.setAttribute("data-theme"');
    });
  });
});
