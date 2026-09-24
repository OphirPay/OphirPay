# 🤝 Escrows & Payment Streams API Integration Guide

> **Audience:** Backend integrators, SDK consumers, and financial application developers.  
> **Status:** **API-Only Feature** — currently, **no graphical user interface (UI) exists** for escrows or streams. The HTTP API endpoints and direct Soroban smart contract calls documented here are the sole interface.  
> **UI Tracking Issues:** [Issue #798 (Escrows UI)](https://github.com/OphirPay/OphirPay/issues/798) · [Issue #799 (Payment Streams UI)](https://github.com/OphirPay/OphirPay/issues/799)  
> **Related Documentation:** [API Cookbook](API_COOKBOOK.md) · [OpenAPI Specification](openapi.yaml) · [Contract Function Reference](CONTRACT_FUNCTION_REFERENCE.md) · [Security & Invariants Spec](SPEC.md)

---

## Table of Contents

- [1. Executive Overview](#1-executive-overview)
- [2. UI Availability Notice](#2-ui-availability-notice)
- [3. Architecture & Core Invariants](#3-architecture--core-invariants)
  - [3.1 Two-Tier Execution Model (API Gateway + Wallet Signing)](#31-two-tier-execution-model-api-gateway--wallet-signing)
  - [3.2 The `LOCKED_BALANCE` Solvency Invariant](#32-the-locked_balance-solvency-invariant)
- [4. Escrows](#4-escrows)
  - [4.1 Escrow State Machine](#41-escrow-state-machine)
  - [4.2 Participant Roles & Permissions](#42-participant-roles--permissions)
  - [4.3 HTTP API Reference](#43-http-api-reference)
  - [4.4 Smart Contract Actions (Client-Side)](#44-smart-contract-actions-client-side)
- [5. Payment Streams](#5-payment-streams)
  - [5.1 Stream State Machine](#51-stream-state-machine)
  - [5.2 Linear Vesting Formula & Invariants](#52-linear-vesting-formula--invariants)
  - [5.3 HTTP API Reference](#53-http-api-reference)
  - [5.4 Smart Contract Actions (Client-Side)](#54-smart-contract-actions-client-side)
- [6. Error Codes & Handling Guide](#6-error-codes--handling-guide)
- [7. Complete Integration Walkthrough (TypeScript)](#7-complete-integration-walkthrough-typescript)

---

## 1. Executive Overview

OphirPay provides on-chain escrow locks and continuous linear payment streaming via the OphirPay Soroban smart contract (`contracts/ophirpay/src/lib.rs`). 

The HTTP endpoints exposed by the Next.js API layer serve as an authentication gateway, simulation proxy, and parameter validator:
* **Escrows:** `src/app/api/escrows/route.ts` and `src/app/api/escrows/[id]/route.ts`
* **Streams:** `src/app/api/streams/route.ts` and `src/app/api/streams/[id]/route.ts`

```mermaid
flowchart LR
    subgraph Client / Integrator
        Wallet[User Wallet / Freighter]
        Backend[Integrator Backend]
    end

    subgraph OphirPay API
        API["/api/escrows & /api/streams\n(Validation & Simulation)"]
    end

    subgraph Stellar / Soroban Network
        Contract["OphirPay Soroban Contract\n(State, Escrows & Streams)"]
        SAC["Stellar Asset Contract\n(Token Escrow Vault)"]
    end

    Backend -->|1. Validate Params & Simulate| API
    API -->|Read-only RPC Sim| Contract
    Backend -->|2. Build Transaction| Wallet
    Wallet -->|3. Signed Invocation| Contract
    Contract <-->|Transfer & Lock Tokens| SAC
```

---

## 2. UI Availability Notice

> [!IMPORTANT]
> **No Frontend UI Exists Yet for Escrows or Streams.**
>
> Neither the OphirPay web dashboard (`src/app`) nor navigation sidebar currently contains pages for creating, viewing, claiming, or cancelling escrows or payment streams.
>
> * **Escrow UI Tracking:** Tracked under [GitHub Issue #798](https://github.com/OphirPay/OphirPay/issues/798) (*"Build an escrow management UI, since the feature is currently API-only"*).
> * **Stream UI Tracking:** Tracked under [GitHub Issue #799](https://github.com/OphirPay/OphirPay/issues/799) (*"Build a payment stream UI with vesting progress"*).
>
> Until these UI issues are completed, **integrators and users must interact with escrows and streams exclusively via the HTTP API and Soroban contract calls.**

---

## 3. Architecture & Core Invariants

### 3.1 Two-Tier Execution Model (API Gateway + Wallet Signing)

Because on-chain escrow deposits and stream creation require transferring tokens directly from the user's account to the contract (`token_client.transfer(&depositor, &contract_addr, &amount)`), the OphirPay server cannot sign token-moving transactions on behalf of arbitrary users without custody of their private keys.

Therefore, the API implements a **Two-Tier Model**:
1. **HTTP Layer (`POST /api/escrows` and `POST /api/streams`):**
   Validates request schemas, checks authentication and CSRF tokens, confirms parameters, and returns **`202 Accepted`** with normalized execution parameters.
2. **On-Chain Execution:**
   The client application or SDK uses those normalized parameters to assemble the Soroban transaction, requests the user's wallet signature (via Freighter or secret key), and submits it directly to the Stellar network.
3. **Read Layer (`GET /api/escrows`, `GET /api/streams`):**
   Simulates on-chain contract calls (`get_escrow`, `get_escrow_count`, `get_stream`, `get_stream_count`) via Soroban RPC and returns structured JSON without requiring local wallet state.

### 3.2 The `LOCKED_BALANCE` Solvency Invariant

All escrow and stream deposits are protected by contract invariant **`INV-3: Locked-Funds Protection`** (documented in [`docs/SPEC.md`](SPEC.md)):

$$\text{withdraw\_amount} \le \text{contract\_token\_balance} - \text{LOCKED\_BALANCE}$$

* **What it means:** When an escrow or stream is created, the contract immediately increments `LOCKED_BALANCE` by the deposited amount (`add_locked(&env, amount)`).
* **Protection:** The admin function `emergency_withdraw()` strictly refuses to withdraw any funds covered by `LOCKED_BALANCE`. Even if the contract owner invokes emergency measures, **user escrow deposits and streaming tokens cannot be drained or compromised**.
* **Unlocking:** Only valid release, claim, or cancellation operations decrement `LOCKED_BALANCE`.

---

## 4. Escrows

### 4.1 Escrow State Machine

```mermaid
stateDiagram-v2
    [*] --> Active: create_escrow() [depositor signs, tokens locked]
    
    Active --> Released: release_escrow() [owner signs, tokens -> beneficiary]
    Active --> Released: release_by_arbiter(to_beneficiary = true) [arbiter signs, tokens -> beneficiary]
    Active --> Refunded: release_by_arbiter(to_beneficiary = false) [arbiter signs, tokens -> depositor]
    Active --> Claimed: claim_escrow() [beneficiary signs, now >= deadline]

    Released --> [*]
    Refunded --> [*]
    Claimed --> [*]
```

### 4.2 Participant Roles & Permissions

| Role | Permitted Actions | Preconditions | Contract Error on Failure |
|---|---|---|---|
| **Depositor** | `create_escrow` | Requires `depositor.require_auth()`; amount > 0; sufficient balance. | `InvalidAmount` (5), `TokenTransferFailed` (15) |
| **Owner** (Contract Admin) | `release_escrow` | Requires `owner.require_auth()`; escrow not already released or claimed. Releases funds to beneficiary immediately. | `Unauthorized` (4), `EscrowAlreadyReleased` (7) |
| **Arbiter** (Dispute Resolution) | `release_by_arbiter` | Requires `arbiter.require_auth()`; caller must match `escrow.arbiter`. Can resolve disputes by routing funds to `beneficiary` or refunding to `depositor`. | `Unauthorized` (4), `EscrowAlreadyReleased` (7) |
| **Beneficiary** | `claim_escrow` | Requires `beneficiary.require_auth()`; current ledger timestamp $\ge$ `escrow.deadline`. Transfers tokens to beneficiary. | `Unauthorized` (4), `EscrowAlreadyReleased` (7), `EscrowNotDue` (6) |
| **Public / Reader** | `get_escrow`, `get_escrow_count` | None (public read). | `EscrowNotFound` (8) |

---

### 4.3 HTTP API Reference

#### 1. List Escrow Count or Query by ID
`GET /api/escrows`

**Headers:**
* `Authorization: Bearer <token>` or `X-API-Key: <key>` (Required)

**Query Parameters:**
* `id` *(optional, integer)*: Specific on-chain escrow ID to fetch.

**Example Request (Count):**
```bash
curl -X GET "https://api.ophirpay.com/api/escrows" \
  -H "Authorization: Bearer ophir_live_sk_8f7b2c9e4a1d0f"
```

**Example Response (`200 OK`):**
```json
{
  "success": true,
  "data": {
    "count": 14
  }
}
```

**Example Request (Specific ID via Query):**
```bash
curl -X GET "https://api.ophirpay.com/api/escrows?id=1" \
  -H "Authorization: Bearer ophir_live_sk_8f7b2c9e4a1d0f"
```

**Example Response (`200 OK`):**
```json
{
  "success": true,
  "data": {
    "id": 1,
    "depositor": "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
    "beneficiary": "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
    "arbiter": "GCKIK6UJJ5GDRV47Z2P3N2V376P5Y4G6Z66N2BJZP3M2M2N2M2N2M2N2",
    "amount": "10000000",
    "asset": "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
    "deadline": 1727200000,
    "released": false,
    "claimed": false,
    "metadata": "Milestone delivery escrow"
  }
}
```

---

#### 2. Get Escrow by ID Path Parameter
`GET /api/escrows/{id}`

**Headers:**
* `Authorization: Bearer <token>` or `X-API-Key: <key>` (Required)

**Path Parameters:**
* `id` *(required, integer)*: Numeric on-chain escrow ID.

**Example Request:**
```bash
curl -X GET "https://api.ophirpay.com/api/escrows/1" \
  -H "Authorization: Bearer ophir_live_sk_8f7b2c9e4a1d0f"
```

**Example Response (`200 OK`):**
```json
{
  "success": true,
  "data": {
    "id": 1,
    "depositor": "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
    "beneficiary": "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
    "arbiter": "GCKIK6UJJ5GDRV47Z2P3N2V376P5Y4G6Z66N2BJZP3M2M2N2M2N2M2N2",
    "amount": "10000000",
    "asset": "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
    "deadline": 1727200000,
    "released": false,
    "claimed": false,
    "metadata": "Milestone delivery escrow"
  }
}
```

**Example Error Response (`404 Not Found`):**
```json
{
  "success": false,
  "error": "Escrow 9999 not found"
}
```

---

#### 3. Validate & Prepare Escrow Creation
`POST /api/escrows`

Validates parameters, verifies CSRF (if browser-initiated), and returns normalized parameters for the client wallet invocation.

**Headers:**
* `Authorization: Bearer <token>` or `X-API-Key: <key>` (Required)
* `Content-Type: application/json`

**Request Body Schema:**
| Property | Type | Required | Description |
|---|---|---|---|
| `depositor` | `string` | **Yes** | Stellar public key (`G...`) depositing funds |
| `beneficiary` | `string` | **Yes** | Stellar public key (`G...`) receiving funds |
| `amount` | `number \| string` | **Yes** | Amount in stroops / base token units |
| `asset` | `string` | No | Token SAC contract ID (`C...`) or `"native"` (defaults to `"native"`) |
| `deadline` | `number` | **Yes** | Unix timestamp (seconds) when beneficiary can claim |
| `arbiter` | `string` | No | Optional arbiter Stellar public key (`G...`) |
| `metadata` | `string` | No | Descriptive note or JSON string (max 256 bytes) |

**Example Request:**
```bash
curl -X POST "https://api.ophirpay.com/api/escrows" \
  -H "Authorization: Bearer ophir_live_sk_8f7b2c9e4a1d0f" \
  -H "Content-Type: application/json" \
  -d '{
    "depositor": "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
    "beneficiary": "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
    "arbiter": "GCKIK6UJJ5GDRV47Z2P3N2V376P5Y4G6Z66N2BJZP3M2M2N2M2N2M2N2",
    "amount": "50000000",
    "asset": "native",
    "deadline": 1729000000,
    "metadata": "Smart contract security audit milestone 1"
  }'
```

**Example Response (`202 Accepted`):**
```json
{
  "success": true,
  "data": {
    "message": "Escrow creation requires wallet signing via the client-side createEscrow flow.",
    "params": {
      "depositor": "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
      "beneficiary": "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
      "amount": "50000000",
      "asset": "native",
      "deadline": 1729000000,
      "metadata": "Smart contract security audit milestone 1"
    }
  }
}
```

---

### 4.4 Smart Contract Actions (Client-Side)

Using the parameters returned from `POST /api/escrows`, execute the on-chain calls via `@stellar/stellar-sdk`:

```typescript
import { Contract, nativeToScVal, Address, scValToNative } from "@stellar/stellar-sdk";

const contract = new Contract(process.env.NEXT_PUBLIC_CONTRACT_ID!);

// 1. Create Escrow (signed by depositor)
const createTx = contract.call(
  "create_escrow",
  Address.fromString(params.depositor).toScVal(),
  Address.fromString(params.beneficiary).toScVal(),
  params.arbiter ? nativeToScVal(Address.fromString(params.arbiter), { type: "address" }) : nativeToScVal(null),
  nativeToScVal(BigInt(params.amount), { type: "i128" }),
  Address.fromString(tokenContractAddress).toScVal(),
  nativeToScVal(params.deadline, { type: "u64" }),
  nativeToScVal(params.metadata, { type: "string" })
);

// 2. Claim Escrow (signed by beneficiary after deadline)
const claimTx = contract.call(
  "claim_escrow",
  Address.fromString(beneficiaryAddress).toScVal(),
  nativeToScVal(escrowId, { type: "u64" })
);

// 3. Release by Arbiter (signed by arbiter)
const arbiterTx = contract.call(
  "release_by_arbiter",
  Address.fromString(arbiterAddress).toScVal(),
  nativeToScVal(escrowId, { type: "u64" }),
  nativeToScVal(true, { type: "bool" }) // true: to beneficiary, false: refund to depositor
);
```

---

## 5. Payment Streams

### 5.1 Stream State Machine

```mermaid
stateDiagram-v2
    [*] --> Pending: create_stream() [now < start_time]
    [*] --> Streaming: create_stream() [now >= start_time]
    
    Pending --> Streaming: now >= start_time
    
    Streaming --> Streaming: claim_stream() [claimable > 0]
    Streaming --> Cancelled: cancel_stream() [unvested -> creator, stream stopped]
    Streaming --> Completed: now >= end_time
    
    Completed --> Completed: claim_stream() [claim remainder]
    Completed --> FullyClaimed: claimed_amount == total_amount

    Cancelled --> [*]
    FullyClaimed --> [*]
```

### 5.2 Linear Vesting Formula & Invariants

Streaming payments vest linearly every second between `start_time` and `end_time`. The contract computes vesting via integer arithmetic (`compute_vested` in `contracts/ophirpay/src/lib.rs`):

$$\text{vested}(t) = \begin{cases} 0 & \text{if } t \le \text{start\_time} \\ \text{total\_amount} & \text{if } t \ge \text{end\_time} \\ \left\lfloor \frac{\text{total\_amount} \times (t - \text{start\_time})}{\text{end\_time} - \text{start\_time}} \right\rfloor & \text{if } \text{start\_time} < t < \text{end\_time} \end{cases}$$

$$\text{claimable}(t) = \text{vested}(t) - \text{claimed\_amount}$$

#### Cancellation Mechanics
When `cancel_stream` is called by the stream creator:
1. `unvested = total_amount.saturating_sub(vested)`.
2. `unvested` tokens are refunded immediately to the `creator`.
3. `stream.cancelled = true` is permanently stamped.
4. `LOCKED_BALANCE` is reduced by `unvested`.
5. Further calls to `claim_stream()` or `cancel_stream()` return `StreamAlreadyCancelled` (error 10).

---

### 5.3 HTTP API Reference

#### 1. List Stream Count or Query by ID
`GET /api/streams`

**Headers:**
* `Authorization: Bearer <token>` or `X-API-Key: <key>` (Required)

**Query Parameters:**
* `id` *(optional, integer)*: Specific on-chain stream ID to fetch.

**Example Request (Count):**
```bash
curl -X GET "https://api.ophirpay.com/api/streams" \
  -H "Authorization: Bearer ophir_live_sk_8f7b2c9e4a1d0f"
```

**Example Response (`200 OK`):**
```json
{
  "success": true,
  "data": {
    "count": 8
  }
}
```

**Example Request (Specific Stream via Query):**
```bash
curl -X GET "https://api.ophirpay.com/api/streams?id=3" \
  -H "Authorization: Bearer ophir_live_sk_8f7b2c9e4a1d0f"
```

**Example Response (`200 OK`):**
```json
{
  "success": true,
  "data": {
    "id": 3,
    "creator": "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
    "recipient": "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
    "total_amount": "600000000",
    "claimed_amount": "150000000",
    "asset": "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
    "start_time": 1727100000,
    "end_time": 1729700000,
    "cancelled": false,
    "metadata": "Monthly contractor payroll stream"
  }
}
```

---

#### 2. Get Stream by ID Path Parameter
`GET /api/streams/{id}`

**Headers:**
* `Authorization: Bearer <token>` or `X-API-Key: <key>` (Required)

**Path Parameters:**
* `id` *(required, integer)*: Numeric on-chain stream ID.

**Example Request:**
```bash
curl -X GET "https://api.ophirpay.com/api/streams/3" \
  -H "Authorization: Bearer ophir_live_sk_8f7b2c9e4a1d0f"
```

**Example Response (`200 OK`):**
```json
{
  "success": true,
  "data": {
    "id": 3,
    "creator": "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
    "recipient": "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
    "total_amount": "600000000",
    "claimed_amount": "150000000",
    "asset": "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
    "start_time": 1727100000,
    "end_time": 1729700000,
    "cancelled": false,
    "metadata": "Monthly contractor payroll stream"
  }
}
```

**Example Error Response (`404 Not Found`):**
```json
{
  "success": false,
  "error": "Stream 9999 not found"
}
```

---

#### 3. Validate & Prepare Stream Creation
`POST /api/streams`

**Headers:**
* `Authorization: Bearer <token>` or `X-API-Key: <key>` (Required)
* `Content-Type: application/json`

**Request Body Schema:**
| Property | Type | Required | Description |
|---|---|---|---|
| `creator` | `string` | **Yes** | Stellar public key (`G...`) creating and funding stream |
| `recipient` | `string` | **Yes** | Stellar public key (`G...`) entitled to claim vested tokens |
| `totalAmount` | `number \| string` | **Yes** | Total tokens to vest in stroops / base units |
| `asset` | `string` | No | Token contract ID (`C...`) or `"native"` (defaults to `"native"`) |
| `startTime` | `number` | **Yes** | Unix timestamp (seconds) when vesting begins |
| `endTime` | `number` | **Yes** | Unix timestamp (seconds) when vesting completes (must be > `startTime`) |
| `metadata` | `string` | No | Optional metadata or memo string |

**Example Request:**
```bash
curl -X POST "https://api.ophirpay.com/api/streams" \
  -H "Authorization: Bearer ophir_live_sk_8f7b2c9e4a1d0f" \
  -H "Content-Type: application/json" \
  -d '{
    "creator": "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
    "recipient": "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
    "totalAmount": "1000000000",
    "asset": "native",
    "startTime": 1727200000,
    "endTime": 1729800000,
    "metadata": "Quarterly grant disbursement stream"
  }'
```

**Example Response (`202 Accepted`):**
```json
{
  "success": true,
  "data": {
    "message": "Stream creation requires wallet signing via the client-side createStream flow.",
    "params": {
      "creator": "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
      "recipient": "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
      "totalAmount": "1000000000",
      "asset": "native",
      "startTime": 1727200000,
      "endTime": 1729800000,
      "metadata": "Quarterly grant disbursement stream"
    }
  }
}
```

---

### 5.4 Smart Contract Actions (Client-Side)

```typescript
import { Contract, nativeToScVal, Address } from "@stellar/stellar-sdk";

const contract = new Contract(process.env.NEXT_PUBLIC_CONTRACT_ID!);

// 1. Create Stream (signed by creator)
const createStreamTx = contract.call(
  "create_stream",
  Address.fromString(params.creator).toScVal(),
  Address.fromString(params.recipient).toScVal(),
  nativeToScVal(BigInt(params.totalAmount), { type: "i128" }),
  Address.fromString(tokenContractAddress).toScVal(),
  nativeToScVal(params.startTime, { type: "u64" }),
  nativeToScVal(params.endTime, { type: "u64" }),
  nativeToScVal(params.metadata, { type: "string" })
);

// 2. Claim Vested Tokens (signed by recipient)
const claimStreamTx = contract.call(
  "claim_stream",
  Address.fromString(recipientAddress).toScVal(),
  nativeToScVal(streamId, { type: "u64" })
);

// 3. Cancel Stream (signed by creator)
const cancelStreamTx = contract.call(
  "cancel_stream",
  Address.fromString(creatorAddress).toScVal(),
  nativeToScVal(streamId, { type: "u64" })
);
```

---

## 6. Error Codes & Handling Guide

When calling smart contract functions or handling simulated responses from the API, integrators must handle the following contract error codes defined in [`contracts/ophirpay/src/lib.rs`](../contracts/ophirpay/src/lib.rs):

| Numeric Code | Error Name | Operation | Description | Handling Recommendation |
|---|---|---|---|---|
| **4** | `Unauthorized` | `release_escrow`<br>`release_by_arbiter`<br>`claim_escrow`<br>`claim_stream`<br>`cancel_stream` | The caller is not authorized for this action (e.g. caller is not the configured arbiter, or not the stream recipient). | Verify active wallet address before sending transaction. Display clear role error in client. |
| **5** | `InvalidAmount` | `create_escrow`<br>`create_stream` | Deposit amount $\le 0$, or `endTime <= startTime`. | Validate amounts and timestamps prior to initiating transaction. |
| **6** | `EscrowNotDue` | `claim_escrow` | Current ledger timestamp < `deadline`. | Beneficiary cannot claim early. Display countdown timer until deadline. |
| **7** | `EscrowAlreadyReleased` | `release_escrow`<br>`release_by_arbiter`<br>`claim_escrow` | The escrow has already been claimed, released, or refunded. | Escrows can be released at most once (`INV-4`). Refresh UI state; mark escrow as resolved. |
| **8** | `EscrowNotFound` | `get_escrow`<br>`release_*`<br>`claim_escrow` | The requested escrow ID does not exist in persistent storage. | Check ID parameter; verify transaction succeeded during creation. |
| **9** | `StreamNotStarted` | `claim_stream` | Current ledger timestamp < `start_time`. | Stream has not begun vesting. Wait until `start_time` before claiming. |
| **10** | `StreamAlreadyCancelled` | `claim_stream`<br>`cancel_stream` | Stream was already cancelled by the creator. | Unvested funds were returned to creator. Disallow further claims. |
| **11** | `StreamNotFound` | `get_stream`<br>`claim_stream`<br>`cancel_stream` | The stream ID does not exist. | Confirm stream ID. |
| **12** | `StreamFullyClaimed` | `claim_stream` | All currently vested tokens have already been claimed (`claimable <= 0`). | Advise recipient that no new vested balance is currently available. |
| **15** | `TokenTransferFailed` | All token-moving calls | Token balance insufficient or SAC transfer failed. | Ensure account has sufficient funded balance and trustlines established. |
| **18** | `ContractPaused` | All state mutations | Global contract emergency pause is engaged. | System is in emergency pause (`INV-7`). Retry when unpaused. |

---

## 7. Complete Integration Walkthrough (TypeScript)

The following runnable TypeScript recipe demonstrates how an integrator interacts with the Escrow and Stream API:

```typescript
import { Keypair, Contract, Address, nativeToScVal, scValToNative } from "@stellar/stellar-sdk";

const API_BASE = "https://api.ophirpay.com";
const API_KEY = "ophir_live_sk_8f7b2c9e4a1d0f";

async function createAndVerifyEscrow() {
  const depositor = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
  const beneficiary = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";
  const deadline = Math.floor(Date.now() / 1000) + 86400 * 7; // 7 days

  // Step 1: Validate through OphirPay API
  const prepRes = await fetch(`${API_BASE}/api/escrows`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      depositor,
      beneficiary,
      amount: "100000000", // 10 XLM in stroops
      deadline,
      metadata: "Milestone 1 Deliverable"
    })
  });

  const prepData = await prepRes.json();
  if (prepRes.status !== 202) {
    throw new Error(`Validation failed: ${JSON.stringify(prepData)}`);
  }

  console.log("Validated parameters from API:", prepData.data.params);

  // Step 2: The client application signs and invokes the contract via Soroban RPC
  // (In browser: Freighter wallet; In backend: Keypair.fromSecret(...))
  // ... contract.call("create_escrow", ...) ...

  // Step 3: Fetch escrow details from API
  const escrowId = 1;
  const detailRes = await fetch(`${API_BASE}/api/escrows/${escrowId}`, {
    headers: { "Authorization": `Bearer ${API_KEY}` }
  });
  const detailData = await detailRes.json();
  console.log("Fetched Escrow:", detailData.data);
}
```
