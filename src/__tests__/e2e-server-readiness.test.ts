// SPDX-License-Identifier: MIT
import { describe, expect, it, vi } from "vitest";
import { waitForE2eServerReady } from "../../scripts/wait-for-e2e-ready.mjs";

describe("E2E server readiness loop (#1324)", () => {
  it("waits for /api/health/live (200) and succeeds when /api/health returns 200 (healthy or degraded)", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ status: 200, text: async () => '{"status":"ok"}' })
      .mockResolvedValueOnce({
        status: 200,
        text: async () =>
          '{"status":"degraded","checks":{"database":{"status":"healthy"}}}',
      });

    const result = await waitForE2eServerReady({
      baseUrl: "http://localhost:3000",
      maxAttempts: 3,
      intervalMs: 0,
      fetchImpl: fetchMock,
    });

    expect(result.ok).toBe(true);
    expect(result.status).toBe(200);
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "http://localhost:3000/api/health/live"
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "http://localhost:3000/api/health"
    );
  });

  it("rejects HTTP 503 from /api/health (dead database) and dumps the health JSON body", async () => {
    const unhealthyBody = JSON.stringify({
      status: "unhealthy",
      checks: { database: { status: "unhealthy", error: "Connection refused" } },
    });

    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (url.endsWith("/api/health/live")) {
        return { status: 200, text: async () => '{"status":"ok"}' };
      }
      return { status: 503, text: async () => unhealthyBody };
    });

    const errorSpy = vi.fn();
    await expect(
      waitForE2eServerReady({
        baseUrl: "http://localhost:3000",
        maxAttempts: 2,
        intervalMs: 0,
        fetchImpl: fetchMock,
        logger: { error: errorSpy },
      })
    ).rejects.toThrow(/last HTTP status 503/);

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining(unhealthyBody)
    );
  });
});
