// SPDX-License-Identifier: MIT

import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  mockRunPaymentStatusSync,
  mockGetAuthContext,
  mockAuthorizeCronRequest,
  mockVerifyCsrf,
} = vi.hoisted(() => ({
  mockRunPaymentStatusSync: vi.fn(),
  mockGetAuthContext: vi.fn(),
  mockAuthorizeCronRequest: vi.fn(),
  mockVerifyCsrf: vi.fn(),
}));

vi.mock("@/lib/payment-sync", () => ({
  runPaymentStatusSync: mockRunPaymentStatusSync,
}));

vi.mock("@/lib/auth-session", () => ({
  getAuthContext: mockGetAuthContext,
}));

vi.mock("@/lib/scheduler", () => ({
  authorizeCronRequest: mockAuthorizeCronRequest,
}));

vi.mock("@/lib/csrf", () => ({
  verifyCsrf: mockVerifyCsrf,
}));

import { GET, POST } from "@/app/api/jobs/reconcile-payments/route";

describe("Jobs — Reconcile Payments Route (/api/jobs/reconcile-payments)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockVerifyCsrf.mockReturnValue(null); // No CSRF error by default
  });

  describe("GET /api/jobs/reconcile-payments", () => {
    it("returns 401 when neither cron secret nor admin session is provided", async () => {
      mockAuthorizeCronRequest.mockReturnValueOnce({ ok: false });
      mockGetAuthContext.mockResolvedValueOnce(null);

      const request = new Request("http://localhost/api/jobs/reconcile-payments", {
        method: "GET",
      });

      const response = await GET(request);
      expect(response.status).toBe(401);
      expect(mockRunPaymentStatusSync).not.toHaveBeenCalled();
    });

    it("triggers cron sync run when authorized via cron secret", async () => {
      mockAuthorizeCronRequest.mockReturnValueOnce({ ok: true });
      mockRunPaymentStatusSync.mockResolvedValueOnce({
        id: "run_101",
        trigger: "cron",
        status: "success",
        scanned: 5,
        confirmed: 3,
        failed: 0,
      });

      const request = new Request("http://localhost/api/jobs/reconcile-payments", {
        method: "GET",
        headers: { "x-cron-secret": "secret123" },
      });

      const response = await GET(request);
      expect(response.status).toBe(200);
      expect(mockRunPaymentStatusSync).toHaveBeenCalledWith("cron");
      const json = await response.json();
      expect(json.data.confirmed).toBe(3);
    });

    it("triggers admin sync run when authorized via session", async () => {
      mockAuthorizeCronRequest.mockReturnValueOnce({ ok: false });
      mockGetAuthContext.mockResolvedValueOnce({ userId: "admin_user" });
      mockRunPaymentStatusSync.mockResolvedValueOnce({
        id: "run_admin_102",
        trigger: "admin",
        status: "success",
        scanned: 2,
        confirmed: 1,
        failed: 0,
      });

      const request = new Request("http://localhost/api/jobs/reconcile-payments", {
        method: "GET",
      });

      const response = await GET(request);
      expect(response.status).toBe(200);
      expect(mockRunPaymentStatusSync).toHaveBeenCalledWith("admin");
    });
  });

  describe("POST /api/jobs/reconcile-payments", () => {
    it("rejects if CSRF validation fails", async () => {
      mockVerifyCsrf.mockReturnValueOnce(
        new Response(JSON.stringify({ error: "Invalid CSRF" }), { status: 403 })
      );

      const request = new Request("http://localhost/api/jobs/reconcile-payments", {
        method: "POST",
      });

      const response = await POST(request);
      expect(response.status).toBe(403);
      expect(mockRunPaymentStatusSync).not.toHaveBeenCalled();
    });

    it("executes sync successfully for authorized POST", async () => {
      mockAuthorizeCronRequest.mockReturnValueOnce({ ok: true });
      mockRunPaymentStatusSync.mockResolvedValueOnce({
        id: "run_post_103",
        trigger: "cron",
        status: "success",
        scanned: 10,
        confirmed: 8,
        failed: 1,
      });

      const request = new Request("http://localhost/api/jobs/reconcile-payments", {
        method: "POST",
      });

      const response = await POST(request);
      expect(response.status).toBe(200);
      expect(mockRunPaymentStatusSync).toHaveBeenCalledWith("cron");
      const json = await response.json();
      expect(json.data.scanned).toBe(10);
    });
  });
});
