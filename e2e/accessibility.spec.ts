import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import type { Result } from "axe-core";
import playwrightConfig from "../playwright.config";

type Theme = "light" | "dark";

/**
 * Accessibility scan across the core flows **and** the admin surfaces
 * (issue #723).
 *
 * Admin pages — multisig, governance, keys, audit-log, fee-config, rbac,
 * timelock, pause-controls, policy-versions, contracts — are full of the
 * widgets that axe is best at catching: data tables, dialogs, tabs and
 * destructive confirmations. They are also the pages most likely to drift as
 * more contributors touch them, which is why they get an automated gate rather
 * than an occasional eyeball.
 *
 * Every route is scanned in both themes, and Playwright runs the whole matrix
 * once per project defined in `playwright.config.ts` (chromium, firefox,
 * mobile-chrome) — see the project-coverage test at the bottom, which fails if
 * a project is ever dropped.
 *
 * Failures list the axe **rule id** and the offending **selector**, so a red
 * run is actionable without opening the HTML report.
 */

const CORE_ROUTES: [path: string, name: string][] = [
  ["/", "dashboard"],
  ["/send", "send"],
  ["/batches", "batches"],
  ["/payments", "payments"],
  ["/webhooks", "webhooks"],
];

const ADMIN_ROUTES: [path: string, name: string][] = [
  ["/multisig", "admin-multisig"],
  ["/governance", "admin-governance"],
  ["/keys", "admin-keys"],
  ["/audit-log", "admin-audit-log"],
  ["/fee-config", "admin-fee-config"],
  ["/rbac", "admin-rbac"],
  ["/timelock", "admin-timelock"],
  ["/pause-controls", "admin-pause-controls"],
  ["/policy-versions", "admin-policy-versions"],
  ["/contracts", "admin-contracts"],
];

const ROUTES = [...CORE_ROUTES, ...ADMIN_ROUTES];
const THEMES: Theme[] = ["light", "dark"];

/** Impacts that fail the run. `moderate`/`minor` are reported, not enforced. */
const BLOCKING_IMPACTS = new Set(["serious", "critical"]);

/**
 * Violations we knowingly ship right now, each pinned to a tracking issue.
 *
 * Rules for adding an entry:
 *   1. `rule` must be the axe rule id (e.g. `color-contrast`).
 *   2. `selector` must be the narrowest CSS target that matches — never `html`.
 *   3. `issue` must link a real issue; the allowlist self-test at the bottom of
 *      this file fails the run if it does not.
 *
 * An entry with no issue is a silent regression, which is exactly what this
 * file exists to prevent. Currently empty: nothing is deferred.
 *
 * @example
 * { rule: "color-contrast", selector: "#legacy-badge", issue: "https://github.com/OphirPay/OphirPay/issues/000" }
 */
const DEFERRED_VIOLATIONS: { rule: string; selector: string; issue: string }[] = [];

interface Finding {
  rule: string;
  impact: string;
  selector: string;
  help: string;
}

function toFindings(violations: Result[]): Finding[] {
  return violations
    .filter((violation) => BLOCKING_IMPACTS.has(violation.impact ?? ""))
    .flatMap((violation) =>
      violation.nodes.map((node) => ({
        rule: violation.id,
        impact: violation.impact ?? "unknown",
        selector: (node.target as unknown[])
          .map((target) => (Array.isArray(target) ? target.join(" ") : String(target)))
          .join(" > "),
        help: violation.help,
      }))
    );
}

function isDeferred(finding: Finding): boolean {
  return DEFERRED_VIOLATIONS.some(
    (deferred) =>
      deferred.rule === finding.rule && finding.selector.includes(deferred.selector)
  );
}

function describeFindings(findings: Finding[]): string {
  if (findings.length === 0) return "no serious/critical violations";
  return findings
    .map((f) => `  • [${f.impact}] ${f.rule} → ${f.selector} (${f.help})`)
    .join("\n");
}

async function applyTheme(
  page: import("@playwright/test").Page,
  theme: Theme
): Promise<void> {
  // The root layout applies the saved preference before first paint (theme key
  // and data-theme attribute are kept in sync by src/hooks/useTheme.tsx), so
  // seed the same storage the app reads instead of only toggling the class.
  await page.addInitScript((value: string) => {
    try {
      window.localStorage.setItem("ophirpay-theme", value);
    } catch {
      /* storage can be unavailable; the class below still applies the theme */
    }
    document.documentElement.classList.toggle("dark", value === "dark");
    document.documentElement.setAttribute("data-theme", value);
  }, theme);
}

for (const theme of THEMES) {
  for (const [path, name] of ROUTES) {
    test(`${name} (${theme})`, async ({ page }) => {
      // Admin pages read on-chain state (Soroban simulations), so give them
      // room to settle before scanning.
      test.setTimeout(90_000);

      await applyTheme(page, theme);
      await page.goto(path);
      await expect(page.locator("main")).toBeVisible({ timeout: 15_000 });
      await page.waitForSelector("h1, h2", { timeout: 15_000 });

      const results = await new AxeBuilder({ page }).analyze();
      const blocking = toFindings(results.violations).filter(
        (finding) => !isDeferred(finding)
      );

      expect(
        blocking,
        `${name} (${theme}) has ${blocking.length} serious/critical accessibility violation(s):\n${describeFindings(blocking)}`
      ).toEqual([]);
    });
  }
}

test("the deferred-violation allowlist only contains tracked entries", async () => {
  const untracked = DEFERRED_VIOLATIONS.filter(
    (entry) => !/^https:\/\/github\.com\/[^/]+\/[^/]+\/issues\/\d+$/.test(entry.issue)
  );

  expect(
    untracked,
    `every allowlisted a11y violation must link a tracking issue:\n${JSON.stringify(untracked, null, 2)}`
  ).toEqual([]);

  // A selector of "html" (or similar) would swallow the whole page and turn
  // the allowlist into an off switch.
  const tooBroad = DEFERRED_VIOLATIONS.filter((entry) =>
    ["html", "body", "*"].includes(entry.selector.trim())
  );
  expect(tooBroad, "allowlist selectors must be narrow").toEqual([]);
});

test("the accessibility matrix runs on every configured browser project", () => {
  // The per-project matrix is what makes the scan cross-browser: every route ×
  // theme combination above executes once per project. This guards the project
  // list itself, so dropping mobile-chrome (or firefox) fails the run instead of
  // silently shrinking coverage.
  const projectNames = (playwrightConfig.projects ?? []).map((project) => project.name);

  expect(projectNames).toEqual(
    expect.arrayContaining(["chromium", "firefox", "mobile-chrome"])
  );
});
