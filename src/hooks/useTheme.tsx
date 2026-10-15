// SPDX-License-Identifier: MIT

/**
 * Theme context provider and useTheme hook.
 * Supports light/dark/system mode with localStorage persistence.
 *
 * @example
 * Wrap your app tree once, then read and toggle the theme anywhere:
 *
 * ```tsx
 * // app/layout.tsx (root layout)
 * export default function RootLayout({ children }) {
 *   return <ThemeProvider>{children}</ThemeProvider>;
 * }
 *
 * function ThemeToggle() {
 *   const { theme, resolved, toggle } = useTheme();
 *   return (
 *     <button onClick={toggle} aria-label="Toggle theme">
 *       {resolved === "dark" ? "🌙" : "☀️"} ({theme})
 *     </button>
 *   );
 * }
 * ```
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

type Theme = "light" | "dark" | "system";

interface ThemeContextValue {
  theme: Theme;
  resolved: "light" | "dark";
  setTheme: (theme: Theme) => void;
  toggle: () => void;
  mounted: boolean;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function resolveTheme(theme: Theme): "light" | "dark" {
  if (theme !== "system") return theme;
  if (typeof window === "undefined") return "dark";
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

function getStoredTheme(): Theme | null {
  if (typeof window === "undefined") return null;
  try {
    const stored = (localStorage.getItem("theme") || localStorage.getItem("ophirpay-theme")) as Theme | null;
    if (stored === "light" || stored === "dark" || stored === "system") {
      return stored;
    }
  } catch {}
  return null;
}

function getPreHydratedTheme(): { theme: Theme; resolved: "light" | "dark" } {
  const stored = getStoredTheme();
  const theme: Theme = stored ?? "system";

  if (typeof document !== "undefined") {
    try {
      const dataTheme = document.documentElement.getAttribute("data-theme");
      if (dataTheme === "light" || dataTheme === "dark") {
        return { theme, resolved: dataTheme };
      }
      if (document.documentElement.classList.contains("dark")) {
        return { theme, resolved: "dark" };
      }
    } catch {}
  }

  return { theme, resolved: resolveTheme(theme) };
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(() => getPreHydratedTheme().theme);
  const [resolved, setResolved] = useState<"light" | "dark">(() => getPreHydratedTheme().resolved);
  const [mounted, setMounted] = useState<boolean>(false);

  const applyTheme = useCallback((t: Theme) => {
    const r = resolveTheme(t);
    if (typeof document !== "undefined") {
      document.documentElement.classList.toggle("dark", r === "dark");
      document.documentElement.setAttribute("data-theme", r);
      document.documentElement.style.colorScheme = r;
    }
    setResolved(r);
  }, []);

  const setTheme = useCallback(
    (t: Theme) => {
      setThemeState(t);
      try {
        localStorage.setItem("ophirpay-theme", t);
        localStorage.setItem("theme", t);
      } catch {}
      applyTheme(t);
    },
    [applyTheme]
  );

  const toggle = useCallback(() => {
    setTheme(resolved === "dark" ? "light" : "dark");
  }, [resolved, setTheme]);

  useEffect(() => {
    const pre = getPreHydratedTheme();
    setThemeState(pre.theme);
    setResolved(pre.resolved);
    if (typeof document !== "undefined") {
      document.documentElement.classList.toggle("dark", pre.resolved === "dark");
      document.documentElement.setAttribute("data-theme", pre.resolved);
      document.documentElement.style.colorScheme = pre.resolved;
    }
    setMounted(true);
  }, [applyTheme]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => {
      if (theme === "system") applyTheme("system");
    };
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [theme, applyTheme]);

  return (
    <ThemeContext.Provider value={{ theme, resolved, setTheme, toggle, mounted }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within a ThemeProvider");
  return ctx;
}
