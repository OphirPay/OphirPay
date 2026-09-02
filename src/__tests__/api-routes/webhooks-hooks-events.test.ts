// SPDX-License-Identifier: MIT

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock dependencies
vi.mock("@/lib/prisma", () => ({
  default: {
    webhook: {
      findMany: vi.fn(),
      create: vi.fn(),
      deleteMany: vi.fn(),
    },
    notificationHook: {
      findMany: vi.fn(),
      create: vi.fn(),
      updateMany: vi.fn(),
    },
  },
}));

vi.mock("@/lib/auth-session", () => ({
  getAuthContext: vi.fn(),
}));

vi.mock("@/lib/csrf", () => ({
  verifyCsrf: vi.fn().mockReturnValue(null),
}));

vi.mock("@/lib/contracts", () => ({
  EMITTER_CONTRACT_ID: "CBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
  CHAIN_READ_SOURCE: "GACNKEDGJYLLVQDXWYEEPB47Y3JEV5JNZ3RQANTJIVKKEOXX4NC4YWHU",
  fetchOnChainPayments: vi.fn(),
}));

import prisma from "@/lib/prisma";
import * as authSession from "@/lib/auth-session";
import * as csrf from "@/lib/csrf";
import * as contracts from "@/lib/contracts";
import {
  GET as getWebhooks,
  POST as postWebhooks,
  DELETE as deleteWebhooks,
} from "@/app/api/webhooks/route";
import { GET as getHooks, POST as postHooks } from "@/app/api/hooks/route";
import { PATCH as patchHookById } from "@/app/api/hooks/[id]/route";
import { GET as getEvents } from "@/app/api/events/route";
import { GET as getEventsHistory } from "@/app/api/events/history/route";

const MOCK_AUTH = {
  userId: "user_123",
  publicKey: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
};

describe("API Routes: Webhooks, Hooks & Events", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(csrf.verifyCsrf).mockReturnValue(null);
  });

  describe("/api/webhooks", () => {
    it("GET returns 401 when unauthenticated", async () => {
      vi.mocked(authSession.getAuthContext).mockResolvedValueOnce(null);
      const res = await getWebhooks(new Request("http://localhost/api/webhooks"));
      expect(res.status).toBe(401);
    });

    it("GET returns list of webhooks with masked secret", async () => {
      vi.mocked(authSession.getAuthContext).mockResolvedValueOnce(MOCK_AUTH);
      vi.mocked(prisma.webhook.findMany).mockResolvedValueOnce([
        {
          id: "wh_1",
          url: "https://example.com/wh",
          secret: "supersecret",
          events: "[]",
          isActive: true,
        },
      ] as never);

      const res = await getWebhooks(new Request("http://localhost/api/webhooks"));
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.data).toHaveLength(1);
      expect(data.data[0].hasSecret).toBe(true);
      expect(data.data[0].secret).toBeUndefined();
    });

    it("POST returns 403 on CSRF failure", async () => {
      vi.mocked(csrf.verifyCsrf).mockReturnValueOnce(
        new Response(JSON.stringify({ success: false, error: { message: "CSRF token invalid" } }), {
          status: 403,
        })
      );
      const res = await postWebhooks(
        new Request("http://localhost/api/webhooks", { method: "POST" })
      );
      expect(res.status).toBe(403);
    });

    it("POST returns 401 when unauthenticated", async () => {
      vi.mocked(authSession.getAuthContext).mockResolvedValueOnce(null);
      const res = await postWebhooks(
        new Request("http://localhost/api/webhooks", {
          method: "POST",
          body: JSON.stringify({ url: "https://example.com/webhook", events: ["payment.created"] }),
        })
      );
      expect(res.status).toBe(401);
    });

    it("POST returns 400 when body fails schema validation", async () => {
      vi.mocked(authSession.getAuthContext).mockResolvedValueOnce(MOCK_AUTH);
      const res = await postWebhooks(
        new Request("http://localhost/api/webhooks", {
          method: "POST",
          body: JSON.stringify({ url: "invalid-url", events: [] }),
        })
      );
      expect(res.status).toBe(400);
    });

    it("POST returns 400 when webhook URL is not safe (e.g. localhost)", async () => {
      vi.mocked(authSession.getAuthContext).mockResolvedValueOnce(MOCK_AUTH);
      const res = await postWebhooks(
        new Request("http://localhost/api/webhooks", {
          method: "POST",
          body: JSON.stringify({ url: "http://localhost:3000/hook", events: ["payment.created"] }),
        })
      );
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error.message).toContain("public http(s) endpoint");
    });

    it("POST creates a webhook successfully", async () => {
      vi.mocked(authSession.getAuthContext).mockResolvedValueOnce(MOCK_AUTH);
      const mockCreated = {
        id: "wh_new",
        url: "https://example.com/webhook",
        events: '["payment.created"]',
        isActive: true,
      };
      vi.mocked(prisma.webhook.create).mockResolvedValueOnce(mockCreated as never);

      const res = await postWebhooks(
        new Request("http://localhost/api/webhooks", {
          method: "POST",
          body: JSON.stringify({ url: "https://example.com/webhook", events: ["payment.created"] }),
        })
      );
      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.data.id).toBe("wh_new");
      expect(data.data.secret).toBeDefined();
    });

    it("DELETE returns 403 on CSRF failure", async () => {
      vi.mocked(csrf.verifyCsrf).mockReturnValueOnce(
        new Response(JSON.stringify({ success: false, error: { message: "CSRF token invalid" } }), {
          status: 403,
        })
      );
      const res = await deleteWebhooks(
        new Request("http://localhost/api/webhooks?id=wh_1", { method: "DELETE" })
      );
      expect(res.status).toBe(403);
    });

    it("DELETE returns 401 when unauthenticated", async () => {
      vi.mocked(authSession.getAuthContext).mockResolvedValueOnce(null);
      const res = await deleteWebhooks(
        new Request("http://localhost/api/webhooks?id=wh_1", { method: "DELETE" })
      );
      expect(res.status).toBe(401);
    });

    it("DELETE returns 400 when id param is missing", async () => {
      vi.mocked(authSession.getAuthContext).mockResolvedValueOnce(MOCK_AUTH);
      const res = await deleteWebhooks(
        new Request("http://localhost/api/webhooks", { method: "DELETE" })
      );
      expect(res.status).toBe(400);
    });

    it("DELETE returns 400 when webhook is not found", async () => {
      vi.mocked(authSession.getAuthContext).mockResolvedValueOnce(MOCK_AUTH);
      vi.mocked(prisma.webhook.deleteMany).mockResolvedValueOnce({ count: 0 });

      const res = await deleteWebhooks(
        new Request("http://localhost/api/webhooks?id=wh_none", { method: "DELETE" })
      );
      expect(res.status).toBe(400);
    });

    it("DELETE deletes webhook successfully", async () => {
      vi.mocked(authSession.getAuthContext).mockResolvedValueOnce(MOCK_AUTH);
      vi.mocked(prisma.webhook.deleteMany).mockResolvedValueOnce({ count: 1 });

      const res = await deleteWebhooks(
        new Request("http://localhost/api/webhooks?id=wh_1", { method: "DELETE" })
      );
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.data.deleted).toBe(true);
    });
  });

  describe("/api/hooks", () => {
    it("GET returns 401 when unauthenticated", async () => {
      vi.mocked(authSession.getAuthContext).mockResolvedValueOnce(null);
      const res = await getHooks(new Request("http://localhost/api/hooks"));
      expect(res.status).toBe(401);
    });

    it("GET returns filtered active hooks list", async () => {
      vi.mocked(authSession.getAuthContext).mockResolvedValueOnce(MOCK_AUTH);
      vi.mocked(prisma.notificationHook.findMany).mockResolvedValueOnce([
        {
          id: "hk_1",
          eventType: "payment.created",
          webhookUrl: "https://example.com/wh",
          active: true,
        },
      ] as never);

      const res = await getHooks(
        new Request("http://localhost/api/hooks?event_type=payment.created")
      );
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.data).toHaveLength(1);
    });

    it("POST returns 403 on CSRF failure", async () => {
      vi.mocked(csrf.verifyCsrf).mockReturnValueOnce(
        new Response(JSON.stringify({ success: false, error: { message: "CSRF token invalid" } }), {
          status: 403,
        })
      );
      const res = await postHooks(new Request("http://localhost/api/hooks", { method: "POST" }));
      expect(res.status).toBe(403);
    });

    it("POST returns 400 when webhook URL is unsafe", async () => {
      vi.mocked(authSession.getAuthContext).mockResolvedValueOnce(MOCK_AUTH);
      const res = await postHooks(
        new Request("http://localhost/api/hooks", {
          method: "POST",
          body: JSON.stringify({
            eventType: "payment.created",
            webhookUrl: "http://127.0.0.1/hook",
          }),
        })
      );
      expect(res.status).toBe(400);
    });

    it("POST creates notification hook successfully", async () => {
      vi.mocked(authSession.getAuthContext).mockResolvedValueOnce(MOCK_AUTH);
      vi.mocked(prisma.notificationHook.create).mockResolvedValueOnce({
        id: "hk_new",
        eventType: "payment.created",
        webhookUrl: "https://example.com/hook",
        onChainId: 10,
        userId: "user_123",
      } as never);

      const res = await postHooks(
        new Request("http://localhost/api/hooks", {
          method: "POST",
          body: JSON.stringify({
            eventType: "payment.created",
            webhookUrl: "https://example.com/hook",
            onChainId: 10,
          }),
        })
      );
      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.data.id).toBe("hk_new");
    });
  });

  describe("PATCH /api/hooks/[id]", () => {
    it("returns 403 on CSRF failure", async () => {
      vi.mocked(csrf.verifyCsrf).mockReturnValueOnce(
        new Response(JSON.stringify({ success: false, error: { message: "CSRF token invalid" } }), {
          status: 403,
        })
      );
      const res = await patchHookById(
        new Request("http://localhost/api/hooks/hk_1", { method: "PATCH" }),
        {
          params: Promise.resolve({ id: "hk_1" }),
        }
      );
      expect(res.status).toBe(403);
    });

    it("returns 401 when unauthenticated", async () => {
      vi.mocked(authSession.getAuthContext).mockResolvedValueOnce(null);
      const res = await patchHookById(
        new Request("http://localhost/api/hooks/hk_1", {
          method: "PATCH",
          body: JSON.stringify({ active: false }),
        }),
        { params: Promise.resolve({ id: "hk_1" }) }
      );
      expect(res.status).toBe(401);
    });

    it("returns 400 when hook is not found", async () => {
      vi.mocked(authSession.getAuthContext).mockResolvedValueOnce(MOCK_AUTH);
      vi.mocked(prisma.notificationHook.updateMany).mockResolvedValueOnce({ count: 0 });

      const res = await patchHookById(
        new Request("http://localhost/api/hooks/hk_none", {
          method: "PATCH",
          body: JSON.stringify({ active: false }),
        }),
        { params: Promise.resolve({ id: "hk_none" }) }
      );
      expect(res.status).toBe(400);
    });

    it("updates hook status successfully", async () => {
      vi.mocked(authSession.getAuthContext).mockResolvedValueOnce(MOCK_AUTH);
      vi.mocked(prisma.notificationHook.updateMany).mockResolvedValueOnce({ count: 1 });

      const res = await patchHookById(
        new Request("http://localhost/api/hooks/hk_1", {
          method: "PATCH",
          body: JSON.stringify({ active: false }),
        }),
        { params: Promise.resolve({ id: "hk_1" }) }
      );
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.data.updated).toBe(true);
    });
  });

  describe("GET /api/events", () => {
    it("returns SSE response with event-stream content type", async () => {
      const res = await getEvents(new Request("http://localhost/api/events"));
      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toBe("text/event-stream");
      if (res.body) {
        await res.body.cancel();
      }
    });
  });

  describe("GET /api/events/history", () => {
    it("returns on-chain payment history list", async () => {
      vi.mocked(contracts.fetchOnChainPayments).mockResolvedValueOnce({
        payments: [
          {
            id: "1",
            payer: "G_PAYER",
            payee: "G_PAYEE",
            amountStroops: "10000000",
            txHash: "tx_123",
            timestamp: 1700000000,
            metadata: "test",
          },
        ],
        total: 1,
      } as never);

      const res = await getEventsHistory(
        new Request("http://localhost/api/events/history?limit=10")
      );
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.data.events).toHaveLength(1);
      expect(data.data.events[0].id).toBe("evt_1");
    });

    it("returns 500 when fetchOnChainPayments throws", async () => {
      vi.mocked(contracts.fetchOnChainPayments).mockRejectedValueOnce(new Error("RPC failed"));

      const res = await getEventsHistory(new Request("http://localhost/api/events/history"));
      expect(res.status).toBe(500);
    });
  });
});
