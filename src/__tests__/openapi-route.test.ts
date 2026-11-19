// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest";
import { GET } from "@/app/api/openapi.json/route";

describe("GET /api/openapi.json", () => {
  it("serves the OpenAPI specification with 200 OK and JSON content-type", async () => {
    const req = new Request("http://localhost:3000/api/openapi.json", {
      method: "GET",
    });

    const res = await GET(req, { params: Promise.resolve({}) });
    expect(res.status).toBe(200);

    const contentType = res.headers.get("content-type");
    expect(contentType).toContain("application/json");

    const cacheControl = res.headers.get("cache-control");
    expect(cacheControl).toContain("public");
    expect(cacheControl).toContain("max-age=");

    const data = (await res.json()) as Record<string, unknown>;
    expect(data).toBeDefined();
    expect(data.openapi).toBe("3.1.0");

    const info = data.info as Record<string, unknown> | undefined;
    expect(info?.title).toBe("OphirPay API");
    expect(info?.version).toBe("0.1.0");
  });

  it("includes Stellar testnet endpoints in the servers list", async () => {
    const req = new Request("http://localhost:3000/api/openapi.json", {
      method: "GET",
    });

    const res = await GET(req, { params: Promise.resolve({}) });
    const data = (await res.json()) as { servers?: Array<{ url: string; description?: string }> };

    expect(data.servers).toBeDefined();
    expect(Array.isArray(data.servers)).toBe(true);

    const urls = data.servers?.map((s) => s.url) ?? [];
    expect(urls).toContain("http://localhost:3000");
    expect(urls).toContain("https://api.ophirpay.com");
    expect(urls).toContain("https://soroban-testnet.stellar.org");
    expect(urls).toContain("https://horizon-testnet.stellar.org");
  });

  it("documents /api/openapi.json under Documentation tag", async () => {
    const req = new Request("http://localhost:3000/api/openapi.json", {
      method: "GET",
    });

    const res = await GET(req, { params: Promise.resolve({}) });
    const data = (await res.json()) as {
      paths?: Record<string, Record<string, { tags?: string[]; summary?: string }>>;
    };

    expect(data.paths).toBeDefined();
    const openapiRoute = data.paths?.["/api/openapi.json"];
    expect(openapiRoute).toBeDefined();
    expect(openapiRoute?.get).toBeDefined();
    expect(openapiRoute?.get?.tags).toContain("Documentation");
  });

  it("declares standard OphirPay security schemes", async () => {
    const req = new Request("http://localhost:3000/api/openapi.json", {
      method: "GET",
    });

    const res = await GET(req, { params: Promise.resolve({}) });
    const data = (await res.json()) as {
      components?: {
        securitySchemes?: Record<string, unknown>;
      };
    };

    expect(data.components?.securitySchemes).toBeDefined();
    expect(data.components?.securitySchemes?.ApiKeyAuth).toBeDefined();
    expect(data.components?.securitySchemes?.BearerAuth).toBeDefined();
  });
});
