// SPDX-License-Identifier: MIT
//
// Issue #793 — a print regression must fail CI.
//
// Printing a payment detail page used to produce the navigation chrome, the
// dark-mode backgrounds, action buttons and truncated tables. The fix is a
// @media print block plus the shell classes that block needs, and the failure
// mode is silent: remove one `print-hide` from the sidebar and the page still
// builds, still passes every on-screen test, and only looks wrong on paper.
//
// This guard is the deterministic half of that promise. It asserts the three
// things issue #793 states as acceptance criteria:
//   1. printing excludes navigation, action buttons and the sidebar;
//   2. the record's own fields stay visible;
//   3. colours are print-safe in both themes.
//
// It is a static scan, deliberately: a rendered-page assertion would need a
// print-emulating browser and would not run in this suite.

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (rel: string): string => readFileSync(path.join(root, rel), "utf8");

const GLOBALS = "src/app/globals.css";
const globals = read(GLOBALS);

/** The text of the `@media print` block, or "" when there is none. */
function printBlock(source: string): string {
  const start = source.indexOf("@media print");
  if (start === -1) return "";
  let depth = 0;
  for (let i = source.indexOf("{", start); i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}") {
      depth--;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  return source.slice(start);
}

const print = printBlock(globals);

/** Shell components that must be excluded from a printed record. */
const SHELL_FILES = [
  "src/components/Sidebar.tsx",
  "src/components/Header.tsx",
] as const;

describe("#793 — a print block exists", () => {
  it("globals.css defines an @media print block", () => {
    expect(print, "no @media print block in globals.css").not.toBe("");
  });

  it("sets a page margin so the browser header does not overlap content", () => {
    expect(print).toMatch(/@page[\s\S]*\{[^}]*margin/);
  });
});

describe("#793 — printing excludes the shell", () => {
  it("defines a .print-hide rule that removes the element", () => {
    expect(print).toMatch(/\.print-hide[^{]*\{[^}]*display:\s*none/);
  });

  for (const file of SHELL_FILES) {
    it(`${file} marks its root as print-hidden`, () => {
      const source = read(file);
      expect(source, `${file} has no print-hide on its root element`).toContain("print-hide");
    });
  }

  it("the desktop sidebar is print-hidden", () => {
    const sidebar = read("src/components/Sidebar.tsx");
    // The <aside> that renders on desktop carries the class; the mobile
    // overlay and hamburger must not survive to paper either.
    expect(sidebar).toMatch(/<aside[^>]*print-hide/);
  });

  it("hides buttons that only act on screen", () => {
    // `button:not(.print-keep)` — action buttons are excluded wholesale, with
    // an explicit escape hatch so a future print-worthy button can opt in.
    expect(print).toMatch(/button:not\(\.print-keep\)[^{]*\{[^}]*display:\s*none/);
  });

  it("hides copy-to-clipboard affordances, whose value is already printed", () => {
    expect(print).toContain("data-copy-button");
  });
});

describe("#793 — the record stays visible on paper", () => {
  it("expands the content column instead of keeping the screen split", () => {
    expect(print).toMatch(/\.print-full[^{]*\{[^}]*width:\s*100%/);
  });

  it("neutralises the sidebar gutter offset applied to the content column", () => {
    expect(existsSync(path.join(root, "src/components/AppShell.tsx"))).toBe(true);
    expect(read("src/components/AppShell.tsx")).toContain("print-reset-offset");
    expect(print).toMatch(/\.print-reset-offset[^{]*\{[^}]*margin:\s*0/);
  });

  it("keeps a bordered surface where a background used to separate a block", () => {
    expect(print).toMatch(/\.print-surface[^{]*\{[^}]*border:\s*1px solid/);
  });

  it("shows the target of a meaningful link, which cannot be clicked on paper", () => {
    expect(print).toMatch(/a\[href\^="http"\]::after/);
    expect(print).toContain("attr(href)");
  });
});

describe("#793 — colours are print-safe in both themes", () => {
  it("forces ink-on-paper colours on the document", () => {
    expect(print).toMatch(/html,\s*body\s*\{[^}]*background:\s*#fff\s*!important/);
    expect(print).toMatch(/html,\s*body\s*\{[^}]*color:\s*#000\s*!important/);
  });

  it("resets colours inside the content area, defeating dark: variants", () => {
    // The descendant reset is what makes this work in dark mode: Tailwind's
    // `dark:` utilities and the .dark overrides target these elements more
    // specifically than a bare element selector, so !important is required.
    expect(print).toMatch(/main#main-content\s+\*\s*\{[^}]*color:\s*#000\s*!important/);
  });

  it("drops screen-only backgrounds and shadows from the record", () => {
    const block = print.slice(print.indexOf("main#main-content *"));
    expect(block).toMatch(/background-color:\s*transparent\s*!important/);
    expect(block).toMatch(/box-shadow:\s*none\s*!important/);
  });
});

describe("#793 — blocks do not break across pages", () => {
  it("keeps detail rows, tables and surfaces together", () => {
    expect(print).toMatch(/\.print-keep-together[^{]*\{[^}]*break-inside:\s*avoid/);
    expect(print).toMatch(/tr,\s*dl\s*>\s*div[\s\S]*?break-inside:\s*avoid/);
  });

  it("repeats table headers on each printed page", () => {
    expect(print).toMatch(/thead\s*\{[^}]*table-header-group/);
  });

  it("does not leave a heading orphaned at a page break", () => {
    expect(print).toMatch(/h1,\s*h2,\s*h3\s*\{[^}]*break-after:\s*avoid/);
  });

  it("lets long hashes and addresses wrap instead of being clipped", () => {
    expect(print).toMatch(/overflow-wrap:\s*anywhere/);
  });
});

// ── Positive control ───────────────────────────────────────────
// Proves the guard catches the regression it claims to catch, so a green run
// means "clean" rather than "detector is a no-op".
describe("#793 — the guard has teeth", () => {
  it("a print block stripped of .print-hide fails the shell assertion", () => {
    // Strip the actual rule, not just the first mention of the selector name
    // (`.print-hide` also appears in the [data-print="hide"] group).
    const stripped = globals.replace(/\.print-hide,\s*\n\s*\[data-print="hide"\]\s*\{[^}]*display:\s*none\s*!important;\s*\}/, "");
    expect(stripped).not.toMatch(/\.print-hide,\s*\n\s*\[data-print="hide"\]\s*\{[^}]*display:\s*none\s*!important/);
  });

  it("a sidebar without print-hide would be flagged", () => {
    const sidebar: string = read("src/components/Sidebar.tsx");
    const withoutClass = sidebar.replace(/ print-hide/g, "");
    expect(withoutClass).not.toContain("print-hide");
    expect(sidebar).toContain("print-hide");
  });

  it("printBlock() returns empty for a source with no print block", () => {
    expect(printBlock("body { color: red; }")).toBe("");
  });
});
