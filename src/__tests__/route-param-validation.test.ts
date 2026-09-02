// SPDX-License-Identifier: MIT
// Confirms routes migrated to validateIdParam() reject bad input with the
// standard 400 envelope, and never call downstream handler logic (Prisma /
// on-chain contract reads) for invalid params. Covers one contract-backed
// route (numeric id) and one DB-backed route (cuid id).

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth-session", () => ({
  getAuthContext: vi.fn(async () => ({ userId: "user_1", publicKey: "GTEST" })),
}));

vi.mock("@/lib/contracts", () => ({
  simulateContractCall: vi.fn(async () => ({
    status: "SUCCESS",
    returnValue: { id: 1 },
  })),
  DEFAULT_CONTRACT_ID: "CTEST",
  CHAIN_READ_SOURCE: "GTEST",
}));

vi.mock("@/lib/prisma", () => ({
  default: {
    payment: {
      findFirst: vi.fn(async () => ({ id: "cabcdefghijklmnopqrstuvwx" })),
    },
  },
}));

import { GET as getEscrow } from "@/app/api/escrows/[id]/route";
import { GET as getPayment } from "@/app/api/payments/[id]/route";
import { simulateContractCall } from "@/lib/contracts";
import prisma from "@/lib/prisma";

const VALID_CUID = "cabcdefghijklmnopqrstuvwx";

function makeRequest(url: string) {
  return new Request(url);
}

describe("GET /api/escrows/[id] — numeric id validation", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 400 VALIDATION_ERROR for a non-numeric id and never calls the contract", async () => {
    const res = await getEscrow(makeRequest("http://localhost/api/escrows/not-a-number"), {
      params: Promise.resolve({ id: "not-a-number" }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(simulateContractCall).not.toHaveBeenCalled();
  });

  it("proceeds to the contract call for a valid numeric id", async () => {
    const res = await getEscrow(makeRequest("http://localhost/api/escrows/42"), {
      params: Promise.resolve({ id: "42" }),
    });
    expect(res.status).toBe(200);
    expect(simulateContractCall).toHaveBeenCalledTimes(1);
  });
});

describe("GET /api/payments/[id] — record (cuid) id validation", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 400 VALIDATION_ERROR for a malformed id and never queries the database", async () => {
    const res = await getPayment(
      makeRequest("http://localhost/api/payments/../etc/passwd"),
      { params: Promise.resolve({ id: "../etc/passwd" }) },
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(prisma.payment.findFirst).not.toHaveBeenCalled();
  });

  it("proceeds to the database lookup for a valid cuid", async () => {
    const res = await getPayment(
      makeRequest(`http://localhost/api/payments/${VALID_CUID}`),
      { params: Promise.resolve({ id: VALID_CUID }) },
    );
    expect(res.status).toBe(200);
    expect(prisma.payment.findFirst).toHaveBeenCalledTimes(1);
  });
});