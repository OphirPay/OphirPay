import { test, expect } from "@playwright/test";

const MOBILE_VIEWPORT = { width: 412, height: 915 };

test.describe("Multisig and governance mobile layouts", () => {
  test.use({ viewport: MOBILE_VIEWPORT });

  test("multisig approval controls remain reachable without horizontal overflow", async ({
    page,
  }) => {
    await page.route("**/api/multisig", (route) =>
      route.fulfill({
        json: {
          data: {
            threshold: 2,
            signers: [
              "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
              "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
              "GCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC",
            ],
            enabled: true,
          },
        },
      })
    );
    await page.route("**/api/multisig/requests", (route) =>
      route.fulfill({
        json: {
          data: {
            requests: [
              {
                id: 42,
                proposer: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
                payee: "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
                amount: "250",
                approvals_count: 1,
                threshold_met: false,
                executed: false,
              },
            ],
          },
        },
      })
    );

    await page.goto("/multisig");
    await expect(page.getByText("2/3 threshold")).toBeVisible();
    const approve = page.getByRole("button", { name: /approve/i });
    await expect(approve).toBeVisible();
    expect((await approve.boundingBox())?.height).toBeGreaterThanOrEqual(44);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth
      )
    ).toBeLessThanOrEqual(1);
  });

  test("governance voting controls remain reachable for long proposal content", async ({
    page,
  }) => {
    const longTitle = "proposal".repeat(24);
    await page.route("**/api/governance/proposals", (route) =>
      route.fulfill({
        json: {
          data: {
            items: [
              {
                id: 7,
                title: longTitle,
                description: "details".repeat(40),
                action_type: "upgrade",
                yes_votes: 4,
                no_votes: 2,
                voting_ends_at: Math.floor(Date.now() / 1000) + 3600,
                executed: false,
                proposer: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
              },
            ],
            total: 1,
            truncated: false,
          },
        },
      })
    );

    await page.goto("/governance");
    await expect(page.getByRole("link", { name: longTitle })).toBeVisible();
    const yesVote = page.getByRole("button", { name: /yes/i });
    await expect(yesVote).toBeVisible();
    expect((await yesVote.boundingBox())?.height).toBeGreaterThanOrEqual(44);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth
      )
    ).toBeLessThanOrEqual(1);
  });
});
