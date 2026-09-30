// SPDX-License-Identifier: MIT

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findFirst: vi.fn(),
  updateMany: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  auditCreate: vi.fn(),
  transaction: vi.fn(),
  getAuthContext: vi.fn(),
  verifyCsrf: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  default: { $transaction: mocks.transaction },
}));
vi.mock("@/lib/auth-session", () => ({
  getAuthContext: mocks.getAuthContext,
}));
vi.mock("@/lib/csrf", () => ({
  verifyCsrf: mocks.verifyCsrf,
}));

import { POST } from "@/app/api/keys/[id]/rotate/route";

const tx = {
  apiKey: {
    findFirst: mocks.findFirst,
    updateMany: mocks.updateMany,
    create: mocks.create,
    update: mocks.update,
  },
  auditLog: { create: mocks.auditCreate },
};

describe("POST /api/keys/[id]/rotate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAuthContext.mockResolvedValue({ userId: "user_1" });
    mocks.verifyCsrf.mockReturnValue(null);
    mocks.findFirst.mockResolvedValue({
      id: "old_key",
      name: "Production",
      prefix: "oph_old",
      scopes: ["read:payments", "write:payments"],
      expiresAt: null,
    });
    mocks.updateMany.mockResolvedValue({ count: 1 });
    mocks.create.mockResolvedValue({ id: "replacement_key" });
    mocks.update.mockResolvedValue({ id: "old_key" });
    mocks.auditCreate.mockResolvedValue({});
    mocks.transaction.mockImplementation(
      (callback: (transaction: typeof tx) => Promise<unknown>) => callback(tx),
    );
  });

  it("creates a scoped replacement atomically with a 24-hour overlap", async () => {
    const before = Date.now();
    const response = await POST(
      new Request("http://localhost/api/keys/old_key/rotate", { method: "POST" }),
      { params: Promise.resolve({ id: "old_key" }) },
    );
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.data).toMatchObject({
      id: "replacement_key",
      name: "Production",
      scopes: ["read:payments", "write:payments"],
      previousPrefix: "oph_old",
    });
    expect(body.data.key).toMatch(/^oph_[a-f0-9]{64}$/);
    expect(new Date(body.data.previousKeyValidUntil).getTime()).toBeGreaterThanOrEqual(
      before + 24 * 60 * 60 * 1000 - 1000,
    );
    expect(mocks.updateMany).toHaveBeenCalledWith({
      where: {
        id: "old_key",
        userId: "user_1",
        revokedAt: null,
        rotatedAt: null,
      },
      data: expect.objectContaining({ rotatedAt: expect.any(Date), expiresAt: expect.any(Date) }),
    });
    expect(mocks.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        name: "Production",
        userId: "user_1",
        scopes: ["read:payments", "write:payments"],
      }),
      select: { id: true },
    });
    expect(mocks.auditCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "api_key:rotate",
        actor: "user_1",
        target: "old_key",
      }),
    });
    expect(JSON.stringify(body)).not.toContain("v1:");
  });

  it("caps the overlap at the previous key's existing expiry", async () => {
    const originalExpiry = new Date(Date.now() + 60 * 60 * 1000);
    mocks.findFirst.mockResolvedValueOnce({
      id: "old_key",
      name: "Production",
      prefix: "oph_old",
      scopes: [],
      expiresAt: originalExpiry,
    });

    const response = await POST(
      new Request("http://localhost/api/keys/old_key/rotate", { method: "POST" }),
      { params: Promise.resolve({ id: "old_key" }) },
    );
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(new Date(body.data.previousKeyValidUntil).getTime()).toBe(originalExpiry.getTime());
  });

  it("does not create a replacement if the old key was concurrently rotated", async () => {
    mocks.updateMany.mockResolvedValueOnce({ count: 0 });

    const response = await POST(
      new Request("http://localhost/api/keys/old_key/rotate", { method: "POST" }),
      { params: Promise.resolve({ id: "old_key" }) },
    );

    expect(response.status).toBe(400);
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.auditCreate).not.toHaveBeenCalled();
  });
});
