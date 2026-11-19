// SPDX-License-Identifier: MIT

/**
 * Pre-paint blocking theme script to eliminate Flash of Unstyled Content (FOUC).
 *
 * Executes synchronously in <head> before first paint.
 * Inspects `theme` and legacy `ophirpay-theme` from localStorage,
 * falling back to `prefers-color-scheme: dark`.
 * Synchronously sets `.dark` class, `data-theme` attribute, and `colorScheme` style.
 */
export const THEME_BLOCKING_SCRIPT = `(function() {
  try {
    var stored = localStorage.getItem("theme") || localStorage.getItem("ophirpay-theme");
    var dark = stored === "dark" ||
      ((stored === null || stored === "system" || !stored) &&
        window.matchMedia("(prefers-color-scheme: dark)").matches);
    if (dark) {
      document.documentElement.classList.add("dark");
      document.documentElement.style.colorScheme = "dark";
    } else {
      document.documentElement.classList.remove("dark");
      document.documentElement.style.colorScheme = "light";
    }
    document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
  } catch (e) {}
})();`;
