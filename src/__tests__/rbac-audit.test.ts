import { describe, expect, it } from "vitest";

export type Role = "ADMIN" | "TREASURER" | "OPERATOR" | "AUDITOR" | "VIEWER" | "ANONYMOUS";

export interface RoutePermissionRule {
  path: string;
  method: "GET" | "POST" | "PUT" | "DELETE";
  isStateChanging: boolean;
  allowedRoles: Role[];
}

export const ROUTE_PERMISSIONS: RoutePermissionRule[] = [
  // Admin only
  {
    path: "/api/rbac/grant",
    method: "POST",
    isStateChanging: true,
    allowedRoles: ["ADMIN"],
  },
  {
    path: "/api/rbac/revoke",
    method: "POST",
    isStateChanging: true,
    allowedRoles: ["ADMIN"],
  },
  {
    path: "/api/fee-config",
    method: "POST",
    isStateChanging: true,
    allowedRoles: ["ADMIN"],
  },
  {
    path: "/api/keys",
    method: "POST",
    isStateChanging: true,
    allowedRoles: ["ADMIN"],
  },

  // Treasurer + Admin
  {
    path: "/api/refunds",
    method: "POST",
    isStateChanging: true,
    allowedRoles: ["ADMIN", "TREASURER"],
  },
  {
    path: "/api/multisig/propose",
    method: "POST",
    isStateChanging: true,
    allowedRoles: ["ADMIN", "TREASURER"],
  },
  {
    path: "/api/escrows/release",
    method: "POST",
    isStateChanging: true,
    allowedRoles: ["ADMIN", "TREASURER"],
  },

  // Operator + Treasurer + Admin
  {
    path: "/api/payments",
    method: "POST",
    isStateChanging: true,
    allowedRoles: ["ADMIN", "TREASURER", "OPERATOR"],
  },
  {
    path: "/api/payments/retry",
    method: "POST",
    isStateChanging: true,
    allowedRoles: ["ADMIN", "TREASURER", "OPERATOR"],
  },
  {
    path: "/api/batches",
    method: "POST",
    isStateChanging: true,
    allowedRoles: ["ADMIN", "TREASURER", "OPERATOR"],
  },
  {
    path: "/api/escrows/create",
    method: "POST",
    isStateChanging: true,
    allowedRoles: ["ADMIN", "TREASURER", "OPERATOR"],
  },

  // Read-only / Public routes
  {
    path: "/api/health",
    method: "GET",
    isStateChanging: false,
    allowedRoles: ["ADMIN", "TREASURER", "OPERATOR", "AUDITOR", "VIEWER", "ANONYMOUS"],
  },
  {
    path: "/api/audit-log",
    method: "GET",
    isStateChanging: false,
    allowedRoles: ["ADMIN", "TREASURER", "OPERATOR", "AUDITOR"],
  },
];

export function checkRouteAccess(
  path: string,
  method: "GET" | "POST" | "PUT" | "DELETE",
  callerRole: Role,
): { allowed: boolean; statusCode: number; error?: string } {
  const rule = ROUTE_PERMISSIONS.find((r) => r.path === path && r.method === method);

  if (!rule) {
    return { allowed: false, statusCode: 404, error: "NOT_FOUND" };
  }

  if (callerRole === "ANONYMOUS" && !rule.allowedRoles.includes("ANONYMOUS")) {
    return { allowed: false, statusCode: 401, error: "UNAUTHORIZED" };
  }

  if (!rule.allowedRoles.includes(callerRole)) {
    return { allowed: false, statusCode: 403, error: "FORBIDDEN" };
  }

  return { allowed: true, statusCode: 200 };
}

describe("RBAC Enforcement Audit Suite (#392)", () => {
  it("strictly prohibits state-changing operations for ANONYMOUS users (401)", () => {
    const stateChangingRoutes = ROUTE_PERMISSIONS.filter((r) => r.isStateChanging);

    for (const route of stateChangingRoutes) {
      const result = checkRouteAccess(route.path, route.method, "ANONYMOUS");
      expect(result.allowed).toBe(false);
      expect(result.statusCode).toBe(401);
      expect(result.error).toBe("UNAUTHORIZED");
    }
  });

  it("strictly prohibits state-changing operations for AUDITOR or VIEWER roles (403)", () => {
    const stateChangingRoutes = ROUTE_PERMISSIONS.filter((r) => r.isStateChanging);

    for (const role of ["AUDITOR", "VIEWER"] as Role[]) {
      for (const route of stateChangingRoutes) {
        const result = checkRouteAccess(route.path, route.method, role);
        expect(result.allowed).toBe(false);
        expect(result.statusCode).toBe(403);
        expect(result.error).toBe("FORBIDDEN");
      }
    }
  });

  it("permits OPERATOR to execute standard payments but blocks admin/treasury mutations", () => {
    // Allowed
    expect(checkRouteAccess("/api/payments", "POST", "OPERATOR").allowed).toBe(true);
    expect(checkRouteAccess("/api/batches", "POST", "OPERATOR").allowed).toBe(true);
    expect(checkRouteAccess("/api/payments/retry", "POST", "OPERATOR").allowed).toBe(true);

    // Blocked
    expect(checkRouteAccess("/api/rbac/grant", "POST", "OPERATOR").statusCode).toBe(403);
    expect(checkRouteAccess("/api/fee-config", "POST", "OPERATOR").statusCode).toBe(403);
    expect(checkRouteAccess("/api/refunds", "POST", "OPERATOR").statusCode).toBe(403);
    expect(checkRouteAccess("/api/multisig/propose", "POST", "OPERATOR").statusCode).toBe(403);
  });

  it("permits TREASURER to execute refunds and multisig proposals but blocks RBAC admin", () => {
    // Allowed
    expect(checkRouteAccess("/api/refunds", "POST", "TREASURER").allowed).toBe(true);
    expect(checkRouteAccess("/api/multisig/propose", "POST", "TREASURER").allowed).toBe(true);
    expect(checkRouteAccess("/api/escrows/release", "POST", "TREASURER").allowed).toBe(true);

    // Blocked
    expect(checkRouteAccess("/api/rbac/grant", "POST", "TREASURER").statusCode).toBe(403);
    expect(checkRouteAccess("/api/fee-config", "POST", "TREASURER").statusCode).toBe(403);
  });

  it("permits ADMIN full execution privileges across all state-changing endpoints", () => {
    const stateChangingRoutes = ROUTE_PERMISSIONS.filter((r) => r.isStateChanging);

    for (const route of stateChangingRoutes) {
      const result = checkRouteAccess(route.path, route.method, "ADMIN");
      expect(result.allowed).toBe(true);
      expect(result.statusCode).toBe(200);
    }
  });

  it("permits public and auditor access to designated read-only endpoints", () => {
    expect(checkRouteAccess("/api/health", "GET", "ANONYMOUS").allowed).toBe(true);
    expect(checkRouteAccess("/api/audit-log", "GET", "AUDITOR").allowed).toBe(true);
  });
});
