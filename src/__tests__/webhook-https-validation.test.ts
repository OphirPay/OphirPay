// SPDX-License-Identifier: MIT

import { beforeEach,describe, expect, it, vi } from "vitest";

import { POST } from "@/app/api/webhooks/route";
import { generateCsrfToken } from "@/lib/csrf";
import {
  createWebhookSchema,
  isAllowedWebhookProtocol,
  webhookUrlSchema,
} from "@/lib/validation/webhook";

vi.mock("@/lib/prisma", () => ({
  default: {
    webhook: {
      create: vi.fn(),
      findMany: vi.fn(),
    },
  },
}));

vi.mock("@/lib/auth-session", () => ({
  getAuthContext: vi.fn(),
}));

import { getAuthContext } from "@/lib/auth-session";
import prisma from "@/lib/prisma";

const authMock = vi.mocked(getAuthContext);
const webhookCreateMock = vi.mocked(prisma.webhook.create);

function makeWebhookPostRequest(body: unknown): Request {
  const token = generateCsrfToken();
  return new Request("http://localhost/api/webhooks", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-csrf-token": token,
      cookie: `__Host-csrf=${token}`,
    },
    body: JSON.stringify(body),
  });
}

describe("Webhook HTTPS Protocol Enforcement (#1954)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ userId: "user-123" } as never);
    webhookCreateMock.mockResolvedValue({
      id: "wh-1",
      url: "https://example.com/webhook",
      events: "[]",
      isActive: true,
      secret: "mock_secret",
      userId: "user-123",
      createdAt: new Date(),
      updatedAt: new Date(),
    } as never);
  });

  describe("isAllowedWebhookProtocol", () => {
    it("accepts valid https URLs in production", () => {
      expect(
        isAllowedWebhookProtocol("https://api.example.com/webhook", "production")
      ).toBe(true);
      expect(
        isAllowedWebhookProtocol("https://hooks.slack.com/services/xyz", "production")
      ).toBe(true);
    });

    it("rejects plain http URLs in production", () => {
      expect(
        isAllowedWebhookProtocol("http://api.example.com/webhook", "production")
      ).toBe(false);
      expect(
        isAllowedWebhookProtocol("http://198.51.100.10/webhook", "production")
      ).toBe(false);
    });

    it("rejects non-http/https schemes regardless of environment", () => {
      expect(
        isAllowedWebhookProtocol("ftp://files.example.com/webhook", "development")
      ).toBe(false);
      expect(
        isAllowedWebhookProtocol("javascript:alert(1)", "development")
      ).toBe(false);
      expect(
        isAllowedWebhookProtocol("file:///etc/passwd", "development")
      ).toBe(false);
      expect(
        isAllowedWebhookProtocol("data:text/plain;base64,123", "development")
      ).toBe(false);
    });

    it("allows http localhost and loopback in development mode", () => {
      expect(
        isAllowedWebhookProtocol("http://localhost:3000/webhook", "development")
      ).toBe(true);
      expect(
        isAllowedWebhookProtocol("http://127.0.0.1:8080/webhook", "development")
      ).toBe(true);
      expect(
        isAllowedWebhookProtocol("http://[::1]:9000/webhook", "development")
      ).toBe(true);
    });

    it("rejects non-loopback http endpoints even in development mode", () => {
      expect(
        isAllowedWebhookProtocol("http://insecure-domain.com/webhook", "development")
      ).toBe(false);
    });

    it("rejects malformed URLs", () => {
      expect(isAllowedWebhookProtocol("not-a-url")).toBe(false);
      expect(isAllowedWebhookProtocol("")).toBe(false);
    });
  });

  describe("createWebhookSchema", () => {
    it("validates webhookUrlSchema directly", () => {
      expect(webhookUrlSchema.safeParse("https://example.com/hook").success).toBe(true);
      expect(webhookUrlSchema.safeParse("not-a-url").success).toBe(false);
    });

    it("accepts HTTPS destination URLs", () => {
      const parsed = createWebhookSchema.safeParse({
        url: "https://example.com/webhook",
        events: ["payment.created"],
      });
      expect(parsed.success).toBe(true);
    });

    it("rejects plain HTTP destination URLs with actionable error in production", () => {
      vi.stubEnv("NODE_ENV", "production");
      try {
        const parsed = createWebhookSchema.safeParse({
          url: "http://example.com/webhook",
          events: ["payment.created"],
        });
        expect(parsed.success).toBe(false);
        if (!parsed.success) {
          expect(parsed.error.issues[0]?.message).toContain("https://");
        }
      } finally {
        vi.unstubAllEnvs();
      }
    });
  });

  describe("POST /api/webhooks Route Integration", () => {
    it("returns 401 when unauthenticated", async () => {
      authMock.mockResolvedValueOnce(null);
      const req = makeWebhookPostRequest({
        url: "https://example.com/webhook",
        events: [],
      });
      const res = await POST(req);
      expect(res.status).toBe(401);
    });

    it("rejects plain HTTP URL with 400 Bad Request in production", async () => {
      vi.stubEnv("NODE_ENV", "production");
      try {
        const req = makeWebhookPostRequest({
          url: "http://example.com/webhook",
          events: ["payment.created"],
        });
        const res = await POST(req);
        expect(res.status).toBe(400);
        const json = await res.json();
        expect(json.success).toBe(false);
        expect(json.error.message).toContain("https://");
      } finally {
        vi.unstubAllEnvs();
      }
    });

    it("accepts valid HTTPS webhook endpoint and returns 201 Created", async () => {
      const req = makeWebhookPostRequest({
        url: "https://example.com/webhook",
        events: ["payment.created"],
        isActive: true,
      });
      const res = await POST(req);
      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.url).toBe("https://example.com/webhook");
    });
  });
});
