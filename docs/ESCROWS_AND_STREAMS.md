# Escrow and Stream HTTP APIs

> **No UI yet.** There is currently no dashboard page for escrows or streams.
> All interaction is through the HTTP API documented here. A management UI is
> planned but has no scheduled release date. Integrators must use the API
> directly.

---

## Table of Contents

1. [Overview](#1-overview)
2. [Authentication](#2-authentication)
3. [Response envelope](#3-response-envelope)
4. [Escrow API](#4-escrow-api)
   - [GET /api/escrows](#get-apiescrows)
   - [POST /api/escrows](#post-apiescrows)
   - [GET /api/escrows/:id](#get-apiescrowsid)
   - [Escrow state machine](#escrow-state-machine)
   - [Escrow error codes](#escrow-error-codes)
5. [Stream API](#5-stream-api)
   - [GET /api/streams](#get-apistreams)
   - [POST /api/streams](#post-apistreams)
   - [GET /api/streams/:id](#get-apistreamsid)
   - [Stream state machine](#stream-state-machine)
   - [Linear vesting formula](#linear-vesting-formula)
   - [Stream error codes](#stream-error-codes)
6. [LOCKED_BALANCE interaction](#6-locked_balance-interaction)
7. [Contract functions reference](#7-contract-functions-reference)

---

## 1. Overview

Escrows and streams are on-chain primitives managed by the OphirPay smart
contract. The HTTP API is a thin read/write façade:

- **Read endpoints** (`GET`) call `simulateContractCall` against the on-chain
  state. No database record is created.
- **Write endpoints** (`POST`) do **not** submit transactions. They validate
  the request, assemble the parameters, and return them with a `202 Accepted`
  response. **The calling client must sign and submit the transaction** using
  the Freighter wallet or another Stellar-compatible signer.

This split means the server never holds private keys, and the on-chain state is
always the authoritative source of truth.

---

## 2. Authentication

All endpoints require authentication. Two methods are accepted:

| Method | How to supply |
|--------|--------------|
| Wallet session | Connect with Freighter (or any SEP-10 compatible wallet). A session cookie is set automatically. |
| API key | Pass the key in the `Authorization` header: `Authorization: Bearer <key>` |

Unauthenticated requests receive:

```json
HTTP/1.1 401 Unauthorized

{
  "success": false,
  "error": {
    "code": "UNAUTHORIZED",
    "message": "Authentication required. Connect your wallet or provide an API key."
  }
}
```

**CSRF protection** — mutating requests (`POST`, `PATCH`, `DELETE`) additionally
require a valid CSRF token pair:

- Request header: `x-csrf-token: <token>`
- Cookie: `__Host-csrf=<same-token>`

The token is obtained from the `/api/auth/csrf` endpoint after establishing a
session.

---

## 3. Response envelope

All responses use the shared envelope:

```json
{
  "success": true,
  "data": { ... }
}
```

Error responses:

```json
{
  "success": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable description"
  }
}
```

---

## 4. Escrow API

### GET /api/escrows

List escrows or fetch a single escrow by query parameter. Reads on-chain state.

**Without `?id`** — returns the total escrow count.

**Request**

```http
GET /api/escrows HTTP/1.1
Authorization: Bearer ophirpay_sk_live_abc123
```

**Response 200**

```json
{
  "success": true,
  "data": {
    "count": 42
  }
}
```

---

**With `?id=<N>`** — returns the escrow object for ID `N`.

**Request**

```http
GET /api/escrows?id=7 HTTP/1.1
Authorization: Bearer ophirpay_sk_live_abc123
```

**Response 200**

```json
{
  "success": true,
  "data": {
    "id": 7,
    "depositor": "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
    "beneficiary": "GACNKEDGJYLLVQDXWYEEPB47Y3JEV5JNZ3RQANTJIVKKEOXX4NC4YWHU",
    "arbiter": "GDQOE23CFSUMSVQK4Y5JHPPYK73VYCNHZHA7ENKCV37P6SUEO6XQBKPP",
    "amount": 500,
    "asset": "native",
    "status": 1,
    "deadline": 1785000000,
    "metadata": { "invoice": "INV-2026-0099" }
  }
}
```

**Status field mapping**

| Value | State |
|-------|-------|
| 0 | PENDING |
| 1 | ACTIVE |
| 2 | RELEASED |
| 3 | CLAIMED |
| 4 | EXPIRED |

**Response when escrow ID is not found on-chain**

```json
{
  "success": true,
  "data": {
    "available": false,
    "error": "Escrow not found"
  }
}
```

---

### POST /api/escrows

Prepare escrow creation parameters. Returns `202 Accepted` with the parameters
the client must use to sign and submit the `create_escrow` contract call.

**No on-chain write is performed by this endpoint.**

**Request**

```http
POST /api/escrows HTTP/1.1
Authorization: Bearer ophirpay_sk_live_abc123
Content-Type: application/json
x-csrf-token: tok_csrf_example
Cookie: __Host-csrf=tok_csrf_example

{
  "depositor":   "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
  "beneficiary": "GACNKEDGJYLLVQDXWYEEPB47Y3JEV5JNZ3RQANTJIVKKEOXX4NC4YWHU",
  "amount":      "500",
  "asset":       "native",
  "deadline":    1785000000,
  "metadata":    { "invoice": "INV-2026-0099" }
}
```

**Required fields**

| Field | Type | Description |
|-------|------|-------------|
| `depositor` | string | Stellar account ID of the party funding the escrow |
| `beneficiary` | string | Stellar account ID of the intended recipient |
| `amount` | string | Amount in stroops (XLM) or token units |

**Optional fields**

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `asset` | string | `"native"` | Asset code. Use `"native"` for XLM or a Stellar asset identifier |
| `deadline` | number | none | Unix timestamp after which the escrow expires |
| `metadata` | object | none | Arbitrary JSON object stored with the escrow |

**Response 202**

```json
{
  "success": true,
  "data": {
    "message": "Escrow creation requires wallet signing via the client-side createEscrow flow.",
    "params": {
      "depositor":   "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
      "beneficiary": "GACNKEDGJYLLVQDXWYEEPB47Y3JEV5JNZ3RQANTJIVKKEOXX4NC4YWHU",
      "amount":      "500",
      "asset":       "native",
      "deadline":    1785000000,
      "metadata":    { "invoice": "INV-2026-0099" }
    }
  }
}
```

After receiving this response, the client signs and submits the transaction
by calling the `create_escrow` contract function with the returned `params`.
See [Contract functions reference](#7-contract-functions-reference).

**Response 400 — missing required fields**

```json
{
  "success": false,
  "error": {
    "code": "BAD_REQUEST",
    "message": "depositor, beneficiary, and amount are required"
  }
}
```

---

### GET /api/escrows/:id

Fetch a single escrow by path parameter. Reads on-chain state.

**Request**

```http
GET /api/escrows/7 HTTP/1.1
Authorization: Bearer ophirpay_sk_live_abc123
```

**Response 200**

```json
{
  "success": true,
  "data": {
    "id": 7,
    "depositor": "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
    "beneficiary": "GACNKEDGJYLLVQDXWYEEPB47Y3JEV5JNZ3RQANTJIVKKEOXX4NC4YWHU",
    "arbiter": "GDQOE23CFSUMSVQK4Y5JHPPYK73VYCNHZHA7ENKCV37P6SUEO6XQBKPP",
    "amount": 500,
    "asset": "native",
    "status": 1,
    "deadline": 1785000000,
    "metadata": { "invoice": "INV-2026-0099" }
  }
}
```

**Response 400 — non-numeric ID**

```json
{
  "success": false,
  "error": {
    "code": "BAD_REQUEST",
    "message": "Invalid escrow ID — must be a positive integer"
  }
}
```

**Response 404 — escrow not found on-chain**

```json
{
  "success": false,
  "error": {
    "code": "ESCROW_NOT_FOUND",
    "message": "Escrow 7 not found"
  }
}
```

---

### Escrow state machine

```
                   ┌─────────┐
              ──►  │ PENDING │  (create_escrow submitted; funds not yet locked)
                   └────┬────┘
                        │  depositor funds contract
                        ▼
                   ┌────────┐
                   │ ACTIVE │  (funds locked in LOCKED_BALANCE)
                   └───┬────┘
          ┌────────────┼────────────┐
          │            │            │
          ▼            ▼            ▼
    ┌──────────┐  ┌─────────┐  ┌─────────┐
    │ RELEASED │  │ CLAIMED │  │ EXPIRED │
    └──────────┘  └─────────┘  └─────────┘
```

| Transition | Triggered by |
|------------|-------------|
| PENDING → ACTIVE | `create_escrow` on-chain confirmation + funds locked |
| ACTIVE → RELEASED | `release_escrow` (depositor) or `release_by_arbiter` (arbiter) |
| ACTIVE → CLAIMED | `claim_escrow` (beneficiary, after release) |
| ACTIVE → EXPIRED | `deadline` passes without release |

**Arbiter role** — An optional third party (`arbiter` field) can call
`release_by_arbiter` to release funds when the depositor and beneficiary
cannot agree. The arbiter is set at creation time and cannot be changed
afterwards. Calling `release_by_arbiter` with an account that is not the
designated arbiter returns `UNAUTHORIZED_ARBITER` (403).

---

### Escrow error codes

| Code | HTTP status | When it occurs |
|------|-------------|----------------|
| `ESCROW_NOT_FOUND` | 404 | The escrow ID does not exist on-chain |
| `ESCROW_ALREADY_FUNDED` | 409 | A `create_escrow` call targets an ID already funded |
| `ESCROW_ALREADY_COMPLETED` | 409 | The escrow is in a terminal state (RELEASED, CLAIMED, or EXPIRED) |
| `ESCROW_EXPIRED` | 422 | A release or claim was attempted after the deadline passed |
| `ESCROW_DISPUTED` | 422 | The escrow is in a disputed state pending arbiter resolution |
| `UNAUTHORIZED_ARBITER` | 403 | `release_by_arbiter` was called by an account that is not the designated arbiter |
| `UNAUTHORIZED` | 401 | Request lacks a valid wallet session or API key |
| `BAD_REQUEST` | 400 | Required fields missing or malformed |

---

## 5. Stream API

### GET /api/streams

List streams or fetch a single stream by query parameter. Reads on-chain state.

**Without `?id`** — returns the total stream count.

**Request**

```http
GET /api/streams HTTP/1.1
Authorization: Bearer ophirpay_sk_live_abc123
```

**Response 200**

```json
{
  "success": true,
  "data": {
    "count": 18
  }
}
```

---

**With `?id=<N>`** — returns the stream object for ID `N`.

**Request**

```http
GET /api/streams?id=3 HTTP/1.1
Authorization: Bearer ophirpay_sk_live_abc123
```

**Response 200**

```json
{
  "success": true,
  "data": {
    "id": 3,
    "creator":       "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
    "recipient":     "GACNKEDGJYLLVQDXWYEEPB47Y3JEV5JNZ3RQANTJIVKKEOXX4NC4YWHU",
    "totalAmount":   1000,
    "claimedAmount": 250,
    "asset":         "native",
    "startTime":     1753920000,
    "endTime":       1785456000,
    "status":        0,
    "metadata":      { "project": "retainer-q3" }
  }
}
```

**Status field mapping**

| Value | State |
|-------|-------|
| 0 | ACTIVE |
| 1 | FULLY_CLAIMED |
| 2 | CANCELLED |

**Response when stream ID is not found on-chain**

```json
{
  "success": true,
  "data": {
    "available": false,
    "error": "Stream not found"
  }
}
```

---

### POST /api/streams

Prepare stream creation parameters. Returns `202 Accepted` with the parameters
the client must use to sign and submit the `create_stream` contract call.

**No on-chain write is performed by this endpoint.**

**Request**

```http
POST /api/streams HTTP/1.1
Authorization: Bearer ophirpay_sk_live_abc123
Content-Type: application/json
x-csrf-token: tok_csrf_example
Cookie: __Host-csrf=tok_csrf_example

{
  "creator":     "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
  "recipient":   "GACNKEDGJYLLVQDXWYEEPB47Y3JEV5JNZ3RQANTJIVKKEOXX4NC4YWHU",
  "totalAmount": "1000",
  "asset":       "native",
  "startTime":   1753920000,
  "endTime":     1785456000,
  "metadata":    { "project": "retainer-q3" }
}
```

**Required fields**

| Field | Type | Description |
|-------|------|-------------|
| `creator` | string | Stellar account ID of the party funding the stream |
| `recipient` | string | Stellar account ID receiving the streamed funds |
| `totalAmount` | string | Total amount to stream in stroops (XLM) or token units |

**Optional fields**

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `asset` | string | `"native"` | Asset code. Use `"native"` for XLM or a Stellar asset identifier |
| `startTime` | number | current block time | Unix timestamp when streaming begins |
| `endTime` | number | none | Unix timestamp when streaming ends (required for vesting calculation) |
| `metadata` | object | none | Arbitrary JSON object stored with the stream |

**Response 202**

```json
{
  "success": true,
  "data": {
    "message": "Stream creation requires wallet signing via the client-side createStream flow.",
    "params": {
      "creator":     "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
      "recipient":   "GACNKEDGJYLLVQDXWYEEPB47Y3JEV5JNZ3RQANTJIVKKEOXX4NC4YWHU",
      "totalAmount": "1000",
      "asset":       "native",
      "startTime":   1753920000,
      "endTime":     1785456000,
      "metadata":    { "project": "retainer-q3" }
    }
  }
}
```

After receiving this response, the client signs and submits the transaction by
calling `create_stream` with the returned `params`. See
[Contract functions reference](#7-contract-functions-reference).

**Response 400 — missing required fields**

```json
{
  "success": false,
  "error": {
    "code": "BAD_REQUEST",
    "message": "creator, recipient, and totalAmount are required"
  }
}
```

---

### GET /api/streams/:id

Fetch a single stream by path parameter. Reads on-chain state.

**Request**

```http
GET /api/streams/3 HTTP/1.1
Authorization: Bearer ophirpay_sk_live_abc123
```

**Response 200**

```json
{
  "success": true,
  "data": {
    "id": 3,
    "creator":       "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
    "recipient":     "GACNKEDGJYLLVQDXWYEEPB47Y3JEV5JNZ3RQANTJIVKKEOXX4NC4YWHU",
    "totalAmount":   1000,
    "claimedAmount": 250,
    "asset":         "native",
    "startTime":     1753920000,
    "endTime":       1785456000,
    "status":        0,
    "metadata":      { "project": "retainer-q3" }
  }
}
```

**Response 404 — stream not found on-chain**

```json
{
  "success": false,
  "error": {
    "code": "STREAM_NOT_FOUND",
    "message": "Stream 3 not found"
  }
}
```

---

### Stream state machine

```
              ┌────────┐
         ──►  │ ACTIVE │  (create_stream confirmed; funds locked in LOCKED_BALANCE)
              └───┬────┘
         ┌────────┴────────┐
         │                 │
         ▼                 ▼
  ┌──────────────┐   ┌───────────┐
  │ FULLY_CLAIMED │   │ CANCELLED │
  └──────────────┘   └───────────┘
```

| Transition | Triggered by |
|------------|-------------|
| → ACTIVE | `create_stream` on-chain confirmation |
| ACTIVE → FULLY_CLAIMED | `claim_stream` called after full vesting period elapses |
| ACTIVE → CANCELLED | `cancel_stream` called by the creator |

When a stream is cancelled, vested-but-unclaimed funds remain claimable by the
recipient. Unvested funds are returned to the creator.

---

### Linear vesting formula

The claimable amount at any point in time is computed linearly:

```
claimable = totalAmount × (now − startTime) / (endTime − startTime)
```

Where:
- `now` is the current ledger close time (Unix timestamp)
- All values are integers (stroops or token units)
- `claimable` is clamped to `[0, totalAmount]`

The **already-claimed** amount is tracked on-chain as `claimedAmount`. The
amount available in a single `claim_stream` call is:

```
available = claimable − claimedAmount
```

**Example** — a stream of 1 000 XLM over 365 days, with 90 days elapsed and
100 XLM already claimed:

```
claimable = 1000 × (90 / 365) ≈ 246.58 XLM
available = 246.58 − 100     = 146.58 XLM
```

The contract uses integer arithmetic; the result is rounded down.

---

### Stream error codes

| Code | HTTP status | When it occurs |
|------|-------------|----------------|
| `STREAM_NOT_FOUND` | 404 | The stream ID does not exist on-chain |
| `STREAM_ALREADY_ACTIVE` | 409 | A `create_stream` call targets an ID already in use |
| `STREAM_CANCELLED` | 422 | A claim was attempted on a cancelled stream |
| `STREAM_COMPLETED` | 422 | A claim was attempted on a fully-claimed stream |
| `STREAM_PAUSED` | 422 | A claim was attempted while the stream is paused |
| `UNAUTHORIZED` | 401 | Request lacks a valid wallet session or API key |
| `BAD_REQUEST` | 400 | Required fields missing or malformed |

---

## 6. LOCKED_BALANCE interaction

Both escrows and streams lock funds in the contract's `LOCKED_BALANCE` ledger
entry for the duration of the operation. This has two practical implications:

1. **Account balance** — The `depositor` / `creator` account's available
   balance is reduced by the locked amount until the escrow is released/claimed
   or the stream is cancelled.

2. **Reserve requirements** — Stellar requires every account to maintain a
   minimum XLM reserve. Locking large amounts may bring an account below the
   base reserve. If this happens the transaction fails with
   `INSUFFICIENT_RESERVE` before any funds are locked.

3. **Concurrent operations** — Multiple escrows and streams can lock funds
   simultaneously. The `LOCKED_BALANCE` entry is the sum of all active locks
   for the contract. It does not represent funds belonging to a single
   depositor — the per-escrow and per-stream amounts are stored in separate
   ledger entries.

When an escrow is released/claimed or a stream is fully claimed or cancelled,
the corresponding lock is removed and `LOCKED_BALANCE` decreases accordingly.

---

## 7. Contract functions reference

The following Soroban contract functions are invoked by the client after
receiving a `202` response from the POST endpoints above.

### Escrow contract functions

| Function | Caller | Description |
|----------|--------|-------------|
| `create_escrow(depositor, beneficiary, amount, asset, deadline, metadata)` | Depositor | Creates and funds the escrow. Locks `amount` in `LOCKED_BALANCE`. |
| `release_escrow(escrow_id)` | Depositor | Releases funds to the beneficiary. Escrow moves to RELEASED state. |
| `release_by_arbiter(escrow_id)` | Arbiter | Releases funds when the depositor and beneficiary cannot agree. Caller must match the `arbiter` set at creation. |
| `claim_escrow(escrow_id)` | Beneficiary | Claims the released funds. Escrow moves to CLAIMED state. |

### Stream contract functions

| Function | Caller | Description |
|----------|--------|-------------|
| `create_stream(creator, recipient, totalAmount, asset, startTime, endTime, metadata)` | Creator | Creates the stream and locks `totalAmount` in `LOCKED_BALANCE`. |
| `claim_stream(stream_id)` | Recipient | Claims the currently vested and unclaimed portion. Moves to FULLY_CLAIMED when all funds are claimed. |
| `cancel_stream(stream_id)` | Creator | Cancels the stream. Returns unvested funds to the creator; vested funds remain claimable by the recipient. |

For the full contract ABI including argument types see
[`docs/CONTRACT_FUNCTION_REFERENCE.md`](./CONTRACT_FUNCTION_REFERENCE.md).
