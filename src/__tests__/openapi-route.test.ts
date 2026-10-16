// SPDX-License-Identifier: MIT
import { describe, it, expect } from "vitest";
import { GET } from "@/app/api/openapi.json/route";

describe("OpenAPI JSON route handler", () => {
  it("serves parsed OpenAPI specification from docs/openapi.yaml", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/json");

    const json = await res.json();
    expect(json.openapi).toMatch(/^3\./);
    expect(json.info.title).toBe("OphirPay API");
    expect(json.paths).toBeDefined();
    expect(Object.keys(json.paths).length).toBeGreaterThan(10);
  });
});
