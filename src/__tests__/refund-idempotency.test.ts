// SPDX-License-Identifier: MIT

import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockFindFirst, mockCreate, mockFindMany, mockUpdateMany, mockAuditCreate, mockGetAuthContext, mockVerifyCsrf } =
  vi.hoisted(() => ({
    mockFindFirst: vi.fn(),
    mockCreate: vi.fn(),
    mockFindMany: vi.fn(),
    mockUpdateMany: vi.fn(),
    mockAuditCreate: vi.fn(),
    mockGetAuthContext: vi.fn(),
    mockVerifyCsrf: vi.fn(),
  }));

vi.mock("@/lib/prisma", () => ({
  default: {
    refund: {
      findFirst: mockFindFirst,
      create: mockCreate,
      updateMany: mockUpdateMany,
    },
    auditLog: {
      create: mockAuditCreate,
      findMany: mockFindMany,
    },
  },
}));

vi.mock("@/lib/auth-session", () => ({
  getAuthContext: mockGetAuthContext,
}));

vi.mock("@/lib/csrf", () => ({
  verifyCsrf: mockVerifyCsrf,
}));

vi.mock("@/lib/api-auth", () => ({
  withApiAuth: (fn: unknown) => fn,
}));

import { POST } from "@/app/api/refunds/route";
import { GET as AuditGET } from "@/app/api/audit-log/route";
import { REFUND_REASON_CODES } from "@/lib/validation-schemas";

const USER_ID = "user-1";

function makeRequest(body: unknown): Request {
  return new Request("http://localhost/api/refunds", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function makeRefundBody(overrides: Record<string, unknown> = {}) {
  return {
    paymentId: 1001,
    amount: 10.5,
    asset: "native",
    reason: "duplicate charge",
    reasonCode: 3,
    ...overrides,
  };
}

function makeRefund(overrides: Record<string, unknown> = {}) {
  return {
    id: "refund_1",
    userId: USER_ID,
    paymentId: "1001",
    amount: 10.5,
    asset: "native",
    reason: "duplicate charge",
    reasonCode: 3,
    status: "REQUESTED",
    requestedAt: new Date(),
    resolvedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  mockGetAuthContext.mockResolvedValue({ userId: USER_ID });
  mockVerifyCsrf.mockReturnValue(null);
});

describe("POST /api/refunds — idempotency (issue #365)", () => {
  it("rejects a duplicate refund for the same payment with a 409", async () => {
    mockFindFirst.mockResolvedValue({ id: "refund_1", status: "REQUESTED" });

    const res = await POST(makeRequest(makeRefundBody()));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.message).toContain("already exists");
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("fails closed on a P2002 race (concurrent duplicates) with a 409", async () => {
    mockFindFirst.mockResolvedValue(null);
    mockCreate.mockRejectedValue({ code: "P2002" });

    const res = await POST(makeRequest(makeRefundBody()));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.message).toContain("already exists");
  });

  it("rejects an unknown reason code with a clear error", async () => {
    mockFindFirst.mockResolvedValue(null);

    const res = await POST(makeRequest(makeRefundBody({ reasonCode: 99 })));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(JSON.stringify(body)).toContain("reasonCode");
  });

  it("accepts every supported reason code 0-5", async () => {
    mockFindFirst.mockResolvedValue(null);
    mockCreate.mockImplementation(({ data }) => Promise.resolve(makeRefund({ reasonCode: data.reasonCode })));

    for (const code of REFUND_REASON_CODES) {
      const res = await POST(makeRequest(makeRefundBody({ reasonCode: code })));
      expect(res.status).toBe(201);
    }
  });

  it("records an audit entry with the refund id on successful create", async () => {
    mockFindFirst.mockResolvedValue(null);
    mockCreate.mockResolvedValue(makeRefund());
    mockAuditCreate.mockResolvedValue({ id: "audit_1" });

    const res = await POST(makeRequest(makeRefundBody()));
    expect(res.status).toBe(201);
    expect(mockAuditCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "refund:create",
        actor: USER_ID,
        target: "refund_1",
      }),
    });
  });
});

describe("GET /api/audit-log?source=db — refund history queryable (issue #365)", () => {
  it("returns persisted audit entries with record ids", async () => {
    mockFindMany.mockResolvedValue([
      {
        id: "audit_1",
        action: "refund:create",
        actor: USER_ID,
        target: "refund_1",
        details: { paymentId: "1001", reasonCode: 3 },
        createdAt: new Date("2026-08-29T00:00:00Z"),
      },
    ]);

    const res = await AuditGET(
      new Request("http://localhost/api/audit-log?source=db&limit=20&page=1")
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data[0].id).toBe("audit_1");
    expect(body.data[0].target_id).toBe("refund_1");
  });
});
