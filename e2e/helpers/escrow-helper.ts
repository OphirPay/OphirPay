// SPDX-License-Identifier: MIT
import type { Page } from "@playwright/test";

export interface MockEscrow {
  id: string;
  buyer: string;
  seller: string;
  arbitrator: string;
  amount: number;
  asset: string;
  state: "funded" | "disputed" | "resolved_released" | "resolved_refunded" | "resolved_split";
  disputeReason?: string;
  resolvedAt?: string;
}

export function createMockEscrow(overrides: Partial<MockEscrow> = {}): MockEscrow {
  return {
    id: "escrow_test_101",
    buyer: "GBUYERAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    seller: "GSELLERAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    arbitrator: "GARBITERAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    amount: 500,
    asset: "XLM",
    state: "funded",
    ...overrides,
  };
}

export async function mockEscrowApi(page: Page, escrow: MockEscrow) {
  await page.route(`**/api/escrow/${escrow.id}*`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        data: escrow,
      }),
    });
  });

  await page.route(`**/api/escrow/${escrow.id}/dispute*`, async (route) => {
    escrow.state = "disputed";
    escrow.disputeReason = "Deliverable failed specification";
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        data: escrow,
      }),
    });
  });

  await page.route(`**/api/escrow/${escrow.id}/resolve*`, async (route) => {
    escrow.state = "resolved_refunded";
    escrow.resolvedAt = new Date().toISOString();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        data: escrow,
      }),
    });
  });
}
