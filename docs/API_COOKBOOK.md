# OphirPay API Cookbook

Runnable `curl` + sample-response examples for every public endpoint. Closes #214.

All JSON endpoints share the envelope from `src/lib/api-response.ts`:

```json
{ "success": true, "data": {}, "meta": { "timestamp": "2026-08-26T12:00:00.000Z" } }
```

Errors:

```json
{ "success": false, "error": { "code": "NOT_FOUND", "message": "..." }, "timestamp": "..." }
```

**Auth** — two ways to authenticate (`getAuthContext`):
1. Signed wallet session cookie (`ophirpay_session`), obtained via `/api/auth/*`
2. API key: `Authorization: Bearer <api-key>` (create one via `POST /api/keys`)

Mutating routes additionally require a CSRF double-submit header (`x-csrf-token`, minted by `GET /api/csrf`).

---

## Table of contents

- [Authentication](#authentication)
- [Payments](#payments)
- [Batches](#batches)
- [Recurring](#recurring)
- [Escrows](#escrows)
- [Streams](#streams)
- [Refunds](#refunds)
- [Payment requests](#payment-requests)
- [Governance](#governance)
- [Multisig](#multisig)
- [Webhooks & hooks](#webhooks--hooks--keys)
- [API keys](#api-keys)
- [Contracts, events & analytics](#contracts-events--analytics)
- [Health & CSRF](#health--csrf)
- [Fee config, timelock, policy versions, RBAC, audit log](#fee-config-timelock-policy-versions-rbac-audit-log)

---

## Authentication

### `GET /api/auth/challenge` — Mint a proof-of-ownership wallet-signing challenge

Auth: none

```bash
curl -X GET "http://localhost:3000/api/auth/challenge?publicKey=GCQOSPY4GWJCTGZUTVATL5O6OFBUXPSLLRCEVZE2RWGYHJGBMSTU7RFE"
```

**Success response** `200`:

```json
{
  "success": true,
  "data": {
    "challenge": "eyJwdWJsaWNrZXkiOiJHQ1FPU1BWNEdXSkNUR1pVVFRWQVRMTzU2T0ZCVVhQU0xMUkNFVlpFMlJXR1lISkdCTVNUVTdSRkUiLCJub25jZSI6ImFiMTJjZDM0IiwiZXhwIjoxNzg3MDAwMDAwfQ.signature",
    "message": "Sign this message to prove you own the Stellar account GCQOSPY4GWJCTGZUTVATL5O6OFBUXPSLLRCEVZE2RWGYHJGBMSTU7RFE\nChallenge: ...",
    "expiresIn": 300
  },
  "meta": { "timestamp": "2026-08-26T12:00:00.000Z" }
}
```

**Error** `400`: `publicKey` missing or not a valid 56-char `G...` Stellar address.

### `POST /api/auth/session` — Issue a signed session cookie for a wallet

Auth: none to call, but requires `challenge` + `signature` proof (or an existing valid session cookie for renewal). Enforces a CSRF check.

```bash
curl -X POST http://localhost:3000/api/auth/session \
  -H "Content-Type: application/json" \
  -d '{
    "publicKey": "GCQOSPY4GWJCTGZUTVATL5O6OFBUXPSLLRCEVZE2RWGYHJGBMSTU7RFE",
    "network": "TESTNET",
    "challenge": "eyJwdWJsaWNrZXkiOiJHQ1FPU1BWNEciLCJleHAiOjE3ODcwMDAwMDB9.sig",
    "signature": "YWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXphYmNkZWZnaGlqa2xtbm9wcXJzdHV2d3g"
  }'
```

**Success response** `200` (also sets `Set-Cookie: ophirpay_session=...; HttpOnly; SameSite=Lax`):

```json
{
  "success": true,
  "data": {
    "authenticated": true,
    "publicKey": "GCQOSPY4GWJCTGZUTVATL5O6OFBUXPSLLRCEVZE2RWGYHJGBMSTU7RFE",
    "network": "TESTNET"
  },
  "meta": { "timestamp": "2026-08-26T12:00:00.000Z" }
}
```

**Errors**: `400` invalid `publicKey`; `401` missing/expired challenge, bad signature, or renewal key mismatch.

### `DELETE /api/auth/session` — Revoke the session cookie

Auth: none

```bash
curl -X DELETE http://localhost:3000/api/auth/session
```

**Success response** `200`:

```json
{ "success": true, "data": { "authenticated": false }, "meta": { "timestamp": "2026-08-26T12:00:00.000Z" } }
```

---

## Payments

### `GET /api/payments` — List payments (paginated, scoped to caller)

Query params: `page` (default 1), `limit` (default 20, max 100), `status`, `search` (matches `description`, `memo`, `transactionHash`).

```bash
curl -X GET "http://localhost:3000/api/payments?page=1&limit=20&status=COMPLETED" \
  -H "Authorization: Bearer <api-key>"
```

**Success response** `200`:

```json
{
  "success": true,
  "data": [
    {
      "id": "clx8f2p9q0001uvb3k7n4m2ab",
      "userId": "clusr_owner0001uvb3k7n4m2ab",
      "amount": "150.0000000",
      "assetCode": "XLM",
      "assetIssuer": null,
      "description": "Invoice #1042 settlement",
      "memo": "INV-1042",
      "status": "COMPLETED",
      "transactionHash": "a3f1c9e77b2c4d5e6f8091a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6",
      "stellarOpId": "12345678901234567",
      "sourceAccountId": "clacct_src00001uvb3k7n4m2ab",
      "destAccountId": null,
      "batchId": null,
      "recurrenceId": null,
      "metadata": null,
      "errorMessage": null,
      "createdAt": "2026-08-20T09:14:22.103Z",
      "updatedAt": "2026-08-20T09:16:47.881Z",
      "completedAt": "2026-08-20T09:16:47.881Z",
      "deletedAt": null
    }
  ],
  "meta": { "page": 1, "limit": 20, "total": 1, "timestamp": "2026-08-26T12:00:00.000Z" }
}
```

### `POST /api/payments` — Create a payment record

Fires a `payment.created` webhook async. Note: `destAddress` is validated but not persisted on the Payment row.

```bash
curl -X POST http://localhost:3000/api/payments \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <api-key>" \
  -d '{
    "amount": 150.5,
    "sourceAccountId": "clacct_src00001uvb3k7n4m2ab",
    "destAddress": "GD2PFIIRMAZVA3XLH3UEHBSQWHKQM5FSUVFJE5YVKKS26Y7OG3YVWA2Y",
    "assetCode": "USDC",
    "assetIssuer": "GA5XIGA5C7QTPTWXQHY6MCJTMTR4ZIY3R6QHCNTLDVUMRVOEBUN7ANZ2",
    "description": "Invoice #1042 settlement",
    "memo": "INV-1042"
  }'
```

**Success response** `201`: the created Payment object (shape as above, `status: "CREATED"`).

**Error** `400`: validation failure (non-positive `amount`, malformed `destAddress`).

### `GET /api/payments/[id]` — Fetch one payment

Owner-scoped; cross-user access returns 404.

```bash
curl -X GET http://localhost:3000/api/payments/clx8f2p9q0001uvb3k7n4m2ab \
  -H "Authorization: Bearer <api-key>"
```

### `PATCH /api/payments/[id]` — Update payment status/description/memo

Fires `payment.completed` / `payment.failed` webhooks on status transitions.

```bash
curl -X PATCH http://localhost:3000/api/payments/clx8f2p9q0001uvb3k7n4m2ab \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <api-key>" \
  -d '{ "status": "COMPLETED", "description": "Invoice #1042 settled via Soroban" }'
```

### `DELETE /api/payments/[id]` — Delete a payment

```bash
curl -X DELETE http://localhost:3000/api/payments/clx8f2p9q0001uvb3k7n4m2ab \
  -H "Authorization: Bearer <api-key>"
```

**Success response** `200`: `{ "success": true, "data": { "deleted": true } }`

---

## Batches

### `GET /api/batches` — List batches (paginated, includes child payments)

```bash
curl -X GET "http://localhost:3000/api/batches?page=1&limit=20" \
  -H "Authorization: Bearer <api-key>"
```

**Success response** `200`: array of Batch objects with `payments[]` included.

### `POST /api/batches` — Create a batch with child payments

1–100 recipients. Supports an optional idempotency key (see PR #218): send `Idempotency-Key: <8-255 chars>` header or `idempotencyKey` body field — replays return the original batch instead of duplicating.

```bash
curl -X POST http://localhost:3000/api/batches \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <api-key>" \
  -H "Idempotency-Key: payroll-aug-34" \
  -d '{
    "name": "August payroll",
    "description": "Contractor payouts week 34",
    "recipients": [
      { "address": "GD2PFIIRMAZVA3XLH3UEHBSQWHKQM5FSUVFJE5YVKKS26Y7OG3YVWA2Y", "amount": 75, "assetCode": "XLM", "memo": "contractor-alice" },
      { "address": "GB6PXSSCLJUHZ4TZMQ4FHRUBKALLW2YZ3MS6ACPUG5AYKU7OQQ5IL7EE", "amount": 120.25, "assetCode": "USDC", "memo": "contractor-bob" }
    ],
    "sourceAccountId": "clacct_src00001uvb3k7n4m2ab"
  }'
```

**Success response** `201`: the Batch re-fetched with its `payments[]` (`status: "CREATED"`). A replay returns `200` with `meta.deduplicated: true`.

### `GET /api/batches/[id]` — Single batch lookup (on-chain)

Reads from the OphirPay Soroban contract (`get_batch`); `[id]` is a **numeric u64**, not a cuid. Add `?payments=true` for included payments.

```bash
curl -X GET "http://localhost:3000/api/batches/1?payments=true" \
  -H "Authorization: Bearer <api-key>"
```

**Success response** `200` (raw contract return value):

```json
{
  "success": true,
  "data": {
    "id": 1,
    "creator": "GCQOSPY4GWJCTGZUTVATL5O6OFBUXPSLLRCEVZE2RWGYHJGBMSTU7RFE",
    "total_amount": "19525000000",
    "recipient_count": 2,
    "status": "created",
    "timestamp": 1787000000,
    "payments": [
      { "id": 1, "batch_id": 1, "destination": "GD2PFIIRMAZVA3XLH3UEHBSQWHKQM5FSUVFJE5YVKKS26Y7OG3YVWA2Y", "amount": "750000000", "asset": "native", "status": "pending" }
    ]
  },
  "meta": { "timestamp": "2026-08-26T12:00:00.000Z" }
}
```

---

## Recurring

### `GET /api/recurring` — List recurring payment schedules (paginated, last 5 payments each)

```bash
curl -X GET "http://localhost:3000/api/recurring?page=1&limit=20" \
  -H "Authorization: Bearer <api-key>"
```

### `POST /api/recurring` — Create a recurring payment schedule

`nextRunAt` is computed from `frequency` (now + interval).

```bash
curl -X POST http://localhost:3000/api/recurring \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <api-key>" \
  -d '{
    "name": "Monthly rent",
    "frequency": "MONTHLY",
    "amount": 850,
    "assetCode": "XLM",
    "destAddress": "GB6PXSSCLJUHZ4TZMQ4FHRUBKALLW2YZ3MS6ACPUG5AYKU7OQQ5IL7EE",
    "description": "Office rent autopay",
    "sourceAccountId": "clacct_src00001uvb3k7n4m2ab"
  }'
```

**Success response** `201`: the created Recurrence object (`isActive: true`, computed `nextRunAt`).

### `GET /api/recurring/[id]` — Single recurring payment lookup (on-chain)

Numeric u64 contract id.

```bash
curl -X GET http://localhost:3000/api/recurring/3 -H "Authorization: Bearer <api-key>"
```

**Success response** `200` (contract return value):

```json
{
  "success": true,
  "data": {
    "id": 3,
    "owner": "GCQOSPY4GWJCTGZUTVATL5O6OFBUXPSLLRCEVZE2RWGYHJGBMSTU7RFE",
    "destination": "GB6PXSSCLJUHZ4TZMQ4FHRUBKALLW2YZ3MS6ACPUG5AYKU7OQQ5IL7EE",
    "amount": "8500000000",
    "asset": "native",
    "frequency": 3,
    "next_execution": 1789593600,
    "active": true
  },
  "meta": { "timestamp": "2026-08-26T12:00:00.000Z" }
}
```

---

## Escrows

### `GET /api/escrows` — Escrow count, or single escrow via `?id=N` (on-chain)

```bash
curl -X GET "http://localhost:3000/api/escrows?id=7" -H "Authorization: Bearer <api-key>"
```

**Success response (single)** `200`:

```json
{
  "success": true,
  "data": {
    "id": 7,
    "depositor": "GCQOSPY4GWJCTGZUTVATL5O6OFBUXPSLLRCEVZE2RWGYHJGBMSTU7RFE",
    "beneficiary": "GD2PFIIRMAZVA3XLH3UEHBSQWHKQM5FSUVFJE5YVKKS26Y7OG3YVWA2Y",
    "amount": "50000000000",
    "asset": "native",
    "deadline": 1790000000,
    "released": false
  },
  "meta": { "timestamp": "2026-08-26T12:00:00.000Z" }
}
```

**Success response (count)** `200`: `{ "success": true, "data": { "count": 7 } }`

Contract-read failures degrade to `200` with `{ "available": false, ... }`.

### `POST /api/escrows` — Prepare escrow creation params (client-side signing)

Does not write anything; echoes validated params for the wallet-signing flow. **Success:** `202` with `{ "message": "Escrow creation requires wallet signing...", "params": { ... } }`.

```bash
curl -X POST http://localhost:3000/api/escrows \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <api-key>" \
  -d '{
    "depositor": "GCQOSPY4GWJCTGZUTVATL5O6OFBUXPSLLRCEVZE2RWGYHJGBMSTU7RFE",
    "beneficiary": "GD2PFIIRMAZVA3XLH3UEHBSQWHKQM5FSUVFJE5YVKKS26Y7OG3YVWA2Y",
    "amount": 5000,
    "asset": "native",
    "deadline": 1790000000,
    "metadata": "milestone-2-release"
  }'
```

### `GET /api/escrows/[id]` — Single escrow lookup (on-chain)

Same shape as `?id=N`. Errors: `404` invalid/non-numeric id or not found.

---

## Streams

### `GET /api/streams` — Stream count, or single stream via `?id=N` (on-chain)

**Success response (single)** `200`:

```json
{
  "success": true,
  "data": {
    "id": 12,
    "creator": "GCQOSPY4GWJCTGZUTVATL5O6OFBUXPSLLRCEVZE2RWGYHJGBMSTU7RFE",
    "recipient": "GB6PXSSCLJUHZ4TZMQ4FHRUBKALLW2YZ3MS6ACPUG5AYKU7OQQ5IL7EE",
    "total_amount": "120000000000",
    "amount_withdrawn": "45000000000",
    "asset": "native",
    "start_time": 1787000000,
    "end_time": 1789600000,
    "cancelled": false
  },
  "meta": { "timestamp": "2026-08-26T12:00:00.000Z" }
}
```

### `POST /api/streams` — Prepare stream creation params (client-side signing)

Requires `creator`, `recipient`, `totalAmount`. **Success:** `202` with echoed `params`.

### `GET /api/streams/[id]` — Single stream lookup (on-chain)

Same shape as `?id=N`.

---

## Refunds

### `GET /api/refunds` — List refund ledger rows (last 50), or reason-code analytics with `?analytics=true`

```bash
curl -X GET http://localhost:3000/api/refunds -H "Authorization: Bearer <api-key>"
```

**Success response** `200`:

```json
{
  "success": true,
  "data": [
    {
      "id": "clrfd_000001uvb3k7n4m2abcdefg",
      "paymentId": "clpay_new00001uvb3k7n4m2ab",
      "amount": "150.0000000",
      "asset": "native",
      "reason": "Duplicate charge reported by customer",
      "reasonCode": 1,
      "status": "REQUESTED",
      "requestedAt": "2026-08-25T14:02:11.220Z",
      "resolvedAt": null,
      "userId": "clusr_owner0001uvb3k7n4m2ab"
    }
  ],
  "meta": { "timestamp": "2026-08-26T12:00:00.000Z" }
}
```

### `POST /api/refunds` — Persist a refund ledger row (after on-chain `request_refund` succeeds)

Requires CSRF. Body matches `createRefundRecordSchema`; `onChainId` is the contract's u64 refund id.

```bash
curl -X POST http://localhost:3000/api/refunds \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <api-key>" \
  -H "x-csrf-token: <csrf-token>" \
  -d '{
    "paymentId": 42,
    "amount": 150,
    "asset": "native",
    "reason": "Duplicate charge reported by customer",
    "reasonCode": 1,
    "onChainId": 87
  }'
```

**Success response** `201`: the created Refund row (`paymentId` stored as string).

### `PATCH /api/refunds/[id]` — Update refund lifecycle status

Body: `{ "status": "APPROVED" | "PROCESSED" | "REJECTED" }`. Sets `resolvedAt`. Unknown/foreign id returns **400** (not 404).

---

## Payment requests

### `GET /api/requests` — List all payment requests for the caller

### `POST /api/requests` — Create a payment request

Fires a `request.created` webhook async.

```bash
curl -X POST http://localhost:3000/api/requests \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <api-key>" \
  -d '{
    "amount": 250,
    "assetCode": "USDC",
    "assetIssuer": "GA5XIGA5C7QTPTWXQHY6MCJTMTR4ZIY3R6QHCNTLDVUMRVOEBUN7ANZ2",
    "description": "Consulting retainer — September",
    "recipientAddress": "GD2PFIIRMAZVA3XLH3UEHBSQWHKQM5FSUVFJE5YVKKS26Y7OG3YVWA2Y"
  }'
```

**Success response** `201`: the created PaymentRequest (`status: "PENDING"`).

---

## Governance

### `GET /api/governance/proposals` — list on-chain governance proposals

Reads `get_proposal_count` then enumerates `get_proposal(id)` on-chain (30s cache). Capped at the 100 most recent; `truncated: true` means older ones were dropped.

```bash
curl http://localhost:3000/api/governance/proposals -H "Authorization: Bearer <api-key>"
```

**Success response** `200`:

```json
{
  "success": true,
  "data": {
    "items": [
      {
        "id": 3,
        "proposer": "GDQNY3PBOJOKYZSRMK2ES7MOWZAHNMGY26PXUDCVQBTULCJT4DL4EBWD",
        "title": "Raise fee collector allocation",
        "description": "Increase treasury share to 15%",
        "action_type": "set_fee_config",
        "target": "CBIELTK6YBZACUFEETUXWMAOLMQBFLLPWEMZOQKEW5QC5PGJK2SIXD2E",
        "data": "eyJmZWVfcmF0ZSI6MTUwfQ==",
        "votes_for": 12,
        "votes_against": 1,
        "executed": false,
        "created_at": 1779800000
      }
    ],
    "total": 42,
    "truncated": true
  },
  "meta": { "timestamp": "2026-08-26T12:00:00.000Z" }
}
```

### `POST /api/governance/proposals` — create an on-chain proposal

Auth: session/API key + CSRF. Schema: `createProposalSchema`.

```bash
curl -X POST http://localhost:3000/api/governance/proposals \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <api-key>" \
  -H "x-csrf-token: <csrf-token>" \
  -d '{
    "proposer": "GDQNY3PBOJOKYZSRMK2ES7MOWZAHNMGY26PXUDCVQBTULCJT4DL4EBWD",
    "title": "Lower payment fee to 20 bps",
    "description": "Reduce platform fee from 25 to 20 basis points",
    "actionType": "set_fee_config",
    "target": "CBIELTK6YBZACUFEETUXWMAOLMQBFLLPWEMZOQKEW5QC5PGJK2SIXD2E",
    "data": "eyJmZWVfcmF0ZV9icHMiOjIwfQ==",
    "depositAsset": "native",
    "depositAmount": 10000000
  }'
```

**Success response** `201`: `{ "txHash": "a4f1...", "proposalId": 43 }`

### `POST /api/governance/vote` — cast a vote

Body: `{ "voter": "G...", "proposalId": 42, "support": true }`. **Success:** `{ "voted": true, "proposalId": 42, "txHash": "..." }`

### `POST /api/governance/execute` — execute a passed proposal

Body: `{ "proposalId": 42 }`. **Success:** `{ "executed": true, "proposalId": 42, "txHash": "..." }`

---

## Multisig

### `GET /api/multisig` — current multisig configuration

```json
{ "success": true, "data": { "threshold": 2, "signers": ["G...", "G...", "G..."], "enabled": true } }
```

Contract unreachable → `{ "threshold": 0, "signers": [], "enabled": false, "source": "contract_unavailable" }`.

### `POST /api/multisig` — configure multisig

Owner-only enforced on-chain. `caller` mandatory; defaults: `threshold=2`, `signers=[]`, `enabled=false`. Missing `caller` → 400.

```bash
curl -X POST http://localhost:3000/api/multisig \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <api-key>" \
  -d '{ "caller": "GDQNY3PBOJOKYZSRMK2ES7MOWZAHNMGY26PXUDCVQBTULCJT4DL4EBWD", "threshold": 2, "signers": ["G...", "G..."], "enabled": true }'
```

**Success response** `200`: `{ "txHash": "...", ...echoed config }`

### `POST /api/multisig/propose` — propose a multisig payment

Auth + CSRF. Body: `createProposalPaymentSchema` (`payee`, `amount`, `assetCode`, `memo`). **Success `201`:** `{ "txHash": "...", "proposalId": 17 }`

### `POST /api/multisig/approve` — signer approves a pending proposal

Body: `{ "requestId": 17 }`. **Success:** `{ "approved": true, "requestId": 17, "txHash": "..." }`

### `POST /api/multisig/execute` — execute a fully approved payment

Body: `{ "requestId": 17 }`. **Success:** `{ "executed": true, "requestId": 17, "txHash": "..." }`

### `GET /api/multisig/requests` — list pending approval requests

Always returns `{ "requests": [], "available": false }` — the contract has no approval-request enumeration; clients degrade gracefully.

---

## Webhooks, hooks & API keys

### `GET /api/webhooks` — list the user's webhooks

Secret never exposed; `hasSecret` boolean instead.

```json
{
  "success": true,
  "data": [
    {
      "id": "clxk29p4g0008t5z3q7n1v2md",
      "userId": "clxk29p4g0001t5z3q9a0b7cx",
      "url": "https://ops.example.com/stellar-webhook",
      "events": "[\"payment.created\",\"payment.failed\"]",
      "isActive": true,
      "hasSecret": true,
      "createdAt": "2026-08-01T09:14:22.103Z",
      "updatedAt": "2026-08-20T16:41:07.882Z"
    }
  ]
}
```

### `POST /api/webhooks` — create a webhook (signing secret returned once)

Auth + CSRF. SSRF guard rejects private/internal URLs.

```bash
curl -X POST http://localhost:3000/api/webhooks \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <api-key>" \
  -H "x-csrf-token: <csrf-token>" \
  -d '{ "url": "https://ops.example.com/stellar-webhook", "events": ["payment.created", "payment.failed"], "isActive": true }'
```

**Success response** `201`: the created webhook including the one-time `secret`.

### `DELETE /api/webhooks?id=<webhook-id>` — delete own webhook

Auth + CSRF. Foreign/unknown id → 400 `Webhook not found`.

### `GET /api/hooks?event_type=<type>` — list active notification hooks (max 50)

### `POST /api/hooks` — persist a notification hook ledger row

Call after on-chain `register_hook` succeeded. Body: `eventType`, `webhookUrl`, optional `onChainId`. **Success `201`.**

### `PATCH /api/hooks/[id]` — activate/deactivate a hook row

Body: `{ "active": false }`. Foreign/unknown id → 400 `Hook not found`.

### `GET /api/keys` — list the user's API keys (no hashes)

### `POST /api/keys` — generate a new API key

Body: `{ "name": "CI pipeline" }`. Raw key returned **once**:

```json
{
  "success": true,
  "data": {
    "id": "clxk5sdt10053t5z3b2m7q9xz",
    "name": "CI pipeline",
    "prefix": "oph_4e5f",
    "key": "oph_4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2"
  }
}
```

### `DELETE /api/keys?id=<key-id>` — revoke an API key

---

## Contracts, events & analytics

### `GET /api/contracts` — contract deployment info and reachability

```json
{
  "success": true,
  "data": {
    "network": "testnet",
    "rpcUrl": "https://soroban-testnet.stellar.org",
    "reachable": true,
    "contracts": {
      "ophirpay": { "id": "CBIELTK6YBZACUFEETUXWMAOLMQBFLLPWEMZOQKEW5QC5PGJK2SIXD2E", "version": 3, "owner": "GDQNY3..." },
      "emitter": { "id": "CCXYZ..." }
    }
  }
}
```

### `GET /api/events` — SSE stream of live payment events

Auth: **none** (public). Emits `connected`, `heartbeat` (15s), `payment:created` (polls every 10s).

```bash
curl -N http://localhost:3000/api/events
```

### `GET /api/events/history?limit=50` — on-chain payment event history

Auth: **none**. Cached 60s; `limit` clamped 1–100.

```json
{
  "success": true,
  "data": {
    "events": [
      { "id": "evt_41", "type": "payment.created", "payer": "G...", "payee": "G...", "amount": "2505000000", "txHash": "a4f1...", "timestamp": 1779720000, "metadata": "" }
    ],
    "total": 41
  }
}
```

(`amount` is in stroops.)

### `GET /api/analytics` — aggregated payment metrics for the authenticated user

```json
{
  "success": true,
  "data": {
    "totalPayments": 148,
    "completedPayments": 131,
    "failedPayments": 9,
    "totalVolume": 48210.75,
    "averageAmount": 368.02,
    "successRate": 89,
    "volumeByDay": [ { "date": "2026-08-25", "volume": 1240.5, "count": 6 } ]
  }
}
```

### `GET /api/stats` — aggregate contract statistics (on-chain)

Counters such as `total_payments_recorded`, `total_escrows_created`, `total_streams_created`, `total_batches_processed`, `total_amount_escrowed` (stroops). Unreachable → all zeros + `available: false`.

### `GET /api/metrics` — Prometheus metrics

Auth: **none**. Returns `text/plain; version=0.0.4` (not the JSON envelope):

```text
# HELP ophirpay_http_requests_total Total HTTP requests served
# TYPE ophirpay_http_requests_total counter
ophirpay_http_requests_total 15230
```

---

## Health & CSRF

### `GET /api/health` — service health probe

Auth: **none**. Returns 503 when the database is down.

```json
{
  "success": true,
  "data": {
    "version": "0.1.0",
    "services": {
      "database": { "status": "ok", "latencyMs": 3 },
      "redis": { "status": "disabled", "latencyMs": null },
      "stellar": { "network": "testnet", "rpcUrl": "https://soroban-testnet.stellar.org", "rpc": { "status": "ok", "latencyMs": 128 } }
    },
    "uptime": 87234.56
  }
}
```

### `GET /api/csrf` — mint a CSRF token

Sets the HttpOnly `__Host-csrf` cookie and returns the raw token for the `x-csrf-token` header. Body is **not** the standard envelope:

```json
{ "token": "8f3a1c94d2e6b7054a19c8d0f2e3b4a5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1" }
```

---

## Fee config, timelock, policy versions, RBAC, audit log

### `GET /api/fee-config` — current fee configuration (on-chain)

```json
{ "success": true, "data": { "fee_rate_bps": 25, "min_fee_stroops": "1000", "flat_fee_stroops": "100", "version": 4 } }
```

Unreachable → `200` with `{ "available": false, "error": "..." }`.

### `GET /api/fee-config/history` — fee config version history (on-chain)

Array of the same version objects. Unreachable → `{ "versions": [], "available": false }`.

### `GET /api/fee-config/collector` — current fee collector address

`{ "collector": "GCXKG..." }`; unreachable → `{ "available": false, "collector": null }`.

### `GET /api/timelock[?id=<n>]` — pending timelocked actions

With `id` (digits only, else 400):

```json
{ "success": true, "data": { "id": 2, "action_type": "set_fee_config", "payload": "eyJmZWVfcmF0ZV9icHMiOjIwfQ==", "executable_at": 1780100000, "executed": false } }
```

Without `id`: a bare array of the same action objects.

### `GET /api/policy-versions` — fee + multisig config version history

```json
{
  "success": true,
  "data": {
    "feeConfigHistory": [ { "fee_rate_bps": 25, "min_fee_stroops": "1000", "flat_fee_stroops": "100", "version": 4 } ],
    "multisigHistory": [ { "threshold": 2, "signers": ["G..."], "enabled": true, "version": 2 } ]
  }
}
```

### `GET /api/rbac[?addr=G…]` — role lookup from the contract

With `addr`: `{ "address": "G...", "role": "admin" }`. Without: `{ "available": true, "message": "Provide ?addr=G... to look up a specific address role" }`.

### `GET /api/audit-log?page=1&limit=20&actor=&action=&since=` — contract audit log

Auth: **API key only** (session cookies not accepted on this route). Query: `page`, `limit` (1–100), optional `actor`, `action`, `since` (unix seconds).

```json
{
  "success": true,
  "data": [
    {
      "id": 512,
      "timestamp": 1779806000,
      "action": "payment_executed",
      "actor": "GDQNY3...",
      "target_id": 17,
      "details": "multisig payout 250.5 XLM approved and executed"
    }
  ],
  "meta": { "page": 1, "limit": 20, "total": 512, "timestamp": "2026-08-26T12:00:00.000Z" }
}
```

### `GET /api/audit-log/sse` — SSE stream of new audit log entries

Auth: **none**. Polls every 15s, emits `connected` then `audit:entry` events (max 10 per poll); auto-disconnects after 10 minutes.

---

## Cross-cutting notes

- On-chain contract reads (`batches/[id]`, `recurring/[id]`, `escrows*`, `streams*`, `stats`, `fee-config*`, `timelock`, `rbac`) use simulated contract calls; their ids are **integers**, unlike the cuid ids on Prisma-backed routes.
- Amounts in contract responses are **stroops** (1 XLM = 10,000,000 stroops); Prisma-backed routes use decimal strings.
- All authenticated routes scope reads/writes to the caller; cross-user access yields 404 (400 on refunds PATCH).
- Contract-unreachable states degrade to HTTP 200 with `available: false` rather than error envelopes on read routes.
