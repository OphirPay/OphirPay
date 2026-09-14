# CSRF Audit — Mutating API Routes

> Generated for [Issue #563](https://github.com/OphirPay/OphirPay/issues/563).
> Every state-changing route (POST / PUT / PATCH / DELETE) is listed with its
> CSRF protection status. The registry in `src/lib/csrf-route-registry.ts` is
> the machine-readable source of truth; this document is the human-readable spec.

## How CSRF works in OphirPay

| Layer | Behavior |
|-------|----------|
| **Token mint** | `GET /api/csrf` sets the HttpOnly `__Host-csrf` cookie (or `csrf` on plain-http dev) and returns the token in the JSON body. |
| **Verification** | Each mutating handler calls `verifyCsrf(request)` from `src/lib/csrf.ts` before auth or business logic. |
| **Double-submit** | The client echoes the token via the `x-csrf-token` header; the server compares it to the cookie using timing-safe equality. |
| **API key bypass** | Requests carrying `Authorization: Bearer <key>` or `X-API-Key` skip CSRF — browsers never attach these headers on cross-site requests. |
| **No global middleware** | CSRF is **per-route**, not applied by `src/proxy.ts` or a Next.js middleware file. |

## Legend

| Symbol | Meaning |
|--------|---------|
| ✅ | `verifyCsrf(request)` called — browser sessions require a valid token |
| 🔑 | Same as ✅, but API-key callers bypass the token check inside `verifyCsrf` |

## Route Audit Table

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
| `/api/escrows` | POST | 🔑 | Create escrow (client-side signing) |
| `/api/streams` | POST | 🔑 | Create payment stream (client-side signing) |
| `/api/batches` | POST | 🔑 | Create batch payment |
| `/api/recurring` | POST | 🔑 | Create recurring schedule |
| `/api/requests` | POST | 🔑 | Create payment request |
| `/api/refunds` | POST | 🔑 | Create refund record |
| `/api/refunds/[id]` | PATCH | 🔑 | Update refund status |
| `/api/webhooks` | POST | 🔑 | Register webhook |
| `/api/webhooks` | DELETE | 🔑 | Revoke webhook |
| `/api/hooks` | POST | 🔑 | Register notification hook |
| `/api/hooks/[id]` | PATCH | 🔑 | Deactivate notification hook |
| `/api/governance/proposals` | POST | 🔑 | Create governance proposal |
| `/api/governance/vote` | POST | 🔑 | Cast vote |
| `/api/governance/execute` | POST | 🔑 | Execute passed proposal |
| `/api/multisig` | POST | 🔑 | Configure multisig |
| `/api/multisig/propose` | POST | 🔑 | Propose multisig payment |
| `/api/multisig/approve` | POST | 🔑 | Approve multisig payment |
| `/api/multisig/execute` | POST | 🔑 | Execute multisig payment |
| `/api/jobs/process-due-recurring` | POST | 🔑 | Recurring scheduler sweep (cron / worker) |

**Total:** 28 mutating handlers — **28 protected** (100% coverage).

## Gaps Found & Fixed

Prior to issue #563, only 14 of 28 mutating handlers called `verifyCsrf`. The
following routes were missing protection for browser sessions:

| Route | Method | Fix |
|-------|--------|-----|
| `/api/auth/session` | DELETE | Added `verifyCsrf` (prevents CSRF logout) |
| `/api/keys` | POST, PATCH, DELETE | Added `verifyCsrf` |
| `/api/payments` | POST | Added `verifyCsrf` |
| `/api/payments/[id]` | PATCH, DELETE | Added `verifyCsrf` |
| `/api/payments/retry` | POST | Added `verifyCsrf` |
| `/api/escrows` | POST | Added `verifyCsrf` |
| `/api/streams` | POST | Added `verifyCsrf` |
| `/api/batches` | POST | Added `verifyCsrf` |
| `/api/recurring` | POST | Added `verifyCsrf` |
| `/api/requests` | POST | Added `verifyCsrf` |
| `/api/multisig` | POST | Added `verifyCsrf` |
| `/api/jobs/process-due-recurring` | POST | Added `verifyCsrf` |

Additionally, `verifyCsrf` now skips validation when an API key header is
present so machine-to-machine callers (cron jobs, CI, integrations) are not
blocked.

## Enforcement

- **Registry:** `src/lib/csrf-route-registry.ts`
- **Tests:** `src/__tests__/csrf-coverage.test.ts` — fails CI if a new mutating
  route is added without registering it and calling `verifyCsrf`.
- **Client:** `useApiQuery.ts` / `apiFetch` auto-attach `x-csrf-token` and retry
  once on `CSRF_INVALID`.

## Safe Methods (No CSRF Required)

All GET, HEAD, and OPTIONS handlers are read-only and do not invoke
`verifyCsrf`. Token minting (`GET /api/csrf`) and health/metrics endpoints are
included here.
