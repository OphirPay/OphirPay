import { test, expect } from "@playwright/test";

/**
 * Every route sets a dynamic `document.title` via `usePageTitle` (mirroring
 * the `%s | OphirPay` metadata template). These checks assert the browser
 * tab title is non-default (not the layout's "OphirPay — Stellar Payment
 * Orchestration") on key routes.
 */
const ROUTE_TITLES: Record<string, RegExp> = {
  "/": /Treasury Dashboard \| OphirPay/,
  "/payments": /^Payments \| OphirPay$/,
  "/batches": /^Batch Payments \| OphirPay$/,
  "/batches/new": /^New Batch Payment \| OphirPay$/,
  "/send": /^Send Payment \| OphirPay$/,
  "/webhooks": /^Webhooks \| OphirPay$/,
  "/recurring": /^Recurring Payments \| OphirPay$/,
  "/requests": /^Payment Requests \| OphirPay$/,
  "/contracts": /^Smart Contracts \| OphirPay$/,
  "/analytics": /^Analytics \| OphirPay$/,
  "/events": /^Event Stream \| OphirPay$/,
  "/audit-log": /^Audit Log \| OphirPay$/,
  "/hooks": /^Notification Hooks \| OphirPay$/,
  "/rbac": /^Access Control \(RBAC\) \| OphirPay$/,
  "/fee-config": /^Fee Configuration \| OphirPay$/,
  "/refunds": /^Refunds \| OphirPay$/,
  "/timelock": /^Timelock \| OphirPay$/,
  "/policy-versions": /^Policy Versions \| OphirPay$/,
  "/multisig": /^Multisig \| OphirPay$/,
  "/governance": /^Governance \| OphirPay$/,
};

test.describe("Dynamic page titles", () => {
  for (const [path, titlePattern] of Object.entries(ROUTE_TITLES)) {
    test(`${path} sets a non-default page title`, async ({ page }) => {
      await page.goto(path);
      // Titles are applied client-side after hydration — allow time in production.
      await expect(page).toHaveTitle(titlePattern, { timeout: 15000 });
    });
  }
});
