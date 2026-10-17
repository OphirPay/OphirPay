// SPDX-License-Identifier: MIT

/**
 * Theme context provider and useTheme hook (#1376).
 * Supports light/dark/system mode with localStorage persistence and
 * synchronous pre-hydration DOM state initialization to eliminate FOUC.
 */
"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  type ReactNode,
} from "react";

export type Theme = "light" | "dark" | "system";

export const THEME_STORAGE_KEY = "theme";
export const LEGACY_THEME_STORAGE_KEY = "ophirpay-theme";

export interface ThemeContextValue {
  theme: Theme;
  resolved: "light" | "dark";
  mounted: boolean;
  setTheme: (theme: Theme) => void;
  toggle: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function isValidTheme(value: string | null): value is Theme {
  return value === "light" || value === "dark" || value === "system";
}

export function readStoredTheme(): Theme {
  if (typeof window === "undefined") return "system";
  try {
    const primary = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (isValidTheme(primary)) return primary;
    const legacy = window.localStorage.getItem(LEGACY_THEME_STORAGE_KEY);
    if (isValidTheme(legacy)) return legacy;
  } catch {
    // Ignore storage access errors in restricted environments
  }
  return "system";
}

export function resolveTheme(theme: Theme): "light" | "dark" {
  if (theme !== "system") return theme;
  if (typeof window === "undefined") return "dark";
  if (typeof window.matchMedia !== "function") return "dark";
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

/**
 * Read the theme already applied to `document.documentElement` by the blocking
 * `<head>` initialization script so React's first client render matches the
 * pre-hydrated DOM without flashing (#1376).
 */
export function readPreHydratedResolvedTheme(): "light" | "dark" {
  if (typeof document !== "undefined") {
    const attr = document.documentElement.getAttribute("data-theme");
    if (attr === "dark" || attr === "light") {
      return attr;
    }
    if (document.documentElement.classList.contains("dark")) {
      return "dark";
    }
  }
  return resolveTheme(readStoredTheme());
}

export function applyThemeToDom(resolved: "light" | "dark"): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (resolved === "dark") {
    root.classList.add("dark");
  } else {
    root.classList.remove("dark");
  }
  root.setAttribute("data-theme", resolved);
  root.style.colorScheme = resolved;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(() => readStoredTheme());
  const [resolved, setResolved] = useState<"light" | "dark">(() =>
    readPreHydratedResolvedTheme()
  );
  const [mounted, setMounted] = useState(false);

  const applyTheme = useCallback((t: Theme) => {
    const r = resolveTheme(t);
    applyThemeToDom(r);
    setResolved(r);
  }, []);

  const setTheme = useCallback(
    (t: Theme) => {
      setThemeState(t);
      try {
        localStorage.setItem(THEME_STORAGE_KEY, t);
        localStorage.setItem(LEGACY_THEME_STORAGE_KEY, t);
      } catch {
        // Ignore storage write errors
      }
      applyTheme(t);
    },
    [applyTheme]
  );

  const toggle = useCallback(() => {
    setTheme(resolved === "dark" ? "light" : "dark");
  }, [resolved, setTheme]);

  useEffect(() => {
    const initial = readStoredTheme();
    setThemeState(initial);
    applyTheme(initial);
    setMounted(true);
  }, [applyTheme]);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return;
    }
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => {
      if (theme === "system") applyTheme("system");
    };
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [theme, applyTheme]);

  return (
    <ThemeContext.Provider value={{ theme, resolved, mounted, setTheme, toggle }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within a ThemeProvider");
  return ctx;
}
