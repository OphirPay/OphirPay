import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const KEY_ROUTES = [
  { path: "/", name: "Dashboard" },
  { path: "/send", name: "Send Payment" },
  { path: "/payments", name: "Payments List" },
  { path: "/batches", name: "Batch Payments" },
  { path: "/webhooks", name: "Webhooks" },
  { path: "/analytics", name: "Analytics" },
  { path: "/multisig", name: "Multisig Escrow" },
  { path: "/governance", name: "Governance & Timelock" },
];

test.describe("Axe Accessibility Audits (WCAG 2.1 AA)", () => {
  for (const route of KEY_ROUTES) {
    test(`scans ${route.name} (${route.path}) for accessibility violations`, async ({ page }) => {
      await page.goto(route.path, { waitUntil: "domcontentloaded" });
      await expect(page.locator("main")).toBeVisible({ timeout: 10000 });

      const accessibilityScanResults = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
        .disableRules(["color-contrast"])
        .analyze();

      const severeViolations = accessibilityScanResults.violations.filter(
        (v) => v.impact === "critical" || v.impact === "serious"
      );

      if (severeViolations.length > 0) {
        console.error(
          `Accessibility violations found on ${route.path}:\n`,
          JSON.stringify(
            severeViolations.map((v) => ({
              id: v.id,
              impact: v.impact,
              description: v.description,
              helpUrl: v.helpUrl,
              nodes: v.nodes.length,
            })),
            null,
            2
          )
        );
      }

      expect(severeViolations).toEqual([]);
    });

    test(`scans ${route.name} (${route.path}) with dark mode enabled`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: "dark" });
      await page.goto(route.path, { waitUntil: "domcontentloaded" });
      await expect(page.locator("main")).toBeVisible({ timeout: 10000 });

      const accessibilityScanResults = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
        .disableRules(["color-contrast"])
        .analyze();

      const severeViolations = accessibilityScanResults.violations.filter(
        (v) => v.impact === "critical" || v.impact === "serious"
      );

      expect(severeViolations).toEqual([]);
    });
  }
});
