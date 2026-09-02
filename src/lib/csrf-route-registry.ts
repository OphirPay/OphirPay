// SPDX-License-Identifier: MIT
/**
 * Single source of truth for CSRF coverage on mutating API routes.
 *
 * Issue #563 — every non-GET handler must call verifyCsrf(request) so
 * browser sessions (cookie auth) are protected. Machine-to-machine callers
 * using Authorization: Bearer / X-API-Key bypass CSRF inside verifyCsrf().
 *
 * Keep this registry in sync with docs/CSRF-AUDIT.md and the enforcement
 * tests in src/__tests__/csrf-coverage.test.ts.
 */

export type MutatingMethod = "POST" | "PUT" | "PATCH" | "DELETE";

export interface CsrfRouteEntry {
  method: MutatingMethod;
  /** API path relative to origin, e.g. /api/payments/[id] */
  path: string;
  /** Route module under src/app/api (used by coverage tests) */
  routeFile: string;
  description: string;
}

/** Every mutating route in the API tree (28 handlers across 24 paths). */
export const MUTATING_ROUTES: CsrfRouteEntry[] = [
  // Auth
  { method: "POST", path: "/api/auth/session", routeFile: "auth/session/route.ts", description: "Login / session renewal" },
  { method: "DELETE", path: "/api/auth/session", routeFile: "auth/session/route.ts", description: "Logout — clears session cookie" },

  // API keys
  { method: "POST", path: "/api/keys", routeFile: "keys/route.ts", description: "Generate API key" },
  { method: "PATCH", path: "/api/keys", routeFile: "keys/route.ts", description: "Update key scopes" },
  { method: "DELETE", path: "/api/keys", routeFile: "keys/route.ts", description: "Revoke API key" },

  // Payments
  { method: "POST", path: "/api/payments", routeFile: "payments/route.ts", description: "Create payment" },
  { method: "PATCH", path: "/api/payments/[id]", routeFile: "payments/[id]/route.ts", description: "Update payment status" },
  { method: "DELETE", path: "/api/payments/[id]", routeFile: "payments/[id]/route.ts", description: "Soft-delete payment" },
  { method: "POST", path: "/api/payments/retry", routeFile: "payments/retry/route.ts", description: "Retry failed payment" },

  // Escrows, streams, batches, recurring, requests
  { method: "POST", path: "/api/escrows", routeFile: "escrows/route.ts", description: "Create escrow (client-side signing)" },
  { method: "POST", path: "/api/streams", routeFile: "streams/route.ts", description: "Create payment stream (client-side signing)" },
  { method: "POST", path: "/api/batches", routeFile: "batches/route.ts", description: "Create batch payment" },
  { method: "POST", path: "/api/recurring", routeFile: "recurring/route.ts", description: "Create recurring schedule" },
  { method: "POST", path: "/api/requests", routeFile: "requests/route.ts", description: "Create payment request" },

  // Refunds
  { method: "POST", path: "/api/refunds", routeFile: "refunds/route.ts", description: "Create refund record" },
  { method: "PATCH", path: "/api/refunds/[id]", routeFile: "refunds/[id]/route.ts", description: "Update refund status" },

  // Webhooks & hooks
  { method: "POST", path: "/api/webhooks", routeFile: "webhooks/route.ts", description: "Register webhook" },
  { method: "DELETE", path: "/api/webhooks", routeFile: "webhooks/route.ts", description: "Revoke webhook" },
  { method: "POST", path: "/api/hooks", routeFile: "hooks/route.ts", description: "Register notification hook" },
  { method: "PATCH", path: "/api/hooks/[id]", routeFile: "hooks/[id]/route.ts", description: "Deactivate notification hook" },

  // Governance
  { method: "POST", path: "/api/governance/proposals", routeFile: "governance/proposals/route.ts", description: "Create governance proposal" },
  { method: "POST", path: "/api/governance/vote", routeFile: "governance/vote/route.ts", description: "Cast vote" },
  { method: "POST", path: "/api/governance/execute", routeFile: "governance/execute/route.ts", description: "Execute passed proposal" },

  // Multisig
  { method: "POST", path: "/api/multisig", routeFile: "multisig/route.ts", description: "Configure multisig" },
  { method: "POST", path: "/api/multisig/propose", routeFile: "multisig/propose/route.ts", description: "Propose multisig payment" },
  { method: "POST", path: "/api/multisig/approve", routeFile: "multisig/approve/route.ts", description: "Approve multisig payment" },
  { method: "POST", path: "/api/multisig/execute", routeFile: "multisig/execute/route.ts", description: "Execute multisig payment" },

  // Jobs
  { method: "POST", path: "/api/jobs/process-due-recurring", routeFile: "jobs/process-due-recurring/route.ts", description: "Recurring scheduler sweep (cron / worker)" },
];
