# OphirPay State-Changing API Routes: RBAC & Authorization Audit Matrix

This document provides a systematic security audit of all state-changing and read-only API endpoints across the 25 route modules in OphirPay, mapping HTTP methods, required roles, authentication barriers, CSRF defenses, and failure responses.

## 1. Role Definitions & Hierarchy

| Role | Scope | Description |
| :--- | :--- | :--- |
| **`ADMIN` / `OWNER`** | System & Policy | Full permissions across fee config, RBAC grants, contract timelocks, and global administrative actions. |
| **`TREASURER`** | Treasury & Settlement | Authorized to execute large batch payouts, configure multisig proposals, and manage escrow settlements. |
| **`OPERATOR`** | Standard Operations | Authorized to create payments, retry failed transactions, generate payment links, and dispatch webhooks. |
| **`AUDITOR`** | Read & Verify | Read-only access to audit trails, policy version histories, and transaction ledgers without mutation permissions. |
| **`VIEWER` / `ANONYMOUS`** | Public Surface | Restricted strictly to public health checks, metrics, and payment invoice viewing. |

---

## 2. Comprehensive Route-by-Route Security & Authorization Matrix

| Endpoint Group | Method | Mutation Type | Required Role | Auth Mechanism | CSRF Protection | Status on Unauthorized |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `/api/rbac/grant` | `POST` | DB / Chain | `ADMIN` | Ed25519 Session / Key | ✅ Enforced | `403 Forbidden` |
| `/api/rbac/revoke` | `POST` | DB / Chain | `ADMIN` | Ed25519 Session / Key | ✅ Enforced | `403 Forbidden` |
| `/api/fee-config` | `POST`/`PUT` | Chain | `ADMIN` | Session + Timelock | ✅ Enforced | `403 Forbidden` |
| `/api/timelock/propose` | `POST` | Chain | `ADMIN` | Multisig Consensus | ✅ Enforced | `403 Forbidden` |
| `/api/multisig/propose` | `POST` | Chain | `TREASURER`+ | Session Auth | ✅ Enforced | `403 Forbidden` |
| `/api/multisig/approve` | `POST` | Chain | Quorum Signer | Signer Signature | ✅ Enforced | `403 Forbidden` |
| `/api/multisig/execute` | `POST` | Chain | Quorum Signer | Quorum Verification | ✅ Enforced | `403 Forbidden` |
| `/api/payments` | `POST` | DB / Chain | `OPERATOR`+ | Session / API Key | ⚠️ Token Bound | `403 Forbidden` |
| `/api/payments/retry` | `POST` | DB / Chain | `OPERATOR`+ | Session / API Key | ⚠️ Token Bound | `403 Forbidden` |
| `/api/batches` | `POST` | DB / Chain | `OPERATOR`+ | Session / API Key | ⚠️ Token Bound | `403 Forbidden` |
| `/api/refunds` | `POST` | DB / Chain | `TREASURER`+ | Session Auth | ✅ Enforced | `403 Forbidden` |
| `/api/escrows/create` | `POST` | Chain | `OPERATOR`+ | Session Auth | ✅ Enforced | `403 Forbidden` |
| `/api/escrows/release` | `POST` | Chain | `TREASURER`+ | Arbiter Signature | ✅ Enforced | `403 Forbidden` |
| `/api/webhooks` | `POST`/`DEL` | DB | `ADMIN`/`OPERATOR`| API Key / Session | ✅ Enforced | `403 Forbidden` |
| `/api/keys` | `POST`/`DEL` | DB | `ADMIN` | Session Auth | ⚠️ Session Bound| `403 Forbidden` |
| `/api/health` | `GET` | None | `ANONYMOUS` | Public | N/A | `200 OK` |
| `/api/audit-log` | `GET` | None | `AUDITOR`+ | Bearer API Key | N/A | `401 / 403` |

---

## 3. Enforcement & Verification Policy
1. **Zero State Mutation on 401/403**: Any request lacking valid session tokens or failing role-based checks MUST terminate before database or contract write invocations.
2. **Tenant Isolation**: All tenant-specific data operations must use compound querying `where: { id, userId: auth.userId }` to prevent IDOR (Insecure Direct Object Reference).
3. **Standardized Error Envelopes**: All unauthorized requests return `{ "success": false, "error": "FORBIDDEN", "message": "Insufficient permissions to execute state mutation." }`.
4. **Audit Logging**: All rejected state mutations are recorded in the security audit stream with IP, user agent, caller key, and attempted operation.
