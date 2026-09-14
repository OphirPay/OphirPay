// SPDX-License-Identifier: MIT

import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET, PATCH } from "@/app/api/webhooks/route";
import { generateCsrfToken } from "@/lib/csrf";

vi.mock("@/lib/prisma", () => ({
  default: {
    webhook: {
      findMany: vi.fn(),
      create: vi.fn(),
      deleteMany: vi.fn(),
      updateMany: vi.fn(),
    },
  },
}));

vi.mock("@/lib/auth-session", () => ({
  getAuthContext: vi.fn(),
}));

import prisma from "@/lib/prisma";
import { getAuthContext } from "@/lib/auth-session";

const authMock = vi.mocked(getAuthContext);
const updateManyMock = vi.mocked(prisma.webhook.updateMany);
const findManyMock = vi.mocked(prisma.webhook.findMany);

function authedPatchRequest(id: string | null): Request {
  const token = generateCsrfToken();
  const url = `http://localhost/api/webhooks${id ? `?id=${id}` : ""}`;
  return new Request(url, {
    method: "PATCH",
    headers: {
      "x-csrf-token": token,
      cookie: `__Host-csrf=${token}`,
    },
  });
}

beforeEach(() => {
  authMock.mockReset();
  updateManyMock.mockReset();
  findManyMock.mockReset();
  authMock.mockResolvedValue({ userId: "user-1" });
});

describe("PATCH /api/webhooks (rotate secret)", () => {
  it("rotates the secret, returns it once, and stores the new value", async () => {
    updateManyMock.mockResolvedValue({ count: 1 });

    const res = await PATCH(authedPatchRequest("wh-1"));
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.data.id).toBe("wh-1");
    expect(typeof body.data.secret).toBe("string");
    // 32 random bytes → 64 hex chars
    expect(body.data.secret).toMatch(/^[0-9a-f]{64}$/);

    // The stored secret is the new one (old secret is replaced/revoked)
    expect(updateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "wh-1", userId: "user-1" },
        data: { secret: body.data.secret },
      })
    );
  });

  it("replaces (revokes) the previously stored secret", async () => {
    const oldSecret = "a".repeat(64);
    updateManyMock.mockResolvedValue({ count: 1 });

    await PATCH(authedPatchRequest("wh-1"));

    const args = updateManyMock.mock.calls[0]?.[0] as {
      data: { secret: string };
    };
    expect(args.data.secret).not.toBe(oldSecret);
    expect(args.data.secret.length).toBe(64);
  });

  it("is scoped to the authenticated user's webhook", async () => {
    updateManyMock.mockResolvedValue({ count: 1 });

    await PATCH(authedPatchRequest("wh-1"));

    expect(updateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "wh-1", userId: "user-1" } })
    );
  });

  it("returns 400 when the webhook is not found (not owned by the user)", async () => {
    updateManyMock.mockResolvedValue({ count: 0 });

    const res = await PATCH(authedPatchRequest("someone-elses-webhook"));
    expect(res.status).toBe(400);
    expect(updateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "someone-elses-webhook", userId: "user-1" },
      })
    );
  });

  it("returns 400 when the id is missing", async () => {
    const res = await PATCH(authedPatchRequest(null));
    expect(res.status).toBe(400);
    expect(updateManyMock).not.toHaveBeenCalled();
  });

  it("returns 401 when unauthenticated", async () => {
    authMock.mockResolvedValue(null);

    const res = await PATCH(authedPatchRequest("wh-1"));
    expect(res.status).toBe(401);
    expect(updateManyMock).not.toHaveBeenCalled();
  });

  it("returns 403 when the CSRF token is missing", async () => {
    const res = await PATCH(
      new Request("http://localhost/api/webhooks?id=wh-1", { method: "PATCH" })
    );
    expect(res.status).toBe(403);
    expect(updateManyMock).not.toHaveBeenCalled();
  });
});

describe("GET /api/webhooks (secret redaction)", () => {
  it("never returns the stored secret", async () => {
    findManyMock.mockResolvedValue([
      {
        id: "wh-1",
        userId: "user-1",
        url: "https://hook.example.com/a",
        events: "[]",
        isActive: true,
        secret: "a".repeat(64),
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);

    const res = await GET(new Request("http://localhost/api/webhooks"));
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0].secret).toBeUndefined();
    expect(body.data[0].hasSecret).toBe(true);
  });
});
