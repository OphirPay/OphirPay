# OphirPay State-Changing API Routes: RBAC & Authorization Audit Matrix

This document provides a systematic security audit of all state-changing endpoints in OphirPay, mapping HTTP methods, required roles, authorization barriers, and failure responses.

## 1. Role Definitions & Hierarchy

| Role | Scope | Description |
| :--- | :--- | :--- |
| **`ADMIN` / `OWNER`** | System & Policy | Full permissions across fee config, RBAC grants, contract timelocks, and global administrative actions. |
| **`TREASURER`** | Treasury & Settlement | Authorized to execute large batch payouts, configure multisig proposals, and manage escrow settlements. |
| **`OPERATOR`** | Standard Operations | Authorized to create payments, retry failed transactions, generate payment links, and dispatch webhooks. |
| **`AUDITOR`** | Read & Verify | Read-only access to audit trails, policy version histories, and transaction ledgers without mutation permissions. |
| **`VIEWER` / `ANONYMOUS`** | Public Surface | Restricted strictly to public health checks, metrics, and payment invoice viewing. |

---

## 2. Route-by-Route State-Changing Authorization Matrix

| Endpoint | Method | Mutation Description | Required Role | Auth Barrier | Unauthorized Status |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `/api/rbac/grant` | `POST` | Grants a role to an address | `ADMIN` | Wallet Session / Signature | `403 Forbidden` |
| `/api/rbac/revoke` | `POST` | Revokes a role from an address | `ADMIN` | Wallet Session / Signature | `403 Forbidden` |
| `/api/fee-config` | `POST` / `PUT` | Updates base fee & dynamic fee tiers | `ADMIN` | Wallet Session + Timelock | `403 Forbidden` |
| `/api/timelock/propose` | `POST` | Proposes a timelocked contract upgrade | `ADMIN` | Multisig Consensus | `403 Forbidden` |
| `/api/multisig/propose` | `POST` | Proposes a multisig treasury transfer | `TREASURER` / `ADMIN` | Wallet Session | `403 Forbidden` |
| `/api/multisig/approve` | `POST` | Approves an active multisig proposal | Signer in Quorum | Cryptographic Signature | `403 Forbidden` |
| `/api/multisig/execute` | `POST` | Broadcasts an approved multisig transfer | Signer in Quorum | Quorum Verification | `403 Forbidden` |
| `/api/payments` | `POST` | Initiates single blockchain payment | `OPERATOR`+ | Wallet Session / API Key | `403 Forbidden` |
| `/api/payments/retry` | `POST` | Retries a previously failed payment attempt | `OPERATOR`+ | Session / API Key | `403 Forbidden` |
| `/api/batches` | `POST` | Submits a batch payment transaction set | `OPERATOR`+ | Session / API Key | `403 Forbidden` |
| `/api/refunds` | `POST` | Triggers a contract refund with reason code | `TREASURER` / `ADMIN` | Session Auth | `403 Forbidden` |
| `/api/escrows/create` | `POST` | Locks funds into a conditional escrow | `OPERATOR`+ | Session Auth | `403 Forbidden` |
| `/api/escrows/release` | `POST` | Releases funds from an escrow condition | `TREASURER` / `ADMIN` | Arbiter / Admin Signature | `403 Forbidden` |
| `/api/webhooks` | `POST` / `DELETE` | Registers or deletes external webhook endpoints | `ADMIN` / `OPERATOR` | API Key / Session | `403 Forbidden` |
| `/api/keys` | `POST` / `DELETE` | Generates or revokes API access keys | `ADMIN` | Wallet Session | `403 Forbidden` |

---

## 3. Enforcement & Verification Policy
1. **Zero State Mutation on 401/403**: Any request lacking valid session tokens or failing role-based checks MUST terminate before database or contract write invocations.
2. **Standardized Error Envelopes**: All unauthorized requests return `{ "success": false, "error": "FORBIDDEN", "message": "Insufficient permissions to execute state mutation." }`.
3. **Audit Logging**: All rejected state mutations are recorded in the security audit stream with IP, user agent, caller key, and attempted operation.
