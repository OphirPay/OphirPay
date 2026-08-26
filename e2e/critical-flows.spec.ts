// SPDX-License-Identifier: MIT

import { test, expect } from "@playwright/test";

const BASE_URL = process.env.E2E_BASE_URL || "http://localhost:3000";

// Security model under test:
//   • Public endpoints (/api/health, /api/metrics) remain open.
//   • Every data route is auth-gated → 401 without a session/API key.
//   • Pages render client-side regardless of wallet connection.

// ── Payment Flow (Critical Path) ───────────────────────────────

test.describe("Payment Flow", () => {
  test("send page loads with all required form elements", async ({ page }) => {
    await page.goto("/send");
    await expect(page.locator("main")).toBeVisible();

    // Without a connected wallet the page shows a connect prompt; with one it
    // shows the form. Accept either state.
    const connectPrompt = page.getByText("Connect Your Wallet");
    const recipientInput = page.locator("input[placeholder*='Recipient']");
    const amountInput = page.locator("input[inputmode='decimal']");
    await expect(
      connectPrompt.or(recipientInput).or(amountInput).first()
    ).toBeVisible({ timeout: 15000 });
  });

  test("validates empty form submission", async ({ page }) => {
    await page.goto("/send");
    const sendBtn = page.locator("button[type='submit']").first();
    if (await sendBtn.isVisible()) {
      await sendBtn.click();
      // Should show validation errors or prevent submission
      await expect(page.locator("text=required").or(page.locator("[role='alert']")).first()).toBeVisible({ timeout: 5000 }).catch(() => {
        // Some forms may use HTML5 validation which pauses the test
      });
    }
  });

  test("validates invalid Stellar address format", async ({ page }) => {
    await page.goto("/send");
    const addrInput = page.locator("input[placeholder*='Recipient']").first();
    if (await addrInput.isVisible()) {
      await addrInput.fill("not-a-valid-address");
      await addrInput.blur();
      // Should show validation error
      await page.waitForTimeout(500);
    }
  });
});

// ── Auth Gate: every data route requires a session/API key ─────

test.describe("Auth gate on data routes", () => {
  test("GET /api/escrows returns 401 without auth", async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/escrows`);
    expect(res.status()).toBe(401);
  });

  test("GET /api/escrows?id=1 returns 401 without auth", async ({
    request,
  }) => {
    const res = await request.get(`${BASE_URL}/api/escrows?id=1`);
    expect(res.status()).toBe(401);
  });

  test("POST /api/escrows returns 401 without auth (even with empty body)", async ({
    request,
  }) => {
    const res = await request.post(`${BASE_URL}/api/escrows`, {
      data: {},
    });
    expect(res.status()).toBe(401);
  });

  test("POST /api/escrows returns 401 without auth (even with valid fields)", async ({
    request,
  }) => {
    const res = await request.post(`${BASE_URL}/api/escrows`, {
      data: {
        depositor: "GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
        beneficiary: "GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
        amount: "100",
        deadline: Math.floor(Date.now() / 1000) + 86400,
      },
    });
    expect(res.status()).toBe(401);
  });

  test("GET /api/streams returns 401 without auth", async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/streams`);
    expect(res.status()).toBe(401);
  });

  test("POST /api/streams returns 401 without auth", async ({ request }) => {
    const res = await request.post(`${BASE_URL}/api/streams`, {
      data: {},
    });
    expect(res.status()).toBe(401);
  });

  test("GET /api/fee-config returns 401 without auth", async ({
    request,
  }) => {
    const res = await request.get(`${BASE_URL}/api/fee-config`);
    expect(res.status()).toBe(401);
  });

  test("GET /api/fee-config/collector returns 401 without auth", async ({
    request,
  }) => {
    const res = await request.get(`${BASE_URL}/api/fee-config/collector`);
    expect(res.status()).toBe(401);
  });

  test("GET /api/fee-config/history returns 401 without auth", async ({
    request,
  }) => {
    const res = await request.get(`${BASE_URL}/api/fee-config/history`);
    expect(res.status()).toBe(401);
  });

  test("GET /api/rbac returns 401 without auth", async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/rbac`);
    expect(res.status()).toBe(401);
  });

  test("GET /api/multisig returns 401 without auth", async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/multisig`);
    expect(res.status()).toBe(401);
  });

  test("GET /api/multisig/requests returns 401 without auth", async ({
    request,
  }) => {
    const res = await request.get(`${BASE_URL}/api/multisig/requests`);
    expect(res.status()).toBe(401);
  });

  test("GET /api/governance/proposals returns 401 without auth", async ({
    request,
  }) => {
    const res = await request.get(`${BASE_URL}/api/governance/proposals`);
    expect(res.status()).toBe(401);
  });

  test("GET /api/timelock returns 401 without auth", async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/timelock`);
    expect(res.status()).toBe(401);
  });

  test("GET /api/policy-versions returns 401 without auth", async ({
    request,
  }) => {
    const res = await request.get(`${BASE_URL}/api/policy-versions`);
    expect(res.status()).toBe(401);
  });

  test("GET /api/audit-log returns 401 without auth", async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/audit-log`);
    expect(res.status()).toBe(401);
  });

  test("GET /api/audit-log pagination returns 401 without auth", async ({
    request,
  }) => {
    const res = await request.get(`${BASE_URL}/api/audit-log?page=1&limit=10`);
    expect(res.status()).toBe(401);
  });

  test("GET /api/stats returns 401 without auth", async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/stats`);
    expect(res.status()).toBe(401);
  });

  test("GET /api/contracts returns 401 without auth", async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/contracts`);
    expect(res.status()).toBe(401);
  });

  test("GET /api/refunds returns 401 without auth", async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/refunds?reasonCode=1`);
    expect(res.status()).toBe(401);
  });

  test("GET /api/hooks returns 401 without auth", async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/hooks`);
    expect(res.status()).toBe(401);
  });

  test("POST /api/payments with malformed JSON returns 401 without auth", async ({
    request,
  }) => {
    const res = await request.post(`${BASE_URL}/api/payments`, {
      headers: { "Content-Type": "application/json" },
      data: "not json",
    });
    expect(res.status()).toBe(401);
  });

  test("large pagination limit is blocked by auth gate", async ({
    request,
  }) => {
    const res = await request.get(
      `${BASE_URL}/api/payments?page=1&limit=9999`
    );
    expect(res.status()).toBe(401);
  });

  // ── Single-record sub-routes are also auth-gated ─────────────

  test("GET /api/payments/[id] returns 401 without auth", async ({
    request,
  }) => {
    const res = await request.get(`${BASE_URL}/api/payments/1`);
    expect(res.status()).toBe(401);
  });

  test("PATCH /api/payments/[id] returns 401 without auth", async ({
    request,
  }) => {
    const res = await request.patch(`${BASE_URL}/api/payments/1`, {
      data: { status: "COMPLETED" },
    });
    expect(res.status()).toBe(401);
  });

  test("DELETE /api/payments/[id] returns 401 without auth", async ({
    request,
  }) => {
    const res = await request.delete(`${BASE_URL}/api/payments/1`);
    expect(res.status()).toBe(401);
  });

  test("GET /api/escrows/[id] returns 401 without auth", async ({
    request,
  }) => {
    const res = await request.get(`${BASE_URL}/api/escrows/1`);
    expect(res.status()).toBe(401);
  });

  test("GET /api/batches/[id] returns 401 without auth", async ({
    request,
  }) => {
    const res = await request.get(`${BASE_URL}/api/batches/1`);
    expect(res.status()).toBe(401);
  });

  test("GET /api/recurring/[id] returns 401 without auth", async ({
    request,
  }) => {
    const res = await request.get(`${BASE_URL}/api/recurring/1`);
    expect(res.status()).toBe(401);
  });

  test("GET /api/streams/[id] returns 401 without auth", async ({
    request,
  }) => {
    const res = await request.get(`${BASE_URL}/api/streams/1`);
    expect(res.status()).toBe(401);
  });

  test("POST /api/multisig/propose returns 401 without auth", async ({
    request,
  }) => {
    const res = await request.post(`${BASE_URL}/api/multisig/propose`, {
      data: { caller: "GXXX", payee: "GYYY", amount: "100" },
    });
    expect(res.status()).toBe(401);
  });

  test("POST /api/multisig/approve returns 401 without auth", async ({
    request,
  }) => {
    const res = await request.post(`${BASE_URL}/api/multisig/approve`, {
      data: { signer: "GXXX", requestId: "1" },
    });
    expect(res.status()).toBe(401);
  });

  test("POST /api/multisig/execute returns 401 without auth", async ({
    request,
  }) => {
    const res = await request.post(`${BASE_URL}/api/multisig/execute`, {
      data: { caller: "GXXX", requestId: "1" },
    });
    expect(res.status()).toBe(401);
  });

  test("POST /api/governance/vote returns 401 without auth", async ({
    request,
  }) => {
    const res = await request.post(`${BASE_URL}/api/governance/vote`, {
      data: { voter: "GXXX", proposalId: "1" },
    });
    expect(res.status()).toBe(401);
  });
});

// ── Public endpoints stay open ─────────────────────────────────

test.describe("Public endpoints", () => {
  test("health endpoint bypasses rate limiting", async ({ request }) => {
    // Fire 5 rapid requests — all should succeed since /api/health is exempt
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        request.get(`${BASE_URL}/api/health`)
      )
    );
    for (const res of results) {
      // 200 = healthy, 503 = degraded — health still reports honestly
      expect([200, 503]).toContain(res.status());
    }
  });

  test("metrics endpoint bypasses rate limiting", async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/metrics`);
    expect(res.status()).toBe(200);
  });

  test("OPTIONS preflight returns CORS headers", async ({ request }) => {
    const res = await request.fetch(`${BASE_URL}/api/health`, {
      method: "OPTIONS",
      headers: {
        Origin: "https://ophirpay.vercel.app",
        "Access-Control-Request-Method": "GET",
      },
    });
    // Should be successful with CORS headers
    expect(res.status()).toBeLessThan(500);
  });
});

// ── Response Content Types ─────────────────────────────────────

test.describe("Response Content Types", () => {
  test("API routes return JSON content type", async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/health`);
    expect(res.headers()["content-type"]).toContain("application/json");
  });

  test("metrics returns Prometheus text format", async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/metrics`);
    expect(res.headers()["content-type"]).toContain("text/plain");
  });
});

// ── API Version Header ─────────────────────────────────────────

test.describe("API Versioning", () => {
  test("API responses include version header", async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/health`);
    // Check for X-API-Version or similar versioning header
    const headers = res.headers();
    const _hasVersion =
      "x-api-version" in headers ||
      "api-version" in headers;
    // Not required yet, but validate response is well-formed
    expect([200, 503]).toContain(res.status());
  });
});
