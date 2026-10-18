// SPDX-License-Identifier: MIT
//
// Helpers and deterministic mocks for the Escrow Dispute and Resolution E2E suite (#1405).

import type { Page } from "@playwright/test";
import { expect } from "@playwright/test";
import {
  fakeFreighterInitScript,
  installMultisigMocks,
  createState,
  SIGNER_A,
  SIGNER_B,
} from "./stellar-mock";

export const BUYER_ADDRESS = SIGNER_A;
export const SELLER_ADDRESS = SIGNER_B;
export const ARBITER_ADDRESS = "GDQ5U7S7Q5A3DHYGB6V4F2NLLNZB6R5F6564WZ6H7M4GOC6F2W23K3LO";

export interface MockEscrowRecord {
  id: number;
  depositor: string;
  beneficiary: string;
  arbiter: string | null;
  amount: string; // stroops as string or number
  asset: string;
  deadline: number;
  released: boolean;
  claimed: boolean;
  metadata: string;
  disputed: boolean;
  dispute_reason?: string;
}

export interface EscrowDisputeState {
  escrows: MockEscrowRecord[];
  activeSigner: string;
  balances: Record<string, bigint>;
}

export function createEscrowDisputeState(): EscrowDisputeState {
  return {
    activeSigner: BUYER_ADDRESS,
    balances: {
      [BUYER_ADDRESS]: BigInt("100000000000"), // 10,000 XLM
      [SELLER_ADDRESS]: BigInt("50000000000"), // 5,000 XLM
      [ARBITER_ADDRESS]: BigInt("10000000000"), // 1,000 XLM
    },
    escrows: [
      {
        id: 1,
        depositor: BUYER_ADDRESS,
        beneficiary: SELLER_ADDRESS,
        arbiter: ARBITER_ADDRESS,
        amount: "5000000000", // 500 XLM
        asset: "native",
        deadline: Math.floor(Date.now() / 1000) + 86400 * 7, // 7 days future
        released: false,
        claimed: false,
        metadata: "E2E Milestone 1 Escrow",
        disputed: false,
        dispute_reason: "",
      },
    ],
  };
}

/**
 * Installs browser mocks for Stellar wallet, RPC, and API routes.
 */
export async function installEscrowDisputeMocks(
  page: Page,
  state: EscrowDisputeState,
): Promise<void> {
  const multisigState = createState({
    activeSigner: state.activeSigner,
    signers: [BUYER_ADDRESS, SELLER_ADDRESS, ARBITER_ADDRESS],
  });

  await page.addInitScript(fakeFreighterInitScript(state.activeSigner));
  await installMultisigMocks(page, multisigState);

  // Intercept the API routes for escrows so the frontend can read and reflect mutations
  await page.route("**/api/escrows*", async (route) => {
    const url = new URL(route.request().url());
    const method = route.request().method();

    if (method === "GET") {
      const idParam = url.searchParams.get("id");
      if (idParam) {
        const item = state.escrows.find((e) => e.id === Number(idParam));
        if (item) {
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({ success: true, data: item }),
          });
          return;
        }
        await route.fulfill({
          status: 404,
          contentType: "application/json",
          body: JSON.stringify({ success: false, error: "Escrow not found" }),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ success: true, data: state.escrows }),
      });
      return;
    }

    // POST /api/escrows
    if (method === "POST") {
      await route.fulfill({
        status: 202,
        contentType: "application/json",
        body: JSON.stringify({
          success: true,
          message: "Escrow operation processed",
        }),
      });
      return;
    }

    await route.continue();
  });

  // Mock contract-advanced query returning escrows via window.__ophir_escrows or page eval if needed
  await page.evaluate((records) => {
    (window as unknown as { __mockEscrows?: unknown }).__mockEscrows = records;
  }, state.escrows);
}

/**
 * Reconnects the fake wallet with another address (Buyer, Seller, or Arbiter).
 */
export async function switchWalletSigner(page: Page, address: string): Promise<void> {
  await page.evaluate((a) => {
    (window as unknown as {
      __setFreighterAddress: (addr: string) => void;
    }).__setFreighterAddress(a);
  }, address);

  const disconnectBtn = page.getByRole("button", { name: /Disconnect wallet/i });
  if (await disconnectBtn.count() > 0) {
    await disconnectBtn.click();
  }

  const connectBtn = page.getByRole("button", { name: "Connect Wallet", exact: true });
  if (await connectBtn.count() > 0) {
    await connectBtn.click();
    await page.getByRole("button", { name: /Freighter/i }).click();
    await expect(page.getByRole("button", { name: "Connect Wallet", exact: true })).toHaveCount(0, {
      timeout: 15000,
    });
  }
}

/**
 * Simulates a buyer raising a dispute on an active escrow.
 */
export async function raiseDisputeViaUI(
  page: Page,
  escrowId: number,
  reason: string,
): Promise<void> {
  const raiseBtn = page.locator('[data-testid="raise-dispute-btn"]');
  await expect(raiseBtn).toBeVisible({ timeout: 10000 });
  await raiseBtn.click();

  const input = page.locator('[data-testid="dispute-reason-input"]');
  await expect(input).toBeVisible();
  await input.fill(reason);

  const submitBtn = page.locator('[data-testid="confirm-dispute-btn"]');
  await submitBtn.click();
}

/**
 * Simulates the designated arbiter resolving the dispute.
 */
export async function resolveDisputeViaUI(
  page: Page,
  escrowId: number,
  refundBuyer: boolean,
): Promise<void> {
  const buttonTestId = refundBuyer
    ? "resolve-refund-buyer-btn"
    : "resolve-pay-beneficiary-btn";

  const resolveBtn = page.locator(`[data-testid="${buttonTestId}"]`);
  await expect(resolveBtn).toBeVisible({ timeout: 10000 });
  await resolveBtn.click();
}
