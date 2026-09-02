// SPDX-License-Identifier: MIT
//
// E2E: Notification center unread-count updates via SSE (issue #390).
//
// Acceptance criteria covered:
//   1. The unread badge increments when a new payment event arrives over the
//      SSE stream, without any manual page refresh.
//   2. Marking notifications as read persists across reloads (sessionStorage).
//   3. A stream disconnect does not lose notifications — the list survives and
//      live updates resume after the browser reconnects.
//
// The real GET /api/events endpoint is replaced with a controllable SSE mock
// (e2e/helpers/sse-mock.ts) so the tests are deterministic in CI and locally.
// The notification center hook, React state, and DOM all run unmodified.

import { test, expect } from "@playwright/test";
import { installSseMock } from "./helpers/sse-mock";

const NOTIF_STORAGE_KEY = "ophirpay-notifications";

/**
 * Seed the notification center with an empty list before the first page load
 * (its default seed data would otherwise show an unread badge of 2). The
 * marker keeps reloads from wiping state mid-test so "persists across
 * reloads" can be asserted on the same storage.
 */
function seedEmptyNotifications() {
  return (args: { key: string; marker: string }) => {
    if (!sessionStorage.getItem(args.marker)) {
      sessionStorage.setItem(args.key, "[]");
      sessionStorage.setItem(args.marker, "1");
    }
    // Count page loads per test so "no manual refresh" can be asserted.
    (window as unknown as { __ophirpayLoadCount: number }).__ophirpayLoadCount =
      ((window as unknown as { __ophirpayLoadCount?: number }).__ophirpayLoadCount ?? 0) + 1;
  };
}

function paymentEvent(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    type: "payment.received",
    title: `E2E Payment ${id}`,
    message: `Received 25.00 XLM for ${id}`,
    amount: "25.00 XLM",
    payer: "GCALXQMKV3XOMWBKLY2C7Q6RN2P2VY3NXN3T8K2P",
    payee: "GBZX4364PEPQTDICMIQDZ56K4T75QGKCRFHSVJFVODVFBRR6XOQNFB2C",
    ...overrides,
  };
}

test.describe("Notification center: unread count via SSE", () => {
  test("badge increments live when a payment event arrives over SSE (no refresh)", async ({
    page,
  }) => {
    const sse = installSseMock(page);
    await page.addInitScript(seedEmptyNotifications(), {
      key: NOTIF_STORAGE_KEY,
      marker: "ophirpay-e2e-notifications-initialized",
    });

    await page.goto("/");
    const bell = page.getByTestId("notification-bell-btn");
    await expect(bell).toBeVisible({ timeout: 15000 });

    // Seeded empty → no unread badge before the event arrives.
    await expect(page.getByTestId("notification-badge")).toHaveCount(0);

    // Wait for the page's EventSource to open before emitting — the mock
    // only delivers to a connected client, so emitting too early would drop
    // the frame.
    await sse.waitForNextClient();

    // A new payment event arrives over the SSE stream.
    sse.emit("payment:created", paymentEvent("e2e-sse-1", { txHash: "abc123".repeat(8) }));

    // The unread badge appears and shows 1 — React state, no reload.
    const badge = page.getByTestId("notification-badge");
    await expect(badge).toHaveText("1", { timeout: 5000 });

    // Prove no manual refresh happened: this is still the first page load.
    const loadCount = await page.evaluate(
      () => (window as unknown as { __ophirpayLoadCount: number }).__ophirpayLoadCount
    );
    expect(loadCount).toBe(1);

    // The connection is reported as live inside the dropdown.
    await bell.click();
    await expect(page.getByTestId("notification-dropdown")).toBeVisible();
    await expect(page.getByTestId("sse-status")).toHaveText(/Live/);
    await expect(page.getByText("E2E Payment e2e-sse-1")).toBeVisible();
  });

  test("marking as read persists across reloads", async ({ page }) => {
    const sse = installSseMock(page);
    await page.addInitScript(seedEmptyNotifications(), {
      key: NOTIF_STORAGE_KEY,
      marker: "ophirpay-e2e-notifications-initialized",
    });

    await page.goto("/");
    const bell = page.getByTestId("notification-bell-btn");
    await expect(bell).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId("notification-badge")).toHaveCount(0);

    // Wait for the page's EventSource to open before emitting (see test 1).
    await sse.waitForNextClient();

    sse.emit("payment:created", paymentEvent("e2e-sse-2", { txHash: "def456".repeat(8) }));
    const badge = page.getByTestId("notification-badge");
    await expect(badge).toHaveText("1", { timeout: 5000 });

    // Open the dropdown: opening marks every notification as read, which
    // clears the badge immediately (no refresh involved).
    await bell.click();
    await expect(page.getByTestId("notification-dropdown")).toBeVisible();
    await expect(page.getByTestId("notification-badge")).toHaveCount(0);

    // Reload — sessionStorage keeps the list AND the read flag.
    await page.reload();
    await expect(bell).toBeVisible({ timeout: 15000 });

    // Still no unread badge after the reload...
    await expect(page.getByTestId("notification-badge")).toHaveCount(0);

    // ...and the notification itself is still listed, now marked read.
    await bell.click();
    await expect(page.getByTestId("notification-dropdown")).toBeVisible();
    await expect(page.getByTestId("notification-item")).toHaveCount(1);
    await expect(page.getByTestId("unread-dot")).toHaveCount(0);
    await expect(page.getByText("E2E Payment e2e-sse-2")).toBeVisible();
  });

  test("stream disconnect does not lose notifications and updates resume", async ({
    page,
  }) => {
    const sse = installSseMock(page);
    await page.addInitScript(seedEmptyNotifications(), {
      key: NOTIF_STORAGE_KEY,
      marker: "ophirpay-e2e-notifications-initialized",
    });

    await page.goto("/");
    const bell = page.getByTestId("notification-bell-btn");
    await expect(bell).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId("notification-badge")).toHaveCount(0);

    // Wait for the page's EventSource to open before emitting (see test 1).
    await sse.waitForNextClient();

    sse.emit("payment:created", paymentEvent("e2e-sse-3", { txHash: "111222".repeat(8) }));
    const badge = page.getByTestId("notification-badge");
    await expect(badge).toHaveText("1", { timeout: 5000 });

    // Drop the underlying stream — the browser EventSource reconnects.
    const clientsBefore = sse.clientCount();
    sse.drop();
    await sse.waitForNextClient(clientsBefore);

    // Notifications survive the disconnect: the badge is unchanged with no
    // reload and no user interaction.
    await expect(badge).toHaveText("1", { timeout: 5000 });

    // After the browser reconnects, live updates keep flowing.
    sse.emit("payment:created", paymentEvent("e2e-sse-4", { txHash: "333444".repeat(8) }));
    await expect(badge).toHaveText("2", { timeout: 8000 });

    // Nothing was lost during the disconnect: both notifications are listed.
    await bell.click();
    await expect(page.getByTestId("notification-dropdown")).toBeVisible();
    await expect(page.getByTestId("notification-item")).toHaveCount(2);
    await expect(page.getByText("E2E Payment e2e-sse-3")).toBeVisible();
    await expect(page.getByText("E2E Payment e2e-sse-4")).toBeVisible();
  });
});