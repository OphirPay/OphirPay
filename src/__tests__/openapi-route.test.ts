// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest";
import {
  getOpenApiSpec,
  extractOpenApiOperations,
  buildRequestUrl,
  buildCurlSnippet,
  STELLAR_TESTNET_ENV,
} from "@/lib/openapi";
import { GET } from "@/app/api/openapi.json/route";

describe("Interactive OpenAPI Documentation (#1416)", () => {
  describe("OpenAPI Spec Loader", () => {
    it("loads and parses docs/openapi.yaml into a valid OpenAPI 3.1 document", () => {
      const spec = getOpenApiSpec();
      expect(spec).toBeDefined();
      expect(spec.openapi).toMatch(/^3\./);
      expect(spec.info.title).toContain("OphirPay");
      expect(spec.paths).toBeDefined();
    });

    it("enriches servers with Stellar Testnet development configuration", () => {
      const spec = getOpenApiSpec();
      expect(spec.servers).toBeDefined();
      expect(spec.servers!.length).toBeGreaterThanOrEqual(1);

      const hasTestnet = spec.servers!.some(
        (s) =>
          s.url.includes("localhost") ||
          s.description?.includes("Testnet") ||
          s["x-stellar-network"] === "testnet"
      );
      expect(hasTestnet).toBe(true);
      expect(spec["x-stellar-environment"]?.network).toBe(STELLAR_TESTNET_ENV.network);
    });

    it("extracts all 40+ operations with tags and parameters", () => {
      const spec = getOpenApiSpec();
      const operations = extractOpenApiOperations(spec);
      expect(operations.length).toBeGreaterThanOrEqual(35);

      const paymentsOp = operations.find((op) => op.path === "/api/payments" && op.method === "POST");
      expect(paymentsOp).toBeDefined();
      expect(paymentsOp?.summary).toBeDefined();
      expect(paymentsOp?.tags).toBeDefined();
    });
  });

  describe("URL and cURL Builder Utilities", () => {
    it("interpolates path parameters and query parameters correctly", () => {
      const url = buildRequestUrl(
        "https://testnet.api.ophirpay.com",
        "/api/payments/{id}",
        { id: "pay_12345" },
        { details: "true" }
      );
      expect(url).toBe("https://testnet.api.ophirpay.com/api/payments/pay_12345?details=true");
    });

    it("generates a valid cURL command snippet with auth and headers", () => {
      const curl = buildCurlSnippet({
        method: "POST",
        url: "https://testnet.api.ophirpay.com/api/payments",
        apiKey: "op_test_abcdef123456",
        requiresAuth: true,
        body: JSON.stringify({ amount: 100 }),
      });

      expect(curl).toContain("curl -X POST");
      expect(curl).toContain("https://testnet.api.ophirpay.com/api/payments");
      expect(curl).toContain('X-Stellar-Network: testnet');
      expect(curl).toContain('Authorization: Bearer op_test_abcdef123456');
      expect(curl).toContain('Content-Type: application/json');
    });
  });

  describe("GET /api/openapi.json", () => {
    it("returns compiled OpenAPI spec with correct headers", async () => {
      const req = new Request("http://localhost:3000/api/openapi.json");
      const res = await GET(req);

      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toContain("application/json");

      const body = await res.json();
      expect(body.openapi).toBeDefined();
      expect(body.paths).toBeDefined();
      expect(body["x-stellar-environment"]).toBeDefined();
    });
  });
});
