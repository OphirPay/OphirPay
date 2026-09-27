# CSRF Audit — Mutating API Routes

> Generated for [Issue #563](https://github.com/OphirPay/OphirPay/issues/563).
> Every state-changing route (POST / PUT / PATCH / DELETE) is listed with its
> CSRF protection status. The registry in `src/lib/csrf-route-registry.ts` is
> the machine-readable source of truth; this document is the human-readable spec.
>
> Refreshed for [Issue #704](https://github.com/OphirPay/OphirPay/issues/704),
> which added a drift guard so this table can no longer fall silently behind the
> route tree.

## How CSRF works in OphirPay

| Layer | Behavior |
|-------|----------|
| **Token mint** | `GET /api/csrf` sets the HttpOnly `__Host-csrf` cookie (or `csrf` on plain-http dev) and returns the token in the JSON body. |
| **Verification** | Each mutating handler calls `verifyCsrf(request)` from `src/lib/csrf.ts` before auth or business logic. |
| **Double-submit** | The client echoes the token via the `x-csrf-token` header; the server compares it to the cookie using timing-safe equality. |
| **API key bypass** | Requests carrying `Authorization: Bearer <key>` or `X-API-Key` skip CSRF — browsers never attach these headers on cross-site requests. |
| **Cron bypass** | Requests carrying `Authorization: Bearer <CRON_SECRET>` or `x-cron-secret` skip CSRF for the same reason. |
| **No global middleware** | CSRF is **per-route**, not applied by `src/proxy.ts` or a Next.js middleware file. |

## Legend

| Symbol | Meaning |
|--------|---------|
| ✅ | `verifyCsrf(request)` called — browser sessions require a valid token |
| 🔑 | Same as ✅, but API-key callers bypass the token check inside `verifyCsrf` |
| ⏱ | Machine-invoked (cron / scheduler); authenticated by a shared secret, allowlisted in `CSRF_EXEMPT_ROUTES` |

## Protected Route Audit Table

| Route | Method | CSRF | Notes |
|-------|--------|------|-------|
| `/api/auth/session` | POST | ✅ | Login / session renewal |
| `/api/auth/session` | DELETE | ✅ | Logout — clears session cookie |
| `/api/keys` | POST | 🔑 | Generate API key |
| `/api/keys` | PATCH | 🔑 | Update key scopes |
| `/api/keys` | DELETE | 🔑 | Revoke API key |
| `/api/payments` | POST | 🔑 | Create payment |
| `/api/payments/[id]` | PATCH | 🔑 | Update payment status |
| `/api/payments/[id]` | DELETE | 🔑 | Soft-delete payment |
| `/api/payments/retry` | POST | 🔑 | Retry failed payment |
| `/api/payments/cancel` | POST | 🔑 | Cancel payment |
| `/api/escrows` | POST | 🔑 | Create escrow (client-side signing) |
| `/api/streams` | POST | 🔑 | Create payment stream (client-side signing) |
| `/api/batches` | POST | 🔑 | Create batch payment |
| `/api/batches/[id]` | POST | 🔑 | Bulk-cancel a batch's pending payments |
| `/api/recurring` | POST | 🔑 | Create recurring schedule |
| `/api/recurring` | PATCH | 🔑 | Update recurrence settings |
| `/api/recurring/[id]` | PATCH | 🔑 | Update recurring schedule |
| `/api/requests` | POST | 🔑 | Create payment request |
| `/api/scheduled` | POST | 🔑 | Create scheduled payment |
| `/api/scheduled` | DELETE | 🔑 | Cancel scheduled payment |
| `/api/refunds` | POST | 🔑 | Create refund record |
| `/api/refunds/[id]` | PATCH | 🔑 | Update refund status |
| `/api/webhooks` | POST | 🔑 | Register webhook |
| `/api/webhooks` | PATCH | 🔑 | Update webhook |
| `/api/webhooks` | DELETE | 🔑 | Revoke webhook |
| `/api/webhooks/[id]/replay` | POST | 🔑 | Replay stored webhook events |
| `/api/webhooks/[id]/test` | POST | 🔑 | Send test webhook |
| `/api/webhooks/[id]/deliveries/[deliveryId]/redeliver` | POST | 🔑 | Redeliver a webhook payload |
| `/api/hooks` | POST | 🔑 | Register notification hook |
| `/api/hooks/[id]` | PATCH | 🔑 | Deactivate notification hook |
| `/api/governance/proposals` | POST | 🔑 | Create governance proposal |
| `/api/governance/vote` | POST | 🔑 | Cast vote |
| `/api/governance/execute` | POST | 🔑 | Execute passed proposal |
| `/api/multisig` | POST | 🔑 | Configure multisig |
| `/api/multisig/propose` | POST | 🔑 | Propose multisig payment |
| `/api/multisig/approve` | POST | 🔑 | Approve multisig payment |
| `/api/multisig/execute` | POST | 🔑 | Execute multisig payment |

**Subtotal:** 37 mutating handlers — **37 protected** (100% coverage).

## Allowlisted Routes (authenticate by shared secret)

These are not registered in `MUTATING_ROUTES`; they are listed in
`CSRF_EXEMPT_ROUTES` with a reason. They are invoked by a scheduler/worker, not
a browser, and require `Authorization: Bearer $CRON_SECRET` or `x-cron-secret`.
They still call `verifyCsrf()` as defence in depth.

| Route | Method | CSRF | Reason |
|-------|--------|------|--------|
| `/api/jobs/process-due-recurring` | POST | ⏱ | Recurring scheduler sweep; authenticated by `CRON_SECRET`. |
| `/api/cron` | POST | ⏱ | Scheduled-payment execution sweep (cron). |
| `/api/scheduled/run` | POST | ⏱ | Trigger scheduled payment run (cron). |

**Subtotal:** 3 handlers, all machine-invoked.

> OphirPay delivers webhooks **outbound only**, so there is no inbound webhook
> receiver route to list. If one is ever added it must be allowlisted here with
> a reason (signature verification) rather than left to drift.

**Total:** **40** mutating handlers — 37 protected + 3 allowlisted.

## Enforcement

- **Registry:** `src/lib/csrf-route-registry.ts` (`MUTATING_ROUTES` +
  `CSRF_EXEMPT_ROUTES`).
- **Tests:** `src/__tests__/csrf-coverage.test.ts` — globs
  `src/app/api/**/route.ts`, extracts every exported mutating handler by HTTP
  method, and fails if one is in neither list. The failure names the route and
  prints the exact registry entry to add, so adding a new mutation cannot slip
  through unregistered (#704).
- **Client:** `useApiQuery.ts` / `apiFetch` auto-attach `x-csrf-token` and retry
  once on `CSRF_INVALID`.

## Safe Methods (No CSRF Required)

All GET, HEAD, and OPTIONS handlers are read-only and do not invoke
`verifyCsrf`. Token minting (`GET /api/csrf`) and health/metrics endpoints are
included here.
