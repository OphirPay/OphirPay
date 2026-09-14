// SPDX-License-Identifier: MIT

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Prisma } from "@prisma/client";
import { MAX_EXECUTION_ATTEMPTS, PROCESSING_LEASE_MS } from "@/lib/scheduler";

// vi.hoisted ensures these exist before the mocked modules are imported
// (ESM imports are hoisted above the const declarations otherwise).
const {
  mockFindMany,
  mockUpdateMany,
  mockUpdate,
  mockSubmitPaymentFromSecret,
  mockPublicKeyFromSecret,
} = vi.hoisted(() => ({
  mockFindMany: vi.fn(),
  mockUpdateMany: vi.fn(),
  mockUpdate: vi.fn(),
  mockSubmitPaymentFromSecret: vi.fn(),
  mockPublicKeyFromSecret: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  default: {
    scheduledPayment: {
      findMany: mockFindMany,
      updateMany: mockUpdateMany,
      update: mockUpdate,
    },
  },
}));

vi.mock("@/lib/stellar", () => ({
  submitPaymentFromSecret: mockSubmitPaymentFromSecret,
  publicKeyFromSecret: mockPublicKeyFromSecret,
}));

import { GET, POST } from "@/app/api/cron/route";

const CRON_SECRET = "test-cron-secret-0123456789";
const SOURCE_SECRET = "SBTESTSECRETKEYFORSCHEDULEDPAYMENTSXXXXXXXXXXXXXXXXX";
const SOURCE_PUBLIC = "GBTESTOPERATORACCOUNTXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX";

/** The instant every run in this file "starts" at. */
const NOW = new Date("2026-08-28T12:00:00.000Z");

function at(offsetMs: number): Date {
  return new Date(NOW.getTime() + offsetMs);
}

type ScheduledRow = {
  id: string;
  userId: string;
  amount: Prisma.Decimal;
  assetCode: string;
  assetIssuer: string | null;
  destAddress: string;
  memo: string | null;
  scheduledAt: Date;
  status: string;
  lockedAt: Date | null;
  attempts: number;
};

function row(overrides: Partial<ScheduledRow> = {}): ScheduledRow {
  return {
    id: "sched-1",
    userId: "user-1",
    amount: new Prisma.Decimal("25.5"),
    assetCode: "XLM",
    assetIssuer: null,
    destAddress: "GDESTINATIONXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
    memo: "payout",
    scheduledAt: at(-60_000),
    status: "SCHEDULED",
    lockedAt: null,
    attempts: 0,
    ...overrides,
  };
}

function cronRequest(headers: Record<string, string> = {}): Request {
  return new Request("https://ophirpay.test/api/cron", {
    headers: { authorization: `Bearer ${CRON_SECRET}`, ...headers },
  });
}

/** The run summary returned inside the standard success envelope. */
async function summaryOf(response: Response) {
  const body = await response.json();
  return body.data;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(NOW);

  vi.stubEnv("CRON_SECRET", CRON_SECRET);
  vi.stubEnv("SCHEDULED_PAYMENTS_SOURCE_SECRET", SOURCE_SECRET);

  mockPublicKeyFromSecret.mockReturnValue(SOURCE_PUBLIC);
  mockFindMany.mockResolvedValue([]);
  // Default: the claim succeeds — this run owns the row.
  mockUpdateMany.mockResolvedValue({ count: 1 });
  mockUpdate.mockImplementation(async ({ where }) => ({ id: where.id }));
  mockSubmitPaymentFromSecret.mockResolvedValue({
    hash: "hash-1",
    successful: true,
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("GET /api/cron — authorization", () => {
  it("returns 503 and touches nothing when CRON_SECRET is unset", async () => {
    vi.stubEnv("CRON_SECRET", "");

    const response = await GET(cronRequest());

    expect(response.status).toBe(503);
    expect(mockFindMany).not.toHaveBeenCalled();
  });

  it("returns 401 for a wrong secret", async () => {
    const response = await GET(
      cronRequest({ authorization: "Bearer not-the-secret" })
    );

    expect(response.status).toBe(401);
    expect(mockFindMany).not.toHaveBeenCalled();
  });

  it("returns 401 when no secret is presented", async () => {
    const response = await GET(
      new Request("https://ophirpay.test/api/cron")
    );

    expect(response.status).toBe(401);
  });

  it("accepts the secret via the x-cron-secret header", async () => {
    const response = await GET(
      new Request("https://ophirpay.test/api/cron", {
        headers: { "x-cron-secret": CRON_SECRET },
      })
    );

    expect(response.status).toBe(200);
  });

  it("runs the same work over POST", async () => {
    mockFindMany.mockResolvedValue([row()]);

    const response = await POST(cronRequest());

    expect(response.status).toBe(200);
    expect(await summaryOf(response)).toMatchObject({ executed: 1 });
  });
});

describe("GET /api/cron — configuration", () => {
  it("returns 503 without claiming rows when the source secret is unset", async () => {
    vi.stubEnv("SCHEDULED_PAYMENTS_SOURCE_SECRET", "");
    mockFindMany.mockResolvedValue([row()]);

    const response = await GET(cronRequest());

    expect(response.status).toBe(503);
    expect(mockFindMany).not.toHaveBeenCalled();
    expect(mockUpdateMany).not.toHaveBeenCalled();
  });

  it("returns 500 when the source secret is not a valid Stellar key", async () => {
    mockPublicKeyFromSecret.mockImplementation(() => {
      throw new Error("invalid encoded string");
    });

    const response = await GET(cronRequest());

    expect(response.status).toBe(500);
    expect(mockUpdateMany).not.toHaveBeenCalled();
  });
});

describe("GET /api/cron — due selection", () => {
  it("queries only rows due as of the run's clock", async () => {
    await GET(cronRequest());

    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ scheduledAt: { lte: NOW } }),
        orderBy: { scheduledAt: "asc" },
      })
    );
  });

  it("leaves a payment alone until its scheduled instant arrives", async () => {
    const pending = row({ scheduledAt: at(60_000) });
    mockFindMany.mockResolvedValue([pending]);

    const early = await summaryOf(await GET(cronRequest()));
    expect(early).toMatchObject({ picked: 0, executed: 0 });
    expect(mockSubmitPaymentFromSecret).not.toHaveBeenCalled();

    // Advance the simulated clock past the due date and run again.
    vi.setSystemTime(at(61_000));
    const later = await summaryOf(await GET(cronRequest()));

    expect(later).toMatchObject({ picked: 1, executed: 1 });
    expect(mockSubmitPaymentFromSecret).toHaveBeenCalledTimes(1);
  });

  it("executes due payments oldest first", async () => {
    mockFindMany.mockResolvedValue([
      row({ id: "b", scheduledAt: at(-30_000) }),
      row({ id: "a", scheduledAt: at(-90_000) }),
    ]);

    await GET(cronRequest());

    expect(
      mockUpdateMany.mock.calls.map(([args]) => args.where.id)
    ).toEqual(["a", "b"]);
  });

  it("reports an empty run when nothing is due", async () => {
    const summary = await summaryOf(await GET(cronRequest()));

    expect(summary).toMatchObject({
      picked: 0,
      executed: 0,
      failed: 0,
      skipped: 0,
      sourcePublicKey: SOURCE_PUBLIC,
    });
  });
});

describe("GET /api/cron — execution", () => {
  it("submits the payment and records the tx hash and status", async () => {
    mockFindMany.mockResolvedValue([row()]);
    mockSubmitPaymentFromSecret.mockResolvedValue({
      hash: "abc123",
      successful: true,
    });

    const summary = await summaryOf(await GET(cronRequest()));

    expect(mockSubmitPaymentFromSecret).toHaveBeenCalledWith({
      sourceSecret: SOURCE_SECRET,
      destination: row().destAddress,
      amount: "25.5",
      memo: "payout",
      assetCode: "XLM",
      assetIssuer: undefined,
    });
    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: "sched-1" },
      data: expect.objectContaining({
        status: "EXECUTED",
        transactionHash: "abc123",
        executedAt: NOW,
        lockedAt: null,
        lockedBy: null,
      }),
    });
    expect(summary).toMatchObject({
      picked: 1,
      executed: 1,
      failed: 0,
      results: [{ id: "sched-1", status: "EXECUTED", transactionHash: "abc123" }],
    });
  });

  it("claims each row before submitting it", async () => {
    mockFindMany.mockResolvedValue([row()]);

    await GET(cronRequest());

    const [claim] = mockUpdateMany.mock.calls[0];
    expect(claim.where).toMatchObject({
      id: "sched-1",
      attempts: { lt: MAX_EXECUTION_ATTEMPTS },
    });
    expect(claim.data).toMatchObject({
      status: "PROCESSING",
      lockedAt: NOW,
      attempts: { increment: 1 },
    });
    expect(claim.data.lockedBy).toEqual(expect.any(String));
  });

  it("submits sequentially so sequence numbers stay in step", async () => {
    mockFindMany.mockResolvedValue([
      row({ id: "a", scheduledAt: at(-90_000) }),
      row({ id: "b", scheduledAt: at(-30_000) }),
    ]);

    let inFlight = 0;
    let maxInFlight = 0;
    mockSubmitPaymentFromSecret.mockImplementation(async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await Promise.resolve();
      inFlight -= 1;
      return { hash: "hash", successful: true };
    });

    await GET(cronRequest());

    expect(maxInFlight).toBe(1);
  });

  it("passes a non-native asset through to the submission", async () => {
    mockFindMany.mockResolvedValue([
      row({
        assetCode: "USDC",
        assetIssuer: "GISSUERXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
        memo: null,
      }),
    ]);

    await GET(cronRequest());

    expect(mockSubmitPaymentFromSecret).toHaveBeenCalledWith(
      expect.objectContaining({
        assetCode: "USDC",
        assetIssuer: "GISSUERXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
        memo: undefined,
      })
    );
  });
});

describe("GET /api/cron — idempotency under overlapping runs", () => {
  it("skips a row another run claimed first, without submitting it", async () => {
    mockFindMany.mockResolvedValue([row()]);
    // The concurrent run won the compare-and-set: no row matched ours.
    mockUpdateMany.mockResolvedValue({ count: 0 });

    const summary = await summaryOf(await GET(cronRequest()));

    expect(mockSubmitPaymentFromSecret).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(summary).toMatchObject({
      picked: 1,
      executed: 0,
      skipped: 1,
      results: [{ id: "sched-1", status: "SKIPPED" }],
    });
  });

  it("executes each row exactly once across two overlapping runs", async () => {
    const due = row();
    mockFindMany.mockResolvedValue([due]);

    // Only the first claim in the whole test wins — the second run's
    // conditional update matches nothing, exactly as Postgres would behave.
    let claimsWon = 0;
    mockUpdateMany.mockImplementation(async () => {
      if (claimsWon === 0) {
        claimsWon += 1;
        return { count: 1 };
      }
      return { count: 0 };
    });

    const [first, second] = await Promise.all([
      GET(cronRequest()).then(summaryOf),
      GET(cronRequest()).then(summaryOf),
    ]);

    expect(mockSubmitPaymentFromSecret).toHaveBeenCalledTimes(1);
    expect(first.executed + second.executed).toBe(1);
    expect(first.skipped + second.skipped).toBe(1);
  });

  it("does not pick up a row whose lease is still live", async () => {
    mockFindMany.mockResolvedValue([
      row({
        status: "PROCESSING",
        lockedAt: at(-PROCESSING_LEASE_MS + 1_000),
      }),
    ]);

    const summary = await summaryOf(await GET(cronRequest()));

    expect(summary).toMatchObject({ picked: 0, skipped: 0 });
    expect(mockUpdateMany).not.toHaveBeenCalled();
  });

  it("reclaims a row abandoned by a crashed run once its lease expires", async () => {
    mockFindMany.mockResolvedValue([
      row({ status: "PROCESSING", lockedAt: at(-PROCESSING_LEASE_MS), attempts: 1 }),
    ]);

    const summary = await summaryOf(await GET(cronRequest()));

    expect(summary).toMatchObject({ picked: 1, executed: 1 });
  });
});

describe("GET /api/cron — failure handling", () => {
  it("returns a payment to SCHEDULED while attempts remain", async () => {
    mockFindMany.mockResolvedValue([row()]);
    mockSubmitPaymentFromSecret.mockRejectedValue(new Error("horizon down"));

    const summary = await summaryOf(await GET(cronRequest()));

    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: "sched-1" },
      data: expect.objectContaining({
        status: "SCHEDULED",
        errorMessage: "horizon down",
        lockedAt: null,
        lockedBy: null,
      }),
    });
    expect(summary).toMatchObject({
      failed: 1,
      results: [{ id: "sched-1", status: "RETRY_SCHEDULED", error: "horizon down" }],
    });
  });

  it("marks the payment FAILED once the attempt cap is reached", async () => {
    mockFindMany.mockResolvedValue([
      row({ attempts: MAX_EXECUTION_ATTEMPTS - 1 }),
    ]);
    mockSubmitPaymentFromSecret.mockRejectedValue(new Error("tx_insufficient_balance"));

    const summary = await summaryOf(await GET(cronRequest()));

    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: "sched-1" },
      data: expect.objectContaining({
        status: "FAILED",
        errorMessage: "tx_insufficient_balance",
      }),
    });
    expect(summary.results).toEqual([
      { id: "sched-1", status: "FAILED", error: "tx_insufficient_balance" },
    ]);
  });

  it("keeps executing the rest of the batch after one payment fails", async () => {
    mockFindMany.mockResolvedValue([
      row({ id: "a", scheduledAt: at(-90_000) }),
      row({ id: "b", scheduledAt: at(-30_000) }),
    ]);
    mockSubmitPaymentFromSecret
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce({ hash: "hash-b", successful: true });

    const summary = await summaryOf(await GET(cronRequest()));

    expect(summary).toMatchObject({ picked: 2, executed: 1, failed: 1 });
    expect(summary.results.map((r: { id: string }) => r.id)).toEqual(["a", "b"]);
  });

  it("returns 500 when the candidate query itself fails", async () => {
    mockFindMany.mockRejectedValue(new Error("database unreachable"));

    const response = await GET(cronRequest());

    expect(response.status).toBe(500);
  });
});
