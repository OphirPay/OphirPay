// SPDX-License-Identifier: MIT

import { test, expect } from "@playwright/test";

const BASE_URL = process.env.E2E_BASE_URL || "http://localhost:3000";

const TEST_ACCOUNT = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";
const USDC_ISSUER = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";

test.describe("Trustline Flow & Multi-Asset Receiving", () => {
  test("receive page loads with connect prompt when disconnected", async ({ page }) => {
    await page.goto("/receive");
    await expect(page.locator("h1")).toContainText("Receive");

    // When no wallet is connected, the connect wallet prompt is visible
    const connectHeading = page.getByRole("heading", {
      name: /connect your wallet to receive/i,
    });
    const connectButton = page.getByRole("button", {
      name: /connect wallet/i,
    });
    await expect(connectHeading.or(connectButton).first()).toBeVisible({ timeout: 15000 });
  });

  test("GET /api/trustlines/check validates required parameters", async ({ request }) => {
    // Missing parameters
    const res1 = await request.get(`${BASE_URL}/api/trustlines/check`);
    expect(res1.status()).toBe(400);

    const data1 = await res1.json();
    expect(data1.success).toBe(false);
    expect(data1.error.message).toContain("account");

    // Invalid account address
    const res2 = await request.get(
      `${BASE_URL}/api/trustlines/check?account=invalid-address&code=USDC&issuer=${USDC_ISSUER}`
    );
    expect(res2.status()).toBe(400);
  });

  test("GET /api/trustlines/check reports native XLM as authorized without trustline", async ({
    request,
  }) => {
    const res = await request.get(
      `${BASE_URL}/api/trustlines/check?account=${TEST_ACCOUNT}&code=XLM`
    );
    expect(res.status()).toBe(200);

    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.data.status).toBe("authorized");
    expect(data.data.reserveRequirementXlm).toBe("0");
    expect(data.data.actionRequired).toBe(false);
  });

  test("GET /api/trustlines/check queries non-native asset trustline status", async ({
    request,
  }) => {
    const res = await request.get(
      `${BASE_URL}/api/trustlines/check?account=${TEST_ACCOUNT}&code=USDC&issuer=${USDC_ISSUER}`
    );
    expect(res.status()).toBe(200);

    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.data.assetCode).toBe("USDC");
    expect(data.data.reserveRequirementXlm).toBe("0.5");
    expect(data.data.explanation).toContain("A trustline is an explicit agreement");
    expect(["no_trustline", "authorized", "frozen", "unauthorized"]).toContain(
      data.data.status
    );
  });
});
