// SPDX-License-Identifier: MIT

import { test, expect } from "@playwright/test";

const BASE_URL = process.env.E2E_BASE_URL || "http://localhost:3000";

// Security model under test:
//   • Public endpoints: /api/health, /api/metrics, /api/events
//   • All data routes are auth-gated → 401 without a session/API key
//     (wallet session cookie, Authorization: Bearer, or X-API-Key).

// ── Health ─────────────────────────────────────────────────────

test.describe("GET /api/health", () => {
  test("reports service status (200 healthy / 503 degraded)", async ({
    request,
  }) => {
    // The health endpoint is designed to return 503 when a dependency is
    // degraded (e.g. the database is unreachable), while still reporting the
    // full service status in the body. Accept either contract so CI stays
    // stable against the live deployment.
    const res = await request.get(`${BASE_URL}/api/health`);
    expect([200, 503]).toContain(res.status());

    const json = await res.json();
    expect(json.data.version).toBeDefined();
    expect(json.data.services.database.status).toBeDefined();
    expect(json.data.services.stellar).toBeDefined();
    expect(json.data.uptime).toBeGreaterThan(0);
  });
});

// ── Metrics ────────────────────────────────────────────────────

test.describe("GET /api/metrics", () => {
  test("returns Prometheus text format", async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/metrics`);
    expect(res.status()).toBe(200);

    const text = await res.text();
    expect(text).toContain("ophirpay_http_requests_total");
    expect(text).toContain("ophirpay_payments_created_total");
    expect(text).toContain("ophirpay_info");
  });
});

// ── Auth gate: data routes require a session or API key ────────

test.describe("Auth gate on data routes", () => {
  test("GET /api/payments returns 401 without auth", async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/payments?page=1&limit=10`);
    expect(res.status()).toBe(401);
  });

  test("GET /api/payments rejects bad pagination only after auth", async ({
    request,
  }) => {
    // Auth check runs before validation, so an unauthenticated request
    // with invalid pagination still returns 401 (not 400).
    const res = await request.get(`${BASE_URL}/api/payments?page=0&limit=500`);
    expect(res.status()).toBe(401);
  });

  test("GET /api/recurring returns 401 without auth", async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/recurring?page=1&limit=5`);
    expect(res.status()).toBe(401);
  });

  test("GET /api/analytics returns 401 without auth", async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/analytics`);
    expect(res.status()).toBe(401);
  });

  test("GET /api/requests returns 401 without auth", async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/requests`);
    expect(res.status()).toBe(401);
  });

  test("GET /api/hooks returns 401 without auth", async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/hooks`);
    expect(res.status()).toBe(401);
  });

  test("GET /api/refunds returns 401 without auth", async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/refunds`);
    expect(res.status()).toBe(401);
  });
});

// ── Batches (auth-gated) ───────────────────────────────────────

test.describe("POST /api/batches", () => {
  test("returns 401 without auth", async ({ request }) => {
    const res = await request.post(`${BASE_URL}/api/batches`, {
      data: { name: "Unauthed batch", recipients: [] },
    });
    expect(res.status()).toBe(401);
  });
});

// ── Webhooks (auth-gated) ─────────────────────────────────────

test.describe("GET /api/webhooks", () => {
  test("returns 401 without API key", async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/webhooks`);
    expect(res.status()).toBe(401);

    const json = await res.json();
    expect(json.success).toBe(false);
    expect(json.error.code).toBe("UNAUTHORIZED");
  });
});

// ── API Keys (auth-gated) ──────────────────────────────────────

test.describe("GET /api/keys", () => {
  test("returns 401 without API key", async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/keys`);
    expect(res.status()).toBe(401);
  });
});

// ── CORS & Security Headers ────────────────────────────────────

test.describe("Security headers on API", () => {
  test("API returns security headers", async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/health`);
    expect(res.headers()["x-content-type-options"]).toBe("nosniff");
    expect(res.headers()["x-frame-options"]).toBe("DENY");
    expect(res.headers()["referrer-policy"]).toBeDefined();
  });
});

// ── Not Found ──────────────────────────────────────────────────

test.describe("404 handling", () => {
  test("unknown API route returns proper error", async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/nonexistent`);
    // Next.js returns 404 for unknown routes
    expect(res.status()).toBeGreaterThanOrEqual(400);
  });
});

// ── SSE Events ─────────────────────────────────────────────────

test.describe("GET /api/events", () => {
  test("opens an SSE stream", async ({ page }) => {
    // SSE streams never end, so APIRequestContext (which waits for the full
    // body) cannot be used. Verify the stream opens via a real EventSource.
    await page.goto("/");
    const connected = await page.evaluate(
      () =>
        new Promise<boolean>((resolve) => {
          const es = new EventSource("/api/events");
          const timer = setTimeout(() => {
            es.close();
            resolve(false);
          }, 15000);
          es.onopen = () => {
            clearTimeout(timer);
            es.close();
            resolve(true);
          };
          es.onerror = () => {
            clearTimeout(timer);
            es.close();
            resolve(false);
          };
        })
    );
    expect(connected).toBe(true);
  });
});
