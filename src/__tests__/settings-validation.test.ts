// SPDX-License-Identifier: MIT

import { beforeEach,describe, expect, it, vi } from "vitest";

import { GET, POST } from "@/app/api/settings/route";
import { generateCsrfToken } from "@/lib/csrf";
import {
  isValidRpcEndpoint,
  rpcEndpointSchema,
  updateSettingsSchema,
} from "@/lib/validation/settings";

vi.mock("@/lib/auth-session", () => ({
  getAuthContext: vi.fn(),
}));

import { getAuthContext } from "@/lib/auth-session";

const authMock = vi.mocked(getAuthContext);

function makePostRequest(body: unknown, token?: string): Request {
  const csrfToken = token ?? generateCsrfToken();
  return new Request("http://localhost/api/settings", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-csrf-token": csrfToken,
      cookie: `__Host-csrf=${csrfToken}`,
    },
    body: JSON.stringify(body),
  });
}

describe("Custom RPC Endpoint Validation (#1957)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ userId: "user-123" } as never);
  });

  describe("isValidRpcEndpoint", () => {
    it("accepts valid https and wss RPC URLs in production mode", () => {
      expect(
        isValidRpcEndpoint("https://soroban-testnet.stellar.org:443", "production")
      ).toBe(true);
      expect(
        isValidRpcEndpoint("https://mainnet.soroban.rpc.com/v1", "production")
      ).toBe(true);
      expect(
        isValidRpcEndpoint("wss://soroban-testnet.stellar.org/events", "production")
      ).toBe(true);
    });

    it("rejects non-https/wss schemes in production", () => {
      expect(isValidRpcEndpoint("http://soroban-rpc.org", "production")).toBe(false);
      expect(isValidRpcEndpoint("ws://soroban-rpc.org", "production")).toBe(false);
      expect(isValidRpcEndpoint("ftp://soroban-rpc.org", "production")).toBe(false);
      expect(isValidRpcEndpoint("javascript:alert(1)", "production")).toBe(false);
      expect(isValidRpcEndpoint("file:///etc/passwd", "production")).toBe(false);
      expect(isValidRpcEndpoint("data:text/plain;base64,123", "production")).toBe(false);
    });

    it("rejects loopback and private network destinations in production mode", () => {
      expect(isValidRpcEndpoint("https://localhost:8000", "production")).toBe(false);
      expect(isValidRpcEndpoint("https://127.0.0.1:8000", "production")).toBe(false);
      expect(isValidRpcEndpoint("https://10.0.0.5:8000", "production")).toBe(false);
      expect(isValidRpcEndpoint("https://192.168.1.1:8000", "production")).toBe(false);
      expect(isValidRpcEndpoint("https://172.16.0.1:8000", "production")).toBe(false);
      expect(isValidRpcEndpoint("https://169.254.169.254", "production")).toBe(false);
      expect(isValidRpcEndpoint("https://[::1]:8000", "production")).toBe(false);
    });

    it("rejects URLs with embedded credentials", () => {
      expect(
        isValidRpcEndpoint("https://admin:secret@soroban-rpc.org", "production")
      ).toBe(false);
    });

    it("allows loopback http/ws endpoints only in development mode", () => {
      expect(isValidRpcEndpoint("http://localhost:8000", "development")).toBe(true);
      expect(isValidRpcEndpoint("http://127.0.0.1:8000", "development")).toBe(true);
      expect(isValidRpcEndpoint("ws://localhost:8000", "development")).toBe(true);
      // Non-localhost http in development is still rejected
      expect(isValidRpcEndpoint("http://external-node.org", "development")).toBe(false);
    });

    it("rejects malformed or unparseable URLs", () => {
      expect(isValidRpcEndpoint("not-a-url")).toBe(false);
      expect(isValidRpcEndpoint("")).toBe(false);
    });
  });

  describe("rpcEndpointSchema & updateSettingsSchema", () => {
    it("parses valid RPC endpoints successfully", () => {
      const parsed = rpcEndpointSchema.safeParse("https://soroban-testnet.stellar.org:443");
      expect(parsed.success).toBe(true);
    });

    it("fails validation for invalid schemes", () => {
      const parsed = rpcEndpointSchema.safeParse("http://insecure-rpc.com");
      expect(parsed.success).toBe(false);
    });

    it("validates updateSettingsSchema with customRpcUrl", () => {
      const parsed = updateSettingsSchema.safeParse({
        customRpcUrl: "https://soroban-testnet.stellar.org",
        network: "TESTNET",
      });
      expect(parsed.success).toBe(true);
    });
  });

  describe("/api/settings Route Integration", () => {
    it("GET /api/settings returns active configuration and permitted schemes", async () => {
      const res = await GET(new Request("http://localhost/api/settings"));
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.permittedSchemes).toEqual(["https", "wss"]);
      expect(typeof json.data.rpcUrl).toBe("string");
    });

    it("POST /api/settings returns 401 when unauthenticated", async () => {
      authMock.mockResolvedValueOnce(null);
      const req = makePostRequest({ customRpcUrl: "https://soroban-rpc.org" });
      const res = await POST(req);
      expect(res.status).toBe(401);
    });

    it("POST /api/settings rejects invalid scheme with 400 Bad Request", async () => {
      const req = makePostRequest({ customRpcUrl: "http://insecure-endpoint.com" });
      const res = await POST(req);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error.message).toContain("scheme");
    });

    it("POST /api/settings accepts valid HTTPS custom RPC URL", async () => {
      const req = makePostRequest({
        customRpcUrl: "https://soroban.mycustomnode.com:443",
        network: "TESTNET",
      });
      const res = await POST(req);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.updated).toBe(true);
      expect(json.data.settings.customRpcUrl).toBe("https://soroban.mycustomnode.com:443");
    });
  });
});
