// SPDX-License-Identifier: MIT

import { test, expect } from "@playwright/test";
import {
  SIGNER_A,
  SIGNER_B,
  createState,
  installMultisigMocks,
  fakeFreighterInitScript,
  type MultisigState,
} from "./helpers/stellar-mock";

const MOBILE_VIEWPORT = { width: 390, height: 844 };
const DESKTOP_VIEWPORT = { width: 1280, height: 800 };

test.describe("Multisig and Governance - Mobile Usability (390px Viewport)", () => {
  test.use({ viewport: MOBILE_VIEWPORT });

  test("multisig page has zero horizontal overflow, reachable approve button with proper touch target, and approves successfully", async ({
    page,
  }) => {
    const state: MultisigState = createState();
    await page.addInitScript(fakeFreighterInitScript(SIGNER_A));
    await installMultisigMocks(page, state);

    await page.goto("/multisig");

    // Page header loads and wallet auto-connects
    await expect(page.locator("main h1")).toContainText("Multisig", {
      timeout: 15000,
    });

    // 1. Check zero horizontal overflow on empty/initial mobile view
    const initialScrollWidth = await page.evaluate(
      () => document.documentElement.scrollWidth
    );
    const initialClientWidth = await page.evaluate(
      () => document.documentElement.clientWidth
    );
    expect(initialScrollWidth).toBeLessThanOrEqual(initialClientWidth + 1);

    // 2. Propose a payment
    await page.getByRole("button", { name: "+ Propose Payment" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByPlaceholder("GABC...").fill(SIGNER_B);
    await dialog.locator('input[type="number"]').fill("150");
    await dialog.getByRole("button", { name: "Propose Payment" }).click();

    await expect(
      page.getByText("Payment proposed for multisig approval")
    ).toBeVisible({ timeout: 20000 });

    // Payment proposal appears in the list
    await expect(page.getByText("150 XLM", { exact: true })).toBeVisible();
    await expect(page.getByText("0/2", { exact: true })).toBeVisible();

    // 3. Verify zero horizontal overflow with the proposal row/card rendered
    const scrollWidthWithCard = await page.evaluate(
      () => document.documentElement.scrollWidth
    );
    const clientWidthWithCard = await page.evaluate(
      () => document.documentElement.clientWidth
    );
    expect(scrollWidthWithCard).toBeLessThanOrEqual(clientWidthWithCard + 1);

    // 4. Verify the approve button is visible, reachable, and has >= 44px touch target
    const approveBtn = page.getByRole("button", { name: "✓ Approve" });
    await expect(approveBtn).toBeVisible();

    const approveBox = await approveBtn.boundingBox();
    expect(approveBox).not.toBeNull();
    expect(approveBox!.height).toBeGreaterThanOrEqual(44);
    expect(approveBox!.x).toBeGreaterThanOrEqual(0);
    expect(approveBox!.x + approveBox!.width).toBeLessThanOrEqual(
      MOBILE_VIEWPORT.width + 1
    );

    // 5. Click the approve button and assert approval transitions on-chain
    await approveBtn.click();
    await expect(page.getByText("Approval submitted on-chain")).toBeVisible({
      timeout: 20000,
    });
    await expect(page.getByText("1/2", { exact: true })).toBeVisible();
  });

  test("governance page has zero horizontal overflow, reachable vote buttons with proper touch targets, and votes successfully", async ({
    page,
  }) => {
    const state: MultisigState = createState();
    await page.addInitScript(fakeFreighterInitScript(SIGNER_A));
    await installMultisigMocks(page, state);

    // Mock governance proposals API route with an active open proposal
    await page.route("**/api/governance/proposals", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          data: {
            items: [
              {
                id: 1,
                title: "Upgrade contract to v3",
                description:
                  "This proposal upgrades the OphirPay core contract with fee optimizations and security patches.",
                action_type: "upgrade",
                yes_votes: 12,
                no_votes: 3,
                voting_ends_at: Math.floor(Date.now() / 1000) + 86400,
                executed: false,
                proposer: SIGNER_A,
              },
            ],
            total: 1,
            truncated: false,
          },
        }),
      });
    });

    // Mock governance vote mutation route
    await page.route("**/api/governance/vote", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          success: true,
          data: { voted: true },
        }),
      });
    });

    await page.goto("/governance");

    // Page header loads
    await expect(page.locator("main h1")).toContainText("Governance", {
      timeout: 15000,
    });

    // Verify proposal title is rendered
    await expect(page.getByText("Upgrade contract to v3")).toBeVisible({
      timeout: 15000,
    });

    // 1. Verify zero horizontal overflow on mobile viewport with proposal cards
    const scrollWidth = await page.evaluate(
      () => document.documentElement.scrollWidth
    );
    const clientWidth = await page.evaluate(
      () => document.documentElement.clientWidth
    );
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1);

    // 2. Verify vote buttons are visible and have proper touch targets (>= 44px)
    const yesBtn = page.getByRole("button", { name: "👍 Yes" });
    const noBtn = page.getByRole("button", { name: "👎 No" });
    await expect(yesBtn).toBeVisible();
    await expect(noBtn).toBeVisible();

    const yesBox = await yesBtn.boundingBox();
    const noBox = await noBtn.boundingBox();
    expect(yesBox).not.toBeNull();
    expect(noBox).not.toBeNull();

    expect(yesBox!.height).toBeGreaterThanOrEqual(44);
    expect(noBox!.height).toBeGreaterThanOrEqual(44);

    // Verify buttons fit within mobile viewport width without overflow
    expect(yesBox!.x).toBeGreaterThanOrEqual(0);
    expect(noBox!.x).toBeGreaterThanOrEqual(0);
    expect(yesBox!.x + yesBox!.width).toBeLessThanOrEqual(
      MOBILE_VIEWPORT.width + 1
    );
    expect(noBox!.x + noBox!.width).toBeLessThanOrEqual(
      MOBILE_VIEWPORT.width + 1
    );

    // 3. Cast a vote on mobile
    await yesBtn.click();
    await expect(page.getByText("Voted YES on-chain")).toBeVisible({
      timeout: 15000,
    });
  });
});

test.describe("Multisig and Governance - Desktop Table Layout Preservation", () => {
  test.use({ viewport: DESKTOP_VIEWPORT });

  test("desktop layout renders table headers for multisig and governance", async ({
    page,
  }) => {
    const state: MultisigState = createState();
    await page.addInitScript(fakeFreighterInitScript(SIGNER_A));
    await installMultisigMocks(page, state);

    // ── Multisig Desktop Table ─────────────────────────────────
    await page.goto("/multisig");
    await expect(page.locator("main h1")).toContainText("Multisig", {
      timeout: 15000,
    });

    // Propose a payment to populate the table
    await page.getByRole("button", { name: "+ Propose Payment" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByPlaceholder("GABC...").fill(SIGNER_B);
    await dialog.locator('input[type="number"]').fill("250");
    await dialog.getByRole("button", { name: "Propose Payment" }).click();

    await expect(
      page.getByText("Payment proposed for multisig approval")
    ).toBeVisible({ timeout: 20000 });

    // Assert desktop table header elements are visible on desktop
    await expect(page.getByText("ID & Status")).toBeVisible();
    await expect(page.getByText("Recipient", { exact: true })).toBeVisible();
    await expect(page.getByText("Approval Progress")).toBeVisible();

    // ── Governance Desktop Table ───────────────────────────────
    await page.route("**/api/governance/proposals", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          data: {
            items: [
              {
                id: 1,
                title: "Upgrade contract to v3",
                description: "Proposal to upgrade core contracts.",
                action_type: "upgrade",
                yes_votes: 5,
                no_votes: 1,
                voting_ends_at: Math.floor(Date.now() / 1000) + 86400,
                executed: false,
                proposer: SIGNER_A,
              },
            ],
            total: 1,
            truncated: false,
          },
        }),
      });
    });

    await page.goto("/governance");
    await expect(page.locator("main h1")).toContainText("Governance", {
      timeout: 15000,
    });

    // Assert desktop table header elements are visible on desktop
    await expect(page.getByText("Proposal", { exact: true })).toBeVisible();
    await expect(page.getByText("Action & Proposer")).toBeVisible();
    await expect(page.getByText("Voting Progress")).toBeVisible();
  });
});
