// SPDX-License-Identifier: MIT

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/scheduled-payments", () => ({
  executeDueScheduledPayments: vi.fn(),
  getScheduledSourcePublicKey: vi.fn(),
  SCHEDULED_SOURCE_SECRET_ENV: "SCHEDULED_PAYMENTS_SOURCE_SECRET",
}));

import { GET, POST } from "@/app/api/scheduled/run/route";
import {
  executeDueScheduledPayments,
  getScheduledSourcePublicKey,
} from "@/lib/scheduled-payments";

const PUBLIC_KEY = "GWT7SDH7366X75RZDMUOCSWWRJUF3IJKJI4FYHZAEQSPI626PO4LZZF4";

describe("GET/POST /api/scheduled/run", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    delete process.env.CRON_SECRET;
  });

  it("rejects requests when CRON_SECRET is not configured", async () => {
    delete process.env.CRON_SECRET;

    const res = await GET(new Request("http://localhost/api/scheduled/run"));

    expect(res.status).toBe(401);
    expect(executeDueScheduledPayments).not.toHaveBeenCalled();
  });

  it("rejects requests with a wrong secret", async () => {
    process.env.CRON_SECRET = "right-secret";

    const res = await GET(
      new Request("http://localhost/api/scheduled/run", {
        headers: { authorization: "Bearer wrong-secret" },
      })
    );

    expect(res.status).toBe(401);
    expect(executeDueScheduledPayments).not.toHaveBeenCalled();
  });

  it("executes due payments with a valid Bearer cron secret", async () => {
    process.env.CRON_SECRET = "right-secret";
    vi.mocked(getScheduledSourcePublicKey).mockReturnValue(PUBLIC_KEY);
    vi.mocked(executeDueScheduledPayments).mockResolvedValue({
      picked: 2,
      executed: 1,
      failed: 1,
      results: [
        { id: "a", status: "EXECUTED", transactionHash: "tx1" },
        { id: "b", status: "FAILED", error: "boom" },
      ],
    });

    const res = await POST(
      new Request("http://localhost/api/scheduled/run", {
        method: "POST",
        headers: { authorization: "Bearer right-secret" },
      })
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toMatchObject({
      picked: 2,
      executed: 1,
      failed: 1,
      sourcePublicKey: PUBLIC_KEY,
    });
    expect(executeDueScheduledPayments).toHaveBeenCalled();
  });

  it("accepts the x-cron-secret header as an alternative", async () => {
    process.env.CRON_SECRET = "right-secret";
    vi.mocked(getScheduledSourcePublicKey).mockReturnValue(PUBLIC_KEY);
    vi.mocked(executeDueScheduledPayments).mockResolvedValue({
      picked: 0,
      executed: 0,
      failed: 0,
      results: [],
    });

    const res = await GET(
      new Request("http://localhost/api/scheduled/run", {
        headers: { "x-cron-secret": "right-secret" },
      })
    );

    expect(res.status).toBe(200);
  });

  it("returns 503 without touching records when the server account is unconfigured", async () => {
    process.env.CRON_SECRET = "right-secret";
    vi.mocked(getScheduledSourcePublicKey).mockImplementation(() => {
      throw new Error("SCHEDULED_PAYMENTS_SOURCE_SECRET is not configured");
    });

    const res = await GET(
      new Request("http://localhost/api/scheduled/run", {
        headers: { authorization: "Bearer right-secret" },
      })
    );

    expect(res.status).toBe(503);
    expect(executeDueScheduledPayments).not.toHaveBeenCalled();
  });
});
