import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const KEY_PAGES = [
  { name: "Dashboard", path: "/" },
  { name: "Send", path: "/send" },
  { name: "Batches", path: "/batches" },
  { name: "Payments", path: "/payments" },
  { name: "Webhooks", path: "/webhooks" },
];

const THEMES = ["light", "dark"] as const;

test.describe("Axe Core Accessibility Scans", () => {
  for (const pageInfo of KEY_PAGES) {
    for (const theme of THEMES) {
      test(`${pageInfo.name} Page - ${theme} mode should have no critical or serious a11y violations`, async ({ page }) => {
        // Set color scheme preference
        await page.emulateMedia({ colorScheme: theme });

        // Navigate to the target page
        await page.goto(pageInfo.path, { waitUntil: "domcontentloaded" });

        // Set dark/light class on document if applicable
        await page.evaluate((currentTheme) => {
          if (currentTheme === "dark") {
            document.documentElement.classList.add("dark");
          } else {
            document.documentElement.classList.remove("dark");
          }
        }, theme);

        // Run Axe accessibility scan
        const accessibilityScanResults = await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
          .analyze();

        // Filter for critical and serious violations
        const severeViolations = accessibilityScanResults.violations.filter(
          (violation) => violation.impact === "critical" || violation.impact === "serious"
        );

        if (severeViolations.length > 0) {
          const violationSummary = severeViolations
            .map(
              (v) =>
                `[${v.impact?.toUpperCase()}] ${v.id}: ${v.help} (${v.helpUrl})\n  Nodes: ${v.nodes
                  .map((n) => n.html)
                  .join("\n         ")}`
            )
            .join("\n\n");

          console.error(
            `\nAccessibility violations found on ${pageInfo.name} (${theme} mode):\n${violationSummary}\n`
          );
        }

        expect(severeViolations).toEqual([]);
      });
    }
  }
});
