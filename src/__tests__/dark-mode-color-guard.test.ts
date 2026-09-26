// SPDX-License-Identifier: MIT
//
// Issue #715 — a deliberate hardcoded-colour regression must fail CI.
//
// The screenshot suite in `tests/visual` compares committed PNG baselines
// against a live deployment, which means it can only run where that deployment
// is reachable. This guard is the deterministic half of the same promise: it
// statically scans the components most likely to hardcode colours (status
// badges, the payment timeline, the analytics charts and toasts) and fails if a
// raw colour literal bypasses the theme token layer.
//
// Why this exists: a literal such as `text-[#ff0000]` renders identically in
// light and dark, so it passes every light-mode baseline and only shows up as
// an invisible-to-CI contrast bug — the class of regression issue #558 had to
// fix by hand. Prefer `text-red-500 dark:text-red-400` or a CSS variable.
//
// The palette module (`src/lib/color-utils.ts`) is intentionally literal and is
// therefore not in the scanned set: charts need concrete dataset colours.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Components that must express colour through theme tokens (CSS variables or
 * Tailwind classes with `dark:` variants) rather than raw literals.
 */
const COLOUR_CRITICAL_FILES = [
  "src/components/ui/Badge.tsx", // status badges
  "src/components/ui/Toast.tsx", // toasts
  "src/components/payments/PaymentTimeline.tsx", // payment timeline
  "src/components/analytics/AnalyticsDashboard.tsx", // charts
] as const;

const RAW_COLOUR_LITERAL = /#[0-9a-fA-F]{3,8}\b|\b(?:rgb|rgba|hsl|hsla)\(/g;

/**
 * Return the raw colour literals in a source string.
 *
 * Comments are stripped (so an issue reference like `#558` is not a false
 * positive) and `shadow-[...]` arbitrary values are dropped, because a 1px
 * key-shadow colour is theme-agnostic; only foreground/background/border/fill
 * colours are in scope.
 */
function findHardcodedColourLiterals(source: string): string[] {
  const withoutComments = source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|\s)\/\/[^\n]*/g, "$1");
  const scannable = withoutComments.replace(/shadow-\[[^\]]*\]/g, "");
  return scannable.match(RAW_COLOUR_LITERAL) ?? [];
}

describe("dark-mode colour guard", () => {
  for (const file of COLOUR_CRITICAL_FILES) {
    it(`${file} uses theme tokens instead of hardcoded colours`, () => {
      const source = readFileSync(path.resolve(process.cwd(), file), "utf8");
      const literals = findHardcodedColourLiterals(source);

      expect(
        literals,
        `${file} contains hardcoded colour literal(s): ${literals.join(", ")}. ` +
          `Use a theme token (e.g. a CSS variable) or a Tailwind pair such as ` +
          `\`text-red-500 dark:text-red-400\` so the colour adapts to dark mode.`
      ).toEqual([]);
    });
  }

  // ── Positive control ─────────────────────────────────────────
  // Proves the guard actually catches the regression it claims to catch, so a
  // green run means "clean", not "detector is a no-op".

  it("catches a hardcoded Tailwind arbitrary colour", () => {
    const regressed = `export function StatusBadge() {
      return <span className="text-[#ff0000] dark:text-red-400">Failed</span>;
    }`;

    expect(findHardcodedColourLiterals(regressed)).toEqual(["#ff0000"]);
  });

  it("catches a hardcoded inline style colour", () => {
    const regressed = `export function Chart() {
      return <div style={{ backgroundColor: "#3b82f6" }} />;
    }`;

    expect(findHardcodedColourLiterals(regressed)).toEqual(["#3b82f6"]);
  });

  it("catches a hardcoded rgb/rgba colour", () => {
    const regressed = `<svg fill="rgb(0,0,0)"><path stroke="rgba(255,255,255,0.5)" /></svg>`;

    expect(findHardcodedColourLiterals(regressed)).toEqual([
      "rgb(",
      "rgba(",
    ]);
  });

  it("does not flag a theme-agnostic key shadow or comments", () => {
    const clean = `// Contrast fix tracked in #558, values below are a shadow only
    <kbd className="shadow-[0_1px_0_rgba(0,0,0,0.1)] text-ophir-600 dark:text-ophir-400" />`;

    expect(findHardcodedColourLiterals(clean)).toEqual([]);
  });
});
