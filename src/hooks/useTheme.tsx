// SPDX-License-Identifier: MIT

/**
 * Theme context provider and useTheme hook.
 * Supports light/dark/system mode with localStorage persistence,
 * pre-hydrated DOM synchronization, and blocking script integration to eliminate FOUC.
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

export type Theme = "light" | "dark" | "system";

export interface ThemeContextValue {
  theme: Theme;
  resolved: "light" | "dark";
  setTheme: (theme: Theme) => void;
  toggle: () => void;
  mounted: boolean;
}

export const THEME_STORAGE_KEY = "ophirpay-theme";
export const THEME_FALLBACK_KEY = "theme";

/**
 * Inline blocking script injected into `<head>` to prevent Flash of Unstyled Content (FOUC)
 * before first paint. Checks localStorage('theme') and localStorage('ophirpay-theme')
 * with system dark mode media query fallback.
 */
export const THEME_BLOCKING_SCRIPT = `(function () {
  try {
    var stored = localStorage.getItem("${THEME_FALLBACK_KEY}") || localStorage.getItem("${THEME_STORAGE_KEY}");
    var prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    var isDark = stored === "dark" || ((!stored || stored === "system") && prefersDark);
    var root = document.documentElement;
    if (isDark) {
      root.classList.add("dark");
    } else {
      root.classList.remove("dark");
    }
    root.setAttribute("data-theme", isDark ? "dark" : "light");
    root.style.colorScheme = isDark ? "dark" : "light";
  } catch (e) {}
})();`;

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function resolveTheme(theme: Theme): "light" | "dark" {
  if (theme !== "system") return theme;
  if (typeof window === "undefined") return "dark";
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

export function getStoredTheme(): Theme | null {
  if (typeof window === "undefined") return null;
  try {
    const primary = localStorage.getItem(THEME_STORAGE_KEY) as Theme | null;
    if (primary && ["light", "dark", "system"].includes(primary)) return primary;
    const fallback = localStorage.getItem(THEME_FALLBACK_KEY) as Theme | null;
    if (fallback && ["light", "dark", "system"].includes(fallback)) return fallback;
    return null;
  } catch {
    return null;
  }
}

export function getPrehydratedResolvedTheme(): "light" | "dark" | null {
  if (typeof window === "undefined") return null;
  try {
    const root = document.documentElement;
    const dataTheme = root.getAttribute("data-theme");
    if (dataTheme === "dark" || dataTheme === "light") {
      return dataTheme;
    }
    if (root.classList.contains("dark")) {
      return "dark";
    }
    return null;
  } catch {
    return null;
  }
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  // Synchronize initial state with pre-hydrated DOM to eliminate theme flicker / FOUC
  const [theme, setThemeState] = useState<Theme>(() => {
    return getStoredTheme() ?? "system";
  });
  const [resolved, setResolved] = useState<"light" | "dark">(() => {
    const prehydrated = getPrehydratedResolvedTheme();
    if (prehydrated) return prehydrated;
    const initial = getStoredTheme() ?? "system";
    return resolveTheme(initial);
  });
  const [mounted, setMounted] = useState(false);

  const applyTheme = useCallback((t: Theme) => {
    const r = resolveTheme(t);
    const root = document.documentElement;
    root.classList.toggle("dark", r === "dark");
    root.setAttribute("data-theme", r);
    root.style.colorScheme = r;
    setResolved(r);
  }, []);

  const setTheme = useCallback(
    (t: Theme) => {
      setThemeState(t);
      try {
        localStorage.setItem(THEME_STORAGE_KEY, t);
        localStorage.setItem(THEME_FALLBACK_KEY, t);
      } catch {}
      applyTheme(t);
    },
    [applyTheme]
  );

  const toggle = useCallback(() => {
    setTheme(resolved === "dark" ? "light" : "dark");
  }, [resolved, setTheme]);

  useEffect(() => {
    setMounted(true);
    const stored = getStoredTheme() ?? "system";
    setThemeState(stored);

    // Verify DOM consistency with target state
    const prehydrated = getPrehydratedResolvedTheme();
    const targetResolved = resolveTheme(stored);
    if (!prehydrated || prehydrated !== targetResolved) {
      applyTheme(stored);
    } else {
      document.documentElement.style.colorScheme = prehydrated;
      setResolved(prehydrated);
    }
  }, [applyTheme]);

  useEffect(() => {
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
