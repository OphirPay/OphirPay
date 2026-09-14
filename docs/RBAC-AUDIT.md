# RBAC Audit — State-Changing API Routes

> Generated for [Issue #388](https://github.com/OphirPay/OphirPay/issues/392).
> Each state-changing route (POST / PUT / PATCH / DELETE) is listed with its
> required authentication and any role-based access control enforcement.

## Legend

| Symbol | Meaning |
|--------|---------|
| ✅ | Enforced at API layer |
| ⚠️ | Enforced only by on-chain contract (no API-level guard) |
| 🔓 | No auth required (public endpoint) |
| 👤 | Any authenticated user |
| 🛡️ | Admin only |
| ✍️ | Signer only (multisig) |

## Route Audit Table

| Route | Method | Auth | RBAC | Notes |
|-------|--------|------|------|-------|
| `/api/auth/session` | POST | 🔓 | — | Login — sets session cookie. CSRF-protected. |
| `/api/auth/session` | DELETE | 👤 | — | Logout — clears session cookie. |
| `/api/keys` | POST | 👤 | — | Generate API key. User-scoped (key belongs to caller). |
| `/api/keys` | DELETE | 👤 | — | Revoke API key. User-scoped (only own keys). |
| `/api/payments` | POST | 👤 | — | Create payment. User-scoped (record linked to caller). |
| `/api/payments/[id]` | PATCH | 👤 | — | Update payment status. User-scoped via `userId`. |
| `/api/payments/[id]` | DELETE | 👤 | — | Soft-delete payment. User-scoped via `userId`. |
| `/api/payments/retry` | POST | 👤 | — | Retry failed payment. User-scoped via `userId`. |
| `/api/escrows` | POST | 👤 | — | Create escrow. Delegated to client-side signing. |
| `/api/streams` | POST | 👤 | — | Create payment stream. Delegated to client-side signing. |
| `/api/batches` | POST | 👤 | — | Create batch payment. Delegated to client-side signing. |
| `/api/batches/[id]` | POST | 👤 | — | Bulk-cancel pending payments. User-scoped via `userId`. |
| `/api/recurring` | POST | 👤 | — | Create recurring payment. Delegated to client-side signing. |
| `/api/requests` | POST | 👤 | — | Create payment request. User-scoped. |
| `/api/refunds` | POST | 👤 | — | Create refund request. User-scoped. |
| `/api/refunds/[id]` | PATCH | 👤 | — | Update refund status. User-scoped via `userId`. |
| `/api/webhooks` | POST | 👤 | — | Register webhook. User-scoped. |
| `/api/webhooks` | DELETE | 👤 | — | Revoke webhook. User-scoped. |
| `/api/hooks` | POST | 👤 | — | Register notification hook. User-scoped. |
| `/api/hooks/[id]` | PATCH | 👤 | — | Deactivate notification hook. User-scoped. |
| `/api/governance/proposals` | POST | 👤 | ⚠️ | Create proposal. Contract enforces deposit. |
| `/api/governance/vote` | POST | 👤 | ⚠️ | Cast vote. Contract enforces quorum. |
| `/api/governance/execute` | POST | 👤 | ⚠️ | Execute proposal. Contract enforces vote count. |
| `/api/multisig` | POST | 👤 | ⚠️ | Configure multisig. **Should be Admin-only.** Contract enforces `require_owner`. |
| `/api/multisig/propose` | POST | 👤 | ⚠️ | Propose payment. **Should be Signer-only.** Contract enforces signer check. |
| `/api/multisig/approve` | POST | 👤 | ⚠️ | Approve payment. **Should be Signer-only.** Contract enforces signer check. |
| `/api/multisig/execute` | POST | 👤 | ⚠️ | Execute payment. **Should be Signer-only.** Contract enforces threshold. |

## Read-Only Routes (GET) — Auth Required

All GET routes require authentication (`getAuthContext`) but do not enforce
role-based restrictions. This is correct: read access is granted to any
authenticated user.

| Route | Auth | Notes |
|-------|------|-------|
| `/api/payments` | 👤 | User-scoped query |
| `/api/payments/[id]` | 👤 | User-scoped lookup |
| `/api/escrows` | 👤 | User-scoped query |
| `/api/escrows/[id]` | 👤 | User-scoped lookup |
| `/api/streams` | 👤 | User-scoped query |
| `/api/streams/[id]` | 👤 | User-scoped lookup |
| `/api/batches` | 👤 | User-scoped query |
| `/api/batches/[id]` | 👤 | User-scoped lookup |
| `/api/recurring` | 👤 | User-scoped query |
| `/api/recurring/[id]` | 👤 | User-scoped lookup |
| `/api/requests` | 👤 | User-scoped query |
| `/api/webhooks` | 👤 | User-scoped query |
| `/api/hooks` | 👤 | User-scoped query |
| `/api/refunds` | 👤 | User-scoped query |
| `/api/multisig` | 👤 | Reads on-chain config |
| `/api/multisig/requests` | 👤 | Reads on-chain requests |
| `/api/governance/proposals` | 👤 | Reads on-chain proposals |
| `/api/timelock` | 👤 | Reads on-chain timelocked actions |
| `/api/fee-config` | 👤 | Reads on-chain fee config |
| `/api/fee-config/collector` | 👤 | Reads on-chain fee collector |
| `/api/fee-config/history` | 👤 | Reads on-chain version history |
| `/api/rbac` | 👤 | Reads on-chain role assignments |
| `/api/policy-versions` | 👤 | Reads on-chain version history |
| `/api/audit-log` | 👤 | Reads on-chain audit entries |
| `/api/stats` | 👤 | Reads aggregated stats |
| `/api/contracts` | 👤 | Reads contract info |

## Public Routes (No Auth)

| Route | Notes |
|-------|-------|
| `/api/health` | Health check — bypasses rate limiting |
| `/api/metrics` | Prometheus metrics — bypasses rate limiting |

## Gaps Found

### 1. No API-level RBAC on Admin-only contract calls

The following routes call Soroban functions that enforce `require_owner` or
`require_role` at the contract level, but the API layer only checks
authentication (any wallet can call them). If the contract is unreachable,
the API returns a simulation failure rather than a 403.

**Recommended fix:** Add an API-level RBAC check (via `getRoleFromContract`
or a local cache) before calling the contract, returning 403 with
`INSUFFICIENT_PERMISSIONS` if the caller lacks the required role.

| Route | Required Role | Contract Guard |
|-------|---------------|----------------|
| `POST /api/multisig` | Admin | `require_owner` |
| `POST /api/multisig/propose` | Signer | signer check |
| `POST /api/multisig/approve` | Signer | signer check |
| `POST /api/governance/execute` | Admin | `require_owner` |

### 2. No role check on governance proposal creation

`POST /api/governance/proposals` accepts any authenticated user. The contract
enforces a minimum deposit but does not require a specific role. This is
intentional (open governance), but worth documenting.

## Test Coverage

Tests in `src/__tests__/rbac-enforcement.test.ts` assert:
- All state-changing routes return 401 without authentication.
- The route audit table is consistent with the actual codebase.
- Admin-only routes are identified for future enforcement.

## Recommendations

1. **Add API-level RBAC guards** for `POST /api/multisig` (Admin) and
   `POST /api/governance/execute` (Admin) as a defense-in-depth measure.
2. **Cache role lookups** to avoid per-request Soroban simulation for
   RBAC checks (use a short TTL, e.g., 60 seconds).
3. **Return 403 (not 401)** when the caller is authenticated but lacks
   the required role — currently these routes return contract simulation
   errors which are less clear.
