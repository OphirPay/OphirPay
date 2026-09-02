// SPDX-License-Identifier: MIT

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { usePageTitle } from "@/hooks/usePageTitle";
import { PAGE_TITLES, PAGE_DESCRIPTIONS } from "@/lib/page-titles";

// Every route in the app must have a dedicated (non-default) title so the
// browser tab always reflects the current resource. Keep this list in sync
// with src/app/*/page.tsx.
const EXPECTED_ROUTE_TITLES: Record<string, string> = {
  "/": PAGE_TITLES.HOME,
  "/send": PAGE_TITLES.SEND,
  "/payments": PAGE_TITLES.PAYMENTS,
  "/batches": PAGE_TITLES.BATCHES,
  "/batches/new": PAGE_TITLES.NEW_BATCH,
  "/recurring": PAGE_TITLES.RECURRING,
  "/requests": PAGE_TITLES.REQUESTS,
  "/webhooks": PAGE_TITLES.WEBHOOKS,
  "/contracts": PAGE_TITLES.CONTRACTS,
  "/analytics": PAGE_TITLES.ANALYTICS,
  "/events": PAGE_TITLES.EVENTS,
  "/audit-log": PAGE_TITLES.AUDIT_LOG,
  "/hooks": PAGE_TITLES.HOOKS,
  "/rbac": PAGE_TITLES.RBAC,
  "/fee-config": PAGE_TITLES.FEE_CONFIG,
  "/refunds": PAGE_TITLES.REFUNDS,
  "/timelock": PAGE_TITLES.TIMELOCK,
  "/policy-versions": PAGE_TITLES.POLICY_VERSIONS,
  "/multisig": PAGE_TITLES.MULTISIG,
  "/governance": PAGE_TITLES.GOVERNANCE,
};

describe("PAGE_TITLES", () => {
  it("defines a non-default title for every app route", () => {
    for (const [route, title] of Object.entries(EXPECTED_ROUTE_TITLES)) {
      expect(title, `route ${route} must define a title`).toBeTruthy();
      // Non-default: must not fall back to the layout's default title.
      expect(title).not.toBe("OphirPay — Stellar Payment Orchestration");
    }
  });

  it("provides a description for every titled route", () => {
    for (const title of Object.values(PAGE_TITLES)) {
      const key = Object.keys(PAGE_TITLES).find(
        (k) => PAGE_TITLES[k as keyof typeof PAGE_TITLES] === title
      ) as keyof typeof PAGE_DESCRIPTIONS;
      expect(PAGE_DESCRIPTIONS[key], `missing description for ${title}`).toBeTruthy();
    }
  });
});

describe("usePageTitle", () => {
  const originalTitle = document.title;

  beforeEach(() => {
    document.title = originalTitle;
  });

  afterEach(() => {
    document.title = originalTitle;
  });

  it("sets document.title to `${title} | OphirPay`", () => {
    renderHook(() => usePageTitle(PAGE_TITLES.PAYMENTS));
    expect(document.title).toBe("Payments | OphirPay");
  });

  it("applies the shared template suffix for every route title", () => {
    for (const title of Object.values(PAGE_TITLES)) {
      renderHook(() => usePageTitle(title));
      expect(document.title).toBe(`${title} | OphirPay`);
    }
  });

  it("does not double-suffix titles that already mention OphirPay", () => {
    renderHook(() => usePageTitle("OphirPay — Stellar Payment Orchestration"));
    expect(document.title).toBe("OphirPay — Stellar Payment Orchestration");
  });

  it("leaves the title untouched when given null/undefined", () => {
    document.title = "Keep Me";
    renderHook(() => usePageTitle(null));
    expect(document.title).toBe("Keep Me");
    renderHook(() => usePageTitle(undefined));
    expect(document.title).toBe("Keep Me");
  });

  it("updates the title when the value changes", () => {
    const initialProps: { title: string } = { title: PAGE_TITLES.BATCHES };
    const { rerender } = renderHook(({ title }: { title: string }) => usePageTitle(title), {
      initialProps,
    });
    expect(document.title).toBe("Batch Payments | OphirPay");
    rerender({ title: PAGE_TITLES.PAYMENTS });
    expect(document.title).toBe("Payments | OphirPay");
  });

  it("restores the neutral default title when the route unmounts (e.g. error boundary)", () => {
    // Simulate arriving from another route — the previous title is a stale
    // route title, not the default.
    document.title = "Payments | OphirPay";
    const { unmount } = renderHook(() => usePageTitle(PAGE_TITLES.BATCHES));
    expect(document.title).toBe("Batch Payments | OphirPay");
    // Unmounting simulates an error.tsx / global-error.tsx takeover. Neither
    // error boundary supplies a title, so the hook must fall back to the
    // neutral default — never the preceding route's title.
    unmount();
    expect(document.title).toBe("OphirPay — Stellar Payment Orchestration");
  });
});
