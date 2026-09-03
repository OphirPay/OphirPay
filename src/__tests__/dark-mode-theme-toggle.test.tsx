// SPDX-License-Identifier: MIT

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { ThemeProvider, useTheme } from "@/hooks/useTheme";
import { ThemeToggle } from "@/components/ThemeToggle";

describe("Dark-Mode Theme Toggle & Persistence", () => {
  let matchMediaMock: ReturnType<typeof vi.fn>;
  let changeHandler: (() => void) | null = null;

  beforeEach(() => {
    localStorage.clear();
    document.documentElement.className = "";
    document.documentElement.removeAttribute("data-theme");

    changeHandler = null;
    matchMediaMock = vi.fn().mockImplementation((query: string) => ({
      matches: query.includes("dark"),
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn((event: string, handler: () => void) => {
        if (event === "change") changeHandler = handler;
      }),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));

    window.matchMedia = matchMediaMock;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("respects OS dark preference by default and applies dark class", () => {
    render(
      <ThemeProvider>
        <ThemeToggle />
      </ThemeProvider>
    );

    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(screen.getByTestId("sun-icon")).toBeDefined();
    expect(screen.getByLabelText("Switch to light mode")).toBeDefined();
  });

  it("respects OS light preference by default when system is light", () => {
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: false, // light
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));

    render(
      <ThemeProvider>
        <ThemeToggle />
      </ThemeProvider>
    );

    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
    expect(screen.getByTestId("moon-icon")).toBeDefined();
    expect(screen.getByLabelText("Switch to dark mode")).toBeDefined();
  });

  it("toggles theme and persists choice in localStorage", () => {
    render(
      <ThemeProvider>
        <ThemeToggle />
      </ThemeProvider>
    );

    const button = screen.getByRole("button");

    // Initially dark (due to mock)
    expect(document.documentElement.classList.contains("dark")).toBe(true);

    // Toggle to light
    fireEvent.click(button);
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
    expect(localStorage.getItem("ophirpay-theme")).toBe("light");

    // Toggle back to dark
    fireEvent.click(button);
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(localStorage.getItem("ophirpay-theme")).toBe("dark");
  });

  it("initializes from stored localStorage preference", () => {
    localStorage.setItem("ophirpay-theme", "light");

    render(
      <ThemeProvider>
        <ThemeToggle />
      </ThemeProvider>
    );

    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
  });

  it("renders with label when showLabel is true", () => {
    render(
      <ThemeProvider>
        <ThemeToggle showLabel={true} />
      </ThemeProvider>
    );

    expect(screen.getByText(/Light Mode|Dark Mode/)).toBeDefined();
  });

  it("throws an error when useTheme is used outside ThemeProvider", () => {
    const TestComponent = () => {
      useTheme();
      return null;
    };

    // Suppress expected console.error in test
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<TestComponent />)).toThrow(
      "useTheme must be used within a ThemeProvider"
    );
    consoleError.mockRestore();
  });
});
