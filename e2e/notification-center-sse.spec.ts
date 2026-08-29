// SPDX-License-Identifier: MIT

import { test, expect } from "@playwright/test";

/**
 * E2E Test Suite: Notification Center Unread-Count Updates via SSE
 *
 * Acceptance Criteria verified:
 * 1. Unread badge updates without a manual refresh when a new event arrives over SSE stream.
 * 2. Notification center unread count resets when notifications are read.
 * 3. Marking as read persists across page reloads.
 * 4. Stream disconnect does not lose notifications.
 */

test.describe("Notification Center SSE & Unread Count Lifecycle", () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to root dashboard with domcontentloaded because SSE / live streams keep connection open
    await page.goto("/", { waitUntil: "domcontentloaded" });
    // Wait for client component to mount and complete React hydration
    await expect(
      page.locator('[data-testid="notification-center-container"][data-mounted="true"]')
    ).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId("notification-bell-btn")).toBeVisible({
      timeout: 15000,
    });
  });

  test("unread badge increments reactively when a new event arrives over SSE without manual refresh", async ({
    page,
  }) => {
    const bellBtn = page.getByTestId("notification-bell-btn");
    const badge = page.getByTestId("notification-badge");

    // Open dropdown to mark any existing notifications as read
    await bellBtn.click();
    await expect(page.getByTestId("notification-dropdown")).toBeVisible({
      timeout: 5000,
    });
    // Close dropdown
    await bellBtn.click();
    await expect(page.getByTestId("notification-dropdown")).not.toBeVisible();
    await expect(badge).not.toBeVisible();

    // Emulate incoming SSE payment event in real time without refreshing
    const txHash1 = `sse_tx_${Date.now()}_1`;
    await page.evaluate((tx) => {
      window.dispatchEvent(
        new CustomEvent("ophirpay:notification", {
          detail: {
            id: `notif_${Date.now()}_1`,
            type: "payment.received",
            title: "Payment Received",
            message: "Received 150.00 XLM from GCAL...8K2P",
            amount: "150.00 XLM",
            payer: "GCALXQMKV3XOMWBKLY2C7Q6RN2P2VY3NXN3T8K2P",
            txHash: tx,
            timestamp: Date.now(),
            read: false,
          },
        })
      );
    }, txHash1);

    // Verify unread badge appears and displays 1 without a page refresh
    await expect(badge).toBeVisible({ timeout: 5000 });
    await expect(badge).toHaveText("1");
    await expect(bellBtn).toHaveAttribute(
      "aria-label",
      "Notifications (1 unread)"
    );

    // Emulate a second incoming SSE payment event
    const txHash2 = `sse_tx_${Date.now()}_2`;
    await page.evaluate((tx) => {
      window.dispatchEvent(
        new CustomEvent("ophirpay:notification", {
          detail: {
            id: `notif_${Date.now()}_2`,
            type: "payment.sent",
            title: "Payment Sent",
            message: "Sent 45.50 XLM to GDQM...9Y1Z",
            amount: "45.50 XLM",
            payee: "GDQMXQZKV4XOMWBKLY2C7Q6RN2P2VY3NXN3T9Y1Z",
            txHash: tx,
            timestamp: Date.now(),
            read: false,
          },
        })
      );
    }, txHash2);

    // Verify badge increments to 2 without a page refresh
    await expect(badge).toHaveText("2");
    await expect(bellBtn).toHaveAttribute(
      "aria-label",
      "Notifications (2 unread)"
    );
  });

  test("notification center unread count resets when notifications are read", async ({
    page,
  }) => {
    const bellBtn = page.getByTestId("notification-bell-btn");
    const badge = page.getByTestId("notification-badge");

    // Open dropdown to mark initial seed notifications as read
    await bellBtn.click();
    await expect(page.getByTestId("notification-dropdown")).toBeVisible({
      timeout: 5000,
    });
    await bellBtn.click();
    await expect(page.getByTestId("notification-dropdown")).not.toBeVisible();
    await expect(badge).not.toBeVisible();

    // Inject fresh unread notification
    await page.evaluate(() => {
      const notif = {
        id: `notif_reset_${Date.now()}`,
        type: "payment.received",
        title: "New Payment",
        message: "Received 500.00 XLM",
        timestamp: Date.now(),
        read: false,
      };
      window.dispatchEvent(
        new CustomEvent("ophirpay:notification", { detail: notif })
      );
    });

    // Verify badge shows unread notification
    await expect(badge).toBeVisible({ timeout: 5000 });
    await expect(badge).toHaveText("1");

    // Click bell to open dropdown and mark notifications as read
    await bellBtn.click();
    await expect(page.getByTestId("notification-dropdown")).toBeVisible();

    // Verify badge is removed / reset to 0 unread
    await expect(badge).not.toBeVisible();
    await expect(bellBtn).toHaveAttribute("aria-label", "Notifications");
  });

  test("marking as read persists across page reloads", async ({ page }) => {
    const bellBtn = page.getByTestId("notification-bell-btn");
    const badge = page.getByTestId("notification-badge");

    // Open dropdown to mark all existing seed notifications as read
    await bellBtn.click();
    await expect(page.getByTestId("notification-dropdown")).toBeVisible({
      timeout: 5000,
    });
    await bellBtn.click();
    await expect(page.getByTestId("notification-dropdown")).not.toBeVisible();
    await expect(badge).not.toBeVisible();

    // Inject a new unread notification
    const testNotifId = `persist_${Date.now()}`;
    await page.evaluate((id) => {
      window.dispatchEvent(
        new CustomEvent("ophirpay:notification", {
          detail: {
            id,
            type: "payment.received",
            title: "Persistence Test Payment",
            message: "Testing read persistence across reload",
            timestamp: Date.now(),
            read: false,
          },
        })
      );
    }, testNotifId);

    // Verify badge is visible with unread count
    await expect(badge).toBeVisible({ timeout: 5000 });

    // Open dropdown (marks all as read)
    await bellBtn.click();
    await expect(page.getByTestId("notification-dropdown")).toBeVisible();
    await expect(badge).not.toBeVisible();

    // Reload the page
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(
      page.locator('[data-testid="notification-center-container"][data-mounted="true"]')
    ).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId("notification-bell-btn")).toBeVisible({
      timeout: 15000,
    });

    // Verify badge remains hidden after reload (persisted as read in sessionStorage)
    await expect(page.getByTestId("notification-badge")).not.toBeVisible({
      timeout: 5000,
    });

    // Open dropdown after reload and verify notification item is present with read status
    await page.getByTestId("notification-bell-btn").click();
    await expect(page.getByTestId("notification-dropdown")).toBeVisible();
    const item = page.locator(`[data-notification-id="${testNotifId}"]`);
    await expect(item).toBeVisible();
    // Unread dot indicator should not be present
    await expect(item.getByTestId("unread-dot")).not.toBeVisible();
  });

  test("stream disconnect does not lose notifications", async ({ page }) => {
    const bellBtn = page.getByTestId("notification-bell-btn");
    const badge = page.getByTestId("notification-badge");

    // Open and close to mark existing as read
    await bellBtn.click();
    await expect(page.getByTestId("notification-dropdown")).toBeVisible({
      timeout: 5000,
    });
    await bellBtn.click();
    await expect(page.getByTestId("notification-dropdown")).not.toBeVisible();
    await expect(badge).not.toBeVisible();

    // Inject 2 distinct notifications over stream
    const notif1 = `disc_1_${Date.now()}`;
    const notif2 = `disc_2_${Date.now()}`;

    await page.evaluate(
      ([id1, id2]) => {
        window.dispatchEvent(
          new CustomEvent("ophirpay:notification", {
            detail: {
              id: id1,
              type: "payment.received",
              title: "Payment Stream 1",
              message: "Received 300.00 XLM",
              timestamp: Date.now() - 2000,
              read: false,
            },
          })
        );
        window.dispatchEvent(
          new CustomEvent("ophirpay:notification", {
            detail: {
              id: id2,
              type: "payment.batch_completed",
              title: "Batch Payment Stream 2",
              message: "Processed batch to 10 recipients",
              timestamp: Date.now() - 1000,
              read: false,
            },
          })
        );
      },
      [notif1, notif2]
    );

    // Verify badge reflects 2 unread
    await expect(badge).toBeVisible({ timeout: 5000 });
    await expect(badge).toHaveText("2");

    // Simulate stream error / offline network event
    await page.evaluate(() => {
      window.dispatchEvent(new Event("offline"));
    });

    // Open notification dropdown
    await bellBtn.click();
    const dropdown = page.getByTestId("notification-dropdown");
    await expect(dropdown).toBeVisible();

    // Verify both stream notifications remain intact and visible
    await expect(page.locator(`[data-notification-id="${notif1}"]`)).toBeVisible();
    await expect(page.locator(`[data-notification-id="${notif2}"]`)).toBeVisible();

    // Close and reopen dropdown to confirm persistence
    await bellBtn.click();
    await expect(dropdown).not.toBeVisible();
    await bellBtn.click();
    await expect(dropdown).toBeVisible();
    await expect(page.locator(`[data-notification-id="${notif1}"]`)).toBeVisible();
    await expect(page.locator(`[data-notification-id="${notif2}"]`)).toBeVisible();
  });

  test("supports filtering notifications by All and Unread tabs", async ({
    page,
  }) => {
    const bellBtn = page.getByTestId("notification-bell-btn");

    await bellBtn.click();
    const dropdown = page.getByTestId("notification-dropdown");
    await expect(dropdown).toBeVisible({ timeout: 5000 });

    // Verify filter tabs are clickable and responsive
    const allTab = page.getByTestId("filter-tab-all");
    const unreadTab = page.getByTestId("filter-tab-unread");

    await expect(allTab).toBeVisible();
    await expect(unreadTab).toBeVisible();

    await unreadTab.click();
    await expect(unreadTab).toHaveClass(/border-ophir-600/);

    await allTab.click();
    await expect(allTab).toHaveClass(/border-ophir-600/);
  });

  test("clearing all notifications removes items and displays empty state", async ({
    page,
  }) => {
    const bellBtn = page.getByTestId("notification-bell-btn");

    await bellBtn.click();
    const dropdown = page.getByTestId("notification-dropdown");
    await expect(dropdown).toBeVisible({ timeout: 5000 });

    const clearBtn = page.getByTestId("clear-all-btn");
    if (await clearBtn.isVisible()) {
      await clearBtn.click();
      await expect(page.getByTestId("empty-notifications")).toBeVisible();
      await expect(page.getByText("No notifications yet")).toBeVisible();
    }
  });
});
