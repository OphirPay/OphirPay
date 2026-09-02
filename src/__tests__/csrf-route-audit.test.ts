// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest";
import { CSRF_ROUTE_AUDIT, findUnprotectedRoutes } from "@/lib/csrf";

describe("CSRF Route Audit", () => {
  it("documents all API routes", () => {
    expect(Object.keys(CSRF_ROUTE_AUDIT).length).toBeGreaterThan(0);
  });

  it("has no unprotected mutating routes", () => {
    const unprotected = findUnprotectedRoutes();
    expect(unprotected).toEqual([]);
  });

  it("protects all session mutations", () => {
    expect(CSRF_ROUTE_AUDIT["/api/auth/session"].POST).toBe(true);
    expect(CSRF_ROUTE_AUDIT["/api/auth/session"].DELETE).toBe(true);
  });

  it("protects all mutating methods", () => {
    const mutatingMethods = ["POST", "PATCH", "DELETE", "PUT"];
    
    for (const [path, methods] of Object.entries(CSRF_ROUTE_AUDIT)) {
      for (const [method, isProtected] of Object.entries(methods)) {
        if (mutatingMethods.includes(method)) {
          expect(isProtected, `${method} ${path} should be protected`).toBe(true);
        }
      }
    }
  });
});