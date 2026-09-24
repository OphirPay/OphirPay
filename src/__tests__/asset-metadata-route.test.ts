// SPDX-License-Identifier: MIT

import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/metrics-middleware", () => ({
  withMetrics: (_name: string, fn: unknown) => fn,
}));
vi.mock("@/lib/request-logging", () => ({
  withRequestLogging: (fn: unknown) => fn,
}));
// Lightweight stand-ins for the framework response helpers — keeps the route's
// validation branching testable without pulling in next/server and zod.
vi.mock("@/lib/api-response", () => ({
  successResponse: (data: unknown) =>
    new Response(JSON.stringify({ success: true, data }), { status: 200 }),
  badRequestError: (message: string) =>
    new Response(
      JSON.stringify({ success: false, error: { code: "bad_request", message } }),
      { status: 400 },
    ),
  unauthorizedError: (message: string) =>
    new Response(
      JSON.stringify({ success: false, error: { code: "unauthorized", message } }),
      { status: 401 },
    ),
  handleApiError: (err: unknown) =>
    new Response(
      JSON.stringify({ success: false, error: { message: String(err) } }),
      { status: 500 },
    ),
}));
vi.mock("@/lib/lookup-rate-limit", () => ({
  enforceLookupRateLimit: vi.fn(async () => null),
}));

const getAuthContext = vi.fn(async () => ({ user: "tester" }));
vi.mock("@/lib/auth-session", () => ({
  getAuthContext: (...args: unknown[]) => getAuthContext(...args),
}));

const resolveAssetMetadata = vi.fn();
vi.mock("@/lib/asset-metadata", () => ({
  resolveAssetMetadata: (...args: unknown[]) => resolveAssetMetadata(...args),
}));

import { GET } from "@/app/api/asset-metadata/route";

// A format-valid Stellar account id: G followed by exactly 55 uppercase
// alphanumeric characters (matches /^G[A-Z0-9]{55}$/).
const ISSUER = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

const buildRequest = (query: string): Request =>
  new Request(`https://app.test/api/asset-metadata?${query}`, {
    method: "GET",
  });

describe("GET /api/asset-metadata", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when unauthenticated", async () => {
    getAuthContext.mockResolvedValueOnce(null);
    const res = await GET(buildRequest("code=USDC&issuer=GABC"));
    expect(res.status).toBe(401);
  });

  it("returns 400 when code is missing", async () => {
    const res = await GET(
      buildRequest(
        `issuer=${ISSUER}`,
      ),
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 when issuer is not a valid Stellar account", async () => {
    const res = await GET(buildRequest("code=USDC&issuer=not-an-issuer"));
    expect(res.status).toBe(400);
    expect(resolveAssetMetadata).not.toHaveBeenCalled();
  });

  it("returns 400 for an invalid network", async () => {
    const res = await GET(
      buildRequest(
        `code=USDC&issuer=${ISSUER}&network=BOGUS`,
      ),
    );
    expect(res.status).toBe(400);
  });

  it("returns resolved metadata for a valid request", async () => {
    resolveAssetMetadata.mockResolvedValueOnce({ name: "USD Coin" });
    const res = await GET(
      buildRequest(
        `code=USDC&issuer=${ISSUER}&network=PUBLIC`,
      ),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.metadata).toEqual({ name: "USD Coin" });
    expect(resolveAssetMetadata).toHaveBeenCalledWith(
      "USDC",
      ISSUER,
      "PUBLIC",
    );
  });

  it("returns metadata: null when unresolvable (graceful)", async () => {
    resolveAssetMetadata.mockResolvedValueOnce(null);
    const res = await GET(
      buildRequest(
        `code=ZZZ&issuer=${ISSUER}`,
      ),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.metadata).toBeNull();
  });
});
