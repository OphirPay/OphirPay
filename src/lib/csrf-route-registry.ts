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
 *
 * Two lists, and the drift guard in the test suite treats them as the union
 * that must account for every mutating handler on disk:
 *   • MUTATING_ROUTES      — browser-reachable handlers that call verifyCsrf.
 *   • CSRF_EXEMPT_ROUTES   — machine-invoked handlers that authenticate with a
 *                            shared secret instead of a CSRF token. Each one
 *                            needs a written reason.
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

/**
 * Every browser-reachable mutating route (37 handlers).
 *
 * Machine-invoked endpoints live in CSRF_EXEMPT_ROUTES below.
 */
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
  { method: "POST", path: "/api/payments/cancel", routeFile: "payments/cancel/route.ts", description: "Cancel payment" },

  // Escrows, streams, batches, recurring, requests
  { method: "POST", path: "/api/escrows", routeFile: "escrows/route.ts", description: "Create escrow (client-side signing)" },
  { method: "POST", path: "/api/streams", routeFile: "streams/route.ts", description: "Create payment stream (client-side signing)" },
  { method: "POST", path: "/api/batches", routeFile: "batches/route.ts", description: "Create batch payment" },
  { method: "POST", path: "/api/batches/[id]", routeFile: "batches/[id]/route.ts", description: "Bulk-cancel a batch's pending payments" },
  { method: "POST", path: "/api/recurring", routeFile: "recurring/route.ts", description: "Create recurring schedule" },
  { method: "PATCH", path: "/api/recurring", routeFile: "recurring/route.ts", description: "Update recurrence settings" },
  { method: "PATCH", path: "/api/recurring/[id]", routeFile: "recurring/[id]/route.ts", description: "Update recurring schedule" },
  { method: "POST", path: "/api/requests", routeFile: "requests/route.ts", description: "Create payment request" },

  // Scheduled payments
  { method: "POST", path: "/api/scheduled", routeFile: "scheduled/route.ts", description: "Create scheduled payment" },
  { method: "DELETE", path: "/api/scheduled", routeFile: "scheduled/route.ts", description: "Cancel scheduled payment" },

  // Refunds
  { method: "POST", path: "/api/refunds", routeFile: "refunds/route.ts", description: "Create refund record" },
  { method: "PATCH", path: "/api/refunds/[id]", routeFile: "refunds/[id]/route.ts", description: "Update refund status" },

  // Webhooks & hooks
  { method: "POST", path: "/api/webhooks", routeFile: "webhooks/route.ts", description: "Register webhook" },
  { method: "PATCH", path: "/api/webhooks", routeFile: "webhooks/route.ts", description: "Update webhook" },
  { method: "DELETE", path: "/api/webhooks", routeFile: "webhooks/route.ts", description: "Revoke webhook" },
  { method: "POST", path: "/api/webhooks/[id]/replay", routeFile: "webhooks/[id]/replay/route.ts", description: "Replay stored webhook events" },
  { method: "POST", path: "/api/webhooks/[id]/test", routeFile: "webhooks/[id]/test/route.ts", description: "Send test webhook" },
  { method: "POST", path: "/api/webhooks/[id]/deliveries/[deliveryId]/redeliver", routeFile: "webhooks/[id]/deliveries/[deliveryId]/redeliver/route.ts", description: "Redeliver a webhook payload" },
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
];

export interface CsrfExemptRoute {
  method: MutatingMethod;
  /** API path relative to origin, e.g. /api/cron */
  path: string;
  /** Route module under src/app/api (used by coverage tests) */
  routeFile: string;
  /**
   * Why this handler does not carry CSRF protection. Must be a real reason
   * (a different authentication mechanism), never "forgot" — the drift test
   * fails if the reason is empty or the route is also registered above.
   */
  reason: string;
}

/**
 * Machine-invoked mutating routes that intentionally authenticate differently
 * from browser sessions.
 *
 * These are triggered by a scheduler/worker (not a browser), and they require
 * a shared secret sent as a custom header (`Authorization: Bearer $CRON_SECRET`
 * or `x-cron-secret`). Custom headers cannot be attached cross-site without a
 * CORS preflight, so a CSRF token would add no protection — the shared secret
 * *is* the authentication. They still call `verifyCsrf()` as defence in depth,
 * but they are listed here so the drift guard knows they are accounted for
 * rather than accidentally omitted.
 *
 * There is deliberately no entry for an inbound Webhook receiver: OphirPay
 * delivers webhooks outbound only. Should a receiver route be added, it must
 * be listed here with a reason (signature verification) rather than left to
 * silently drift.
 */
export const CSRF_EXEMPT_ROUTES: CsrfExemptRoute[] = [
  {
    method: "POST",
    path: "/api/jobs/process-due-recurring",
    routeFile: "jobs/process-due-recurring/route.ts",
    reason: "Scheduler/worker sweep; authenticated by CRON_SECRET, never a browser session.",
  },
  {
    method: "POST",
    path: "/api/cron",
    routeFile: "cron/route.ts",
    reason: "Vercel cron entrypoint; authenticated by Authorization: Bearer $CRON_SECRET.",
  },
  {
    method: "POST",
    path: "/api/scheduled/run",
    routeFile: "scheduled/run/route.ts",
    reason: "Scheduled-payment runner; authenticated by CRON_SECRET, not a browser session.",
  },
];
