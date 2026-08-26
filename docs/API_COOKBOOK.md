# OphirPay API Cookbook

A comprehensive, runnable reference and cookbook for every endpoint in the OphirPay Stellar Payment Platform API.

---

## Table of Contents

1. [Overview & Base URLs](#overview--base-urls)
2. [Authentication](#authentication)
3. [Standard Response & Error Envelopes](#standard-response--error-envelopes)
4. [Payments API](#payments-api)
   - [GET /api/payments](#1-list-payments)
   - [POST /api/payments](#2-create-payment)
   - [GET /api/payments/{id}](#3-get-payment-by-id)
   - [PATCH /api/payments/{id}](#4-update-payment)
   - [DELETE /api/payments/{id}](#5-delete-payment)
5. [Escrows API (On-Chain)](#escrows-api-on-chain)
   - [GET /api/escrows](#6-list-escrows)
   - [POST /api/escrows](#7-create-escrow)
   - [GET /api/escrows/{id}](#8-get-escrow-by-id)
6. [Payment Streams API (On-Chain)](#payment-streams-api-on-chain)
   - [GET /api/streams](#9-list-streams)
   - [POST /api/streams](#10-create-stream)
   - [GET /api/streams/{id}](#11-get-stream-by-id)
7. [Batch Payments API](#batch-payments-api)
   - [GET /api/batches](#12-list-batches)
   - [POST /api/batches](#13-create-batch-payment)
   - [GET /api/batches/{id}](#14-get-batch-by-id)
8. [Recurring Payments API](#recurring-payments-api)
   - [GET /api/recurring](#15-list-recurring-schedules)
   - [POST /api/recurring](#16-create-recurring-schedule)
   - [GET /api/recurring/{id}](#17-get-recurring-schedule-by-id)
9. [Payment Requests (Links) API](#payment-requests-links-api)
   - [GET /api/requests](#18-list-payment-requests)
   - [POST /api/requests](#19-create-payment-request)
10. [Webhooks API](#webhooks-api)
    - [GET /api/webhooks](#20-list-webhooks)
    - [POST /api/webhooks](#21-register-webhook)
    - [DELETE /api/webhooks](#22-delete-webhook)
11. [API Keys API](#api-keys-api)
    - [GET /api/keys](#23-list-api-keys)
    - [POST /api/keys](#24-generate-api-key)
    - [DELETE /api/keys](#25-revoke-api-key)
12. [Multisig Governance API (On-Chain)](#multisig-governance-api-on-chain)
    - [GET /api/multisig](#26-get-multisig-config)
    - [POST /api/multisig/propose](#27-propose-multisig-action)
    - [POST /api/multisig/approve](#28-approve-multisig-proposal)
    - [POST /api/multisig/execute](#29-execute-multisig-proposal)
    - [GET /api/multisig/requests](#30-list-multisig-requests)
13. [DAO Governance API (On-Chain)](#dao-governance-api-on-chain)
    - [GET /api/governance/proposals](#31-list-governance-proposals)
    - [POST /api/governance/proposals](#32-create-governance-proposal)
    - [POST /api/governance/vote](#33-vote-on-proposal)
    - [POST /api/governance/execute](#34-execute-proposal)
14. [Analytics & Refunds API](#analytics--refunds-api)
    - [GET /api/analytics](#35-get-payment-analytics)
    - [GET /api/refunds](#36-list-refunds)
    - [POST /api/refunds](#37-create-refund)
    - [PATCH /api/refunds/{id}](#38-update-refund-status)
15. [Notification Hooks & Audit Logs](#notification-hooks--audit-logs)
    - [GET /api/hooks](#39-list-notification-hooks)
    - [POST /api/hooks](#40-register-notification-hook)
    - [PATCH /api/hooks/{id}](#41-update-notification-hook)
    - [GET /api/audit-log](#42-query-audit-log)
    - [GET /api/audit-log/sse](#43-audit-log-sse-stream)
16. [System, Protocol & Diagnostics](#system-protocol--diagnostics)
    - [GET /api/timelock](#44-get-timelock-status)
    - [GET /api/rbac](#45-query-rbac-roles)
    - [GET /api/fee-config](#46-get-fee-configuration)
    - [GET /api/fee-config/collector](#47-get-fee-collector-address)
    - [GET /api/fee-config/history](#48-get-fee-config-history)
    - [GET /api/policy-versions](#49-get-policy-versions)
    - [GET /api/contracts](#50-get-contract-deployments)
    - [GET /api/stats](#51-get-aggregate-stats)
    - [GET /api/events](#52-subscribe-payment-events-sse)
    - [GET /api/events/history](#53-get-event-history)
    - [GET /api/csrf](#54-get-csrf-token)
    - [GET /api/health](#55-service-health-check)
    - [GET /api/metrics](#56-prometheus-metrics)

---

## Overview & Base URLs

| Environment | Base URL |
|---|---|
| **Production** | `https://api.ophirpay.com` |
| **Local Development** | `http://localhost:3000` |

---

## Authentication

OphirPay supports two header-based authentication modes for protected endpoints:

### Option 1: Bearer Token (Recommended)
```http
Authorization: Bearer oph_live_sk_9f82a1c0d4e7b6a51234567890abcdef
```

### Option 2: Custom Header
```http
X-API-Key: oph_live_sk_9f82a1c0d4e7b6a51234567890abcdef
```

*Note: API keys are generated via `POST /api/keys`.*

---


### CSRF Protection for State Mutations

All state-modifying endpoints (such as Governance, Multisig proposals/approvals, Webhooks, Refunds, and Hooks) enforce double-submit CSRF validation:

1. **Mint CSRF Token & Cookie Jar:**
   ```bash
   # Fetch CSRF token and save session cookie into cookies.txt
   CSRF_TOKEN=$(curl -s -c cookies.txt -X GET "https://api.ophirpay.com/api/csrf" | grep -o '"token":"[^"]*' | cut -d'"' -f4)
   ```
   *This endpoint returns `{"token":"<token>"}` and sets the `__Host-csrf` HttpOnly cookie in `cookies.txt`.*

2. **Execute State Mutation:** Pass the cookie jar (`-b cookies.txt`) and the token header (`-H "x-csrf-token: $CSRF_TOKEN"`):
   ```bash
   curl -b cookies.txt -X POST "https://api.ophirpay.com/api/governance/proposals" \
     -H "Authorization: Bearer oph_live_sk_test123456" \
     -H "x-csrf-token: $CSRF_TOKEN" \
     -H "Content-Type: application/json" \
     -d '{ "title": "Reduce Platform Fee", "description": "Adjust fee", "action": "SET_FEE_BPS" }'
   ```

## Standard Response & Error Envelopes

### Standard Success Response Format
```json
{
  "success": true,
  "data": {
    "id": "pay_01J6A1B2C3D4E5F6G7H8J9K0",
    "amount": 1500000000,
    "assetCode": "XLM",
    "status": "COMPLETED"
  },
  "meta": {
    "page": 1,
    "limit": 20,
    "total": 1
  }
}
```

### Standard Error Response Format
```json
{
  "success": false,
  "error": "ValidationError",
  "message": "Invalid destination address",
  "statusCode": 400
}
```

---

## Payments API

### 1. List Payments
Retrieve a paginated list of payments with filtering.

```bash
curl -X GET "https://api.ophirpay.com/api/payments?page=1&limit=20&status=COMPLETED" \
  -H "Authorization: Bearer oph_live_sk_test123456" \
  -H "Accept: application/json"
```

**Sample Response (200 OK):**
```json
{
  "success": true,
  "data": [
    {
      "id": "pay_01J6A1B2C3D4E5F6G7H8J9K0",
      "amount": 1500000000,
      "assetCode": "XLM",
      "assetIssuer": null,
      "sourceAccountId": "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
      "destAddress": "GAHK7EEG2WWHVKDNT4CEQFZGKF2LGDSW2IVM4S5DP42RBW3K6BTODBBI",
      "status": "COMPLETED",
      "memo": "Invoice #1042",
      "description": "Monthly API Retainer",
      "transactionHash": "4f6a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a",
      "userId": "usr_01J6A0B1C2D3E4F5G6H7J8",
      "batchId": null,
      "createdAt": "2026-08-26T10:15:30.000Z",
      "completedAt": "2026-08-26T10:15:35.000Z",
      "errorMessage": null
    }
  ],
  "meta": {
    "page": 1,
    "limit": 20,
    "total": 1
  }
}
```

---

### 2. Create Payment
Submit a new direct payment.

```bash
curl -X POST "https://api.ophirpay.com/api/payments" \
  -H "Authorization: Bearer oph_live_sk_test123456" \
  -H "Content-Type: application/json" \
  -d '{
    "amount": 2500000000,
    "assetCode": "XLM",
    "sourceAccountId": "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
    "destAddress": "GAHK7EEG2WWHVKDNT4CEQFZGKF2LGDSW2IVM4S5DP42RBW3K6BTODBBI",
    "memo": "August Retainer",
    "description": "Engineering Retainer August 2026"
  }'
```

**Sample Response (201 Created):**
```json
{
  "success": true,
  "data": {
    "id": "pay_01J6A7D8E9F0A1B2C3D4E5F6G7",
    "amount": 2500000000,
    "assetCode": "XLM",
    "assetIssuer": null,
    "sourceAccountId": "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
    "destAddress": "GAHK7EEG2WWHVKDNT4CEQFZGKF2LGDSW2IVM4S5DP42RBW3K6BTODBBI",
    "status": "PENDING",
    "memo": "August Retainer",
    "description": "Engineering Retainer August 2026",
    "transactionHash": null,
    "userId": "usr_01J6A0B1C2D3E4F5G6H7J8",
    "batchId": null,
    "createdAt": "2026-08-26T11:00:00.000Z",
    "completedAt": null,
    "errorMessage": null
  }
}
```

---

### 3. Get Payment by ID
Retrieve details for a single payment.

```bash
curl -X GET "https://api.ophirpay.com/api/payments/pay_01J6A1B2C3D4E5F6G7H8J9K0" \
  -H "Authorization: Bearer oph_live_sk_test123456"
```

**Sample Response (200 OK):**
```json
{
  "success": true,
  "data": {
    "id": "pay_01J6A1B2C3D4E5F6G7H8J9K0",
    "amount": 1500000000,
    "assetCode": "XLM",
    "assetIssuer": null,
    "sourceAccountId": "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
    "destAddress": "GAHK7EEG2WWHVKDNT4CEQFZGKF2LGDSW2IVM4S5DP42RBW3K6BTODBBI",
    "status": "COMPLETED",
    "memo": "Invoice #1042",
    "description": "Monthly API Retainer",
    "transactionHash": "4f6a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a",
    "userId": "usr_01J6A0B1C2D3E4F5G6H7J8",
    "createdAt": "2026-08-26T10:15:30.000Z",
    "completedAt": "2026-08-26T10:15:35.000Z"
  }
}
```

---

### 4. Update Payment
Update payment memo or metadata.

```bash
curl -X PATCH "https://api.ophirpay.com/api/payments/pay_01J6A1B2C3D4E5F6G7H8J9K0" \
  -H "Authorization: Bearer oph_live_sk_test123456" \
  -H "Content-Type: application/json" \
  -d '{
    "status": "COMPLETED",
    "memo": "Invoice #1042-REV",
    "description": "Updated Retainer Reference"
  }'
```

**Sample Response (200 OK):**
```json
{
  "success": true,
  "data": {
    "id": "pay_01J6A1B2C3D4E5F6G7H8J9K0",
    "status": "COMPLETED",
    "memo": "Invoice #1042-REV",
    "description": "Updated Retainer Reference"
  }
}
```

---

### 5. Delete Payment
Delete an uncompleted payment record.

```bash
curl -X DELETE "https://api.ophirpay.com/api/payments/pay_01J6A1B2C3D4E5F6G7H8J9K0" \
  -H "Authorization: Bearer oph_live_sk_test123456"
```

**Sample Response (200 OK):**
```json
{
  "success": true,
  "message": "Payment deleted successfully"
}
```

---

## Escrows API (On-Chain)

### 6. List Escrows
List all on-chain escrow contracts or fetch one by query parameter.

```bash
curl -X GET "https://api.ophirpay.com/api/escrows" \
  -H "Authorization: Bearer oph_live_sk_test123456"
```

**Sample Response (200 OK):**
```json
{
  "success": true,
  "data": [
    {
      "id": 108,
      "depositor": "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
      "payee": "GAHK7EEG2WWHVKDNT4CEQFZGKF2LGDSW2IVM4S5DP42RBW3K6BTODBBI",
      "amount": 10000000000,
      "assetCode": "XLM",
      "releaseAfter": 1788350400,
      "releaseTo": "GAHK7EEG2WWHVKDNT4CEQFZGKF2LGDSW2IVM4S5DP42RBW3K6BTODBBI",
      "memo": "Milestone 1 Escrow",
      "status": "ACTIVE"
    }
  ]
}
```

---

### 7. Create Escrow
Create an on-chain timelocked escrow contract.

```bash
curl -X POST "https://api.ophirpay.com/api/escrows" \
  -H "Authorization: Bearer oph_live_sk_test123456" \
  -H "Content-Type: application/json" \
  -d '{
    "payee": "GAHK7EEG2WWHVKDNT4CEQFZGKF2LGDSW2IVM4S5DP42RBW3K6BTODBBI",
    "amount": 10000000000,
    "assetCode": "XLM",
    "releaseAfter": 1788350400,
    "memo": "Milestone 1 Escrow"
  }'
```

**Sample Response (201 Created):**
```json
{
  "success": true,
  "data": {
    "id": 109,
    "payee": "GAHK7EEG2WWHVKDNT4CEQFZGKF2LGDSW2IVM4S5DP42RBW3K6BTODBBI",
    "amount": 10000000000,
    "assetCode": "XLM",
    "releaseAfter": 1788350400,
    "status": "INITIALIZED",
    "transactionHash": "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2"
  }
}
```

---

### 8. Get Escrow by ID
Retrieve details of an escrow contract by path ID.

```bash
curl -X GET "https://api.ophirpay.com/api/escrows/108" \
  -H "Authorization: Bearer oph_live_sk_test123456"
```

**Sample Response (200 OK):**
```json
{
  "success": true,
  "data": {
    "id": 108,
    "depositor": "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
    "payee": "GAHK7EEG2WWHVKDNT4CEQFZGKF2LGDSW2IVM4S5DP42RBW3K6BTODBBI",
    "amount": 10000000000,
    "assetCode": "XLM",
    "releaseAfter": 1788350400,
    "status": "ACTIVE"
  }
}
```

---

## Payment Streams API (On-Chain)

### 9. List Streams
List active payment streams or fetch one by query parameter.

```bash
curl -X GET "https://api.ophirpay.com/api/streams" \
  -H "Authorization: Bearer oph_live_sk_test123456"
```

**Sample Response (200 OK):**
```json
{
  "success": true,
  "data": [
    {
      "id": 52,
      "sender": "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
      "payee": "GAHK7EEG2WWHVKDNT4CEQFZGKF2LGDSW2IVM4S5DP42RBW3K6BTODBBI",
      "amount": 50000000000,
      "assetCode": "XLM",
      "startTime": 1787702400,
      "endTime": 1790294400,
      "memo": "Vesting Stream",
      "status": "ACTIVE"
    }
  ]
}
```

---

### 10. Create Stream
Establish a linear on-chain payment stream.

```bash
curl -X POST "https://api.ophirpay.com/api/streams" \
  -H "Authorization: Bearer oph_live_sk_test123456" \
  -H "Content-Type: application/json" \
  -d '{
    "payee": "GAHK7EEG2WWHVKDNT4CEQFZGKF2LGDSW2IVM4S5DP42RBW3K6BTODBBI",
    "amount": 30000000000,
    "assetCode": "XLM",
    "startTime": 1787745600,
    "endTime": 1790337600,
    "memo": "Developer Grant Stream"
  }'
```

**Sample Response (201 Created):**
```json
{
  "success": true,
  "data": {
    "id": 53,
    "payee": "GAHK7EEG2WWHVKDNT4CEQFZGKF2LGDSW2IVM4S5DP42RBW3K6BTODBBI",
    "amount": 30000000000,
    "assetCode": "XLM",
    "startTime": 1787745600,
    "endTime": 1790337600,
    "status": "ACTIVE",
    "transactionHash": "d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5"
  }
}
```

---

### 11. Get Stream by ID
Retrieve details of a payment stream.

```bash
curl -X GET "https://api.ophirpay.com/api/streams/52" \
  -H "Authorization: Bearer oph_live_sk_test123456"
```

**Sample Response (200 OK):**
```json
{
  "success": true,
  "data": {
    "id": 52,
    "sender": "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
    "payee": "GAHK7EEG2WWHVKDNT4CEQFZGKF2LGDSW2IVM4S5DP42RBW3K6BTODBBI",
    "amount": 50000000000,
    "assetCode": "XLM",
    "startTime": 1787702400,
    "endTime": 1790294400,
    "status": "ACTIVE"
  }
}
```

---

## Batch Payments API

### 12. List Batches
List batch payment distributions.

```bash
curl -X GET "https://api.ophirpay.com/api/batches?page=1&limit=20" \
  -H "Authorization: Bearer oph_live_sk_test123456"
```

**Sample Response (200 OK):**
```json
{
  "success": true,
  "data": [
    {
      "id": "batch_01J6B1C2D3E4F5G6H7J8K9",
      "name": "August Payroll",
      "description": "Core team monthly compensation",
      "status": "COMPLETED",
      "totalAmount": 62500000000,
      "paymentCount": 25,
      "createdAt": "2026-08-26T08:00:00.000Z"
    }
  ],
  "meta": {
    "page": 1,
    "limit": 20,
    "total": 1
  }
}
```

---

### 13. Create Batch Payment
Submit a batch payment with multiple child recipients.

```bash
curl -X POST "https://api.ophirpay.com/api/batches" \
  -H "Authorization: Bearer oph_live_sk_test123456" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "September Contractor Payouts",
    "description": "Monthly payouts to contractors",
    "payments": [
      {
        "destAddress": "GAHK7EEG2WWHVKDNT4CEQFZGKF2LGDSW2IVM4S5DP42RBW3K6BTODBBI",
        "amount": 25000000000,
        "assetCode": "XLM",
        "memo": "Engineer A"
      },
      {
        "destAddress": "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
        "amount": 18000000000,
        "assetCode": "XLM",
        "memo": "Designer B"
      }
    ]
  }'
```

**Sample Response (201 Created):**
```json
{
  "success": true,
  "data": {
    "id": "batch_01J6C2D3E4F5G6H7J8K9L0",
    "name": "September Contractor Payouts",
    "status": "CREATED",
    "totalAmount": 43000000000,
    "paymentCount": 2,
    "createdAt": "2026-08-26T13:00:00.000Z"
  }
}
```

---

### 14. Get Batch by ID
Inspect status and items of a specific batch.

```bash
curl -X GET "https://api.ophirpay.com/api/batches/batch_01J6C2D3E4F5G6H7J8K9L0" \
  -H "Authorization: Bearer oph_live_sk_test123456"
```

**Sample Response (200 OK):**
```json
{
  "success": true,
  "data": {
    "id": "batch_01J6C2D3E4F5G6H7J8K9L0",
    "name": "September Contractor Payouts",
    "status": "COMPLETED",
    "totalAmount": 43000000000,
    "payments": [
      {
        "id": "pay_01J6C2D3E4F5G6H7J8K9L1",
        "destAddress": "GAHK7EEG2WWHVKDNT4CEQFZGKF2LGDSW2IVM4S5DP42RBW3K6BTODBBI",
        "amount": 25000000000,
        "status": "COMPLETED"
      },
      {
        "id": "pay_01J6C2D3E4F5G6H7J8K9L2",
        "destAddress": "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
        "amount": 18000000000,
        "status": "COMPLETED"
      }
    ]
  }
}
```

---

## Recurring Payments API

### 15. List Recurring Schedules
List automated recurring payment schedules.

```bash
curl -X GET "https://api.ophirpay.com/api/recurring?page=1&limit=20" \
  -H "Authorization: Bearer oph_live_sk_test123456"
```

**Sample Response (200 OK):**
```json
{
  "success": true,
  "data": [
    {
      "id": "rec_01J6D3E4F5G6H7J8K9L0M1",
      "amount": 990000000,
      "assetCode": "XLM",
      "sourceAccountId": "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
      "destAddress": "GAHK7EEG2WWHVKDNT4CEQFZGKF2LGDSW2IVM4S5DP42RBW3K6BTODBBI",
      "frequency": "MONTHLY",
      "status": "ACTIVE",
      "nextRunAt": "2026-09-01T00:00:00.000Z"
    }
  ],
  "meta": {
    "page": 1,
    "limit": 20,
    "total": 1
  }
}
```

---

### 16. Create Recurring Schedule
Set up a new recurring subscription.

```bash
curl -X POST "https://api.ophirpay.com/api/recurring" \
  -H "Authorization: Bearer oph_live_sk_test123456" \
  -H "Content-Type: application/json" \
  -d '{
    "amount": 990000000,
    "assetCode": "XLM",
    "sourceAccountId": "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
    "destAddress": "GAHK7EEG2WWHVKDNT4CEQFZGKF2LGDSW2IVM4S5DP42RBW3K6BTODBBI",
    "frequency": "MONTHLY",
    "startDate": "2026-09-01T00:00:00.000Z"
  }'
```

**Sample Response (201 Created):**
```json
{
  "success": true,
  "data": {
    "id": "rec_01J6D3E4F5G6H7J8K9L0M1",
    "amount": 990000000,
    "assetCode": "XLM",
    "destAddress": "GAHK7EEG2WWHVKDNT4CEQFZGKF2LGDSW2IVM4S5DP42RBW3K6BTODBBI",
    "frequency": "MONTHLY",
    "status": "ACTIVE",
    "nextRunAt": "2026-09-01T00:00:00.000Z",
    "createdAt": "2026-08-26T14:00:00.000Z"
  }
}
```

---

### 17. Get Recurring Schedule by ID
Fetch details and execution count of a recurring payment.

```bash
curl -X GET "https://api.ophirpay.com/api/recurring/rec_01J6D3E4F5G6H7J8K9L0M1" \
  -H "Authorization: Bearer oph_live_sk_test123456"
```

**Sample Response (200 OK):**
```json
{
  "success": true,
  "data": {
    "id": "rec_01J6D3E4F5G6H7J8K9L0M1",
    "amount": 990000000,
    "assetCode": "XLM",
    "frequency": "MONTHLY",
    "status": "ACTIVE",
    "nextRunAt": "2026-09-01T00:00:00.000Z"
  }
}
```

---

## Payment Requests (Links) API

### 18. List Payment Requests
List generated payment requests.

```bash
curl -X GET "https://api.ophirpay.com/api/requests" \
  -H "Authorization: Bearer oph_live_sk_test123456"
```

**Sample Response (200 OK):**
```json
{
  "success": true,
  "data": [
    {
      "id": "req_01J6E4F5G6H7J8K9L0M1N2",
      "amount": 450000000,
      "assetCode": "XLM",
      "recipientAddress": "GAHK7EEG2WWHVKDNT4CEQFZGKF2LGDSW2IVM4S5DP42RBW3K6BTODBBI",
      "description": "Digital Goods Purchase",
      "status": "OPEN",
      "createdAt": "2026-08-26T14:00:00.000Z"
    }
  ]
}
```

---

### 19. Create Payment Request
Create a checkout payment request.

```bash
curl -X POST "https://api.ophirpay.com/api/requests" \
  -H "Authorization: Bearer oph_live_sk_test123456" \
  -H "Content-Type: application/json" \
  -d '{
    "amount": 450000000,
    "assetCode": "XLM",
    "description": "Digital Goods Purchase",
    "recipientAddress": "GAHK7EEG2WWHVKDNT4CEQFZGKF2LGDSW2IVM4S5DP42RBW3K6BTODBBI"
  }'
```

**Sample Response (201 Created):**
```json
{
  "success": true,
  "data": {
    "id": "req_01J6E4F5G6H7J8K9L0M1N2",
    "amount": 450000000,
    "assetCode": "XLM",
    "recipientAddress": "GAHK7EEG2WWHVKDNT4CEQFZGKF2LGDSW2IVM4S5DP42RBW3K6BTODBBI",
    "description": "Digital Goods Purchase",
    "status": "OPEN",
    "createdAt": "2026-08-26T14:00:00.000Z"
  }
}
```

---

## Webhooks API

### 20. List Webhooks
List registered outgoing webhooks.

```bash
curl -X GET "https://api.ophirpay.com/api/webhooks" \
  -H "Authorization: Bearer oph_live_sk_test123456"
```

**Sample Response (200 OK):**
```json
{
  "success": true,
  "data": [
    {
      "id": "wh_01J6F5G6H7J8K9L0M1N2P3",
      "url": "https://merchant.example.com/api/webhooks/ophirpay",
      "events": ["payment.completed", "escrow.released"],
      "createdAt": "2026-08-26T08:00:00.000Z"
    }
  ]
}
```

---

### 21. Register Webhook
Register a webhook with an HMAC signing secret.

```bash
curl -X POST "https://api.ophirpay.com/api/webhooks" \
  -b cookies.txt \
  -H "x-csrf-token: $CSRF_TOKEN" \
  -H "Authorization: Bearer oph_live_sk_test123456" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://merchant.example.com/api/webhooks/ophirpay",
    "events": ["payment.completed", "payment.failed"],
    "secret": "whsec_991823746a5b6c7d8e9f0a1b2c3d4e5f"
  }'
```

**Sample Response (201 Created):**
```json
{
  "success": true,
  "data": {
    "id": "wh_01J6F5G6H7J8K9L0M1N2P3",
    "url": "https://merchant.example.com/api/webhooks/ophirpay",
    "events": ["payment.completed", "payment.failed"],
    "createdAt": "2026-08-26T15:00:00.000Z"
  }
}
```

---

### 22. Delete Webhook
Delete a registered webhook.

```bash
curl -X DELETE "https://api.ophirpay.com/api/webhooks?id=wh_01J6F5G6H7J8K9L0M1N2P3" \
  -b cookies.txt \
  -H "x-csrf-token: $CSRF_TOKEN" \
  -H "Authorization: Bearer oph_live_sk_test123456"
```

**Sample Response (200 OK):**
```json
{
  "success": true,
  "message": "Webhook deleted successfully"
}
```

---

## API Keys API

### 23. List API Keys
List active API keys.

```bash
curl -X GET "https://api.ophirpay.com/api/keys" \
  -H "Authorization: Bearer oph_live_sk_test123456"
```

**Sample Response (200 OK):**
```json
{
  "success": true,
  "data": [
    {
      "id": "key_01J6G6H7J8K9L0M1N2P3Q4",
      "name": "Production Key",
      "prefix": "oph_live_sk_9f82...",
      "createdAt": "2026-08-20T10:00:00.000Z"
    }
  ]
}
```

---

### 24. Generate API Key
Generate a new API key.

```bash
curl -X POST "https://api.ophirpay.com/api/keys" \
  -H "Authorization: Bearer oph_live_sk_test123456" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Backend Service Key"
  }'
```

**Sample Response (201 Created):**
```json
{
  "success": true,
  "data": {
    "id": "key_01J6G7H8J9K0L1M2N3P4Q5",
    "name": "Backend Service Key",
    "key": "oph_live_sk_9f82a1c0d4e7b6a51234567890abcdef",
    "createdAt": "2026-08-26T15:20:00.000Z"
  }
}
```

---

### 25. Revoke API Key
Revoke an API key by key ID.

```bash
curl -X DELETE "https://api.ophirpay.com/api/keys?keyId=key_01J6G7H8J9K0L1M2N3P4Q5" \
  -H "Authorization: Bearer oph_live_sk_test123456"
```

**Sample Response (200 OK):**
```json
{
  "success": true,
  "message": "API key revoked successfully"
}
```

---

## Multisig Governance API (On-Chain)

### 26. Get Multisig Config
Retrieve multisig threshold and signers.

```bash
curl -X GET "https://api.ophirpay.com/api/multisig" \
  -H "Authorization: Bearer oph_live_sk_test123456"
```

**Sample Response (200 OK):**
```json
{
  "success": true,
  "data": {
    "threshold": 2,
    "signers": [
      "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
      "GAHK7EEG2WWHVKDNT4CEQFZGKF2LGDSW2IVM4S5DP42RBW3K6BTODBBI"
    ]
  }
}
```

---

### 27. Propose Multisig Action
Submit a multisig transaction proposal.

```bash
curl -X POST "https://api.ophirpay.com/api/multisig/propose" \
  -b cookies.txt \
  -H "x-csrf-token: $CSRF_TOKEN" \
  -H "Authorization: Bearer oph_live_sk_test123456" \
  -H "Content-Type: application/json" \
  -d '{
    "destAddress": "GAHK7EEG2WWHVKDNT4CEQFZGKF2LGDSW2IVM4S5DP42RBW3K6BTODBBI",
    "amount": 50000000000,
    "assetCode": "XLM",
    "memo": "Treasury Allocation"
  }'
```

**Sample Response (201 Created):**
```json
{
  "success": true,
  "data": {
    "proposalId": 15,
    "status": "PENDING",
    "threshold": 2,
    "approvals": ["GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5"]
  }
}
```

---

### 28. Approve Multisig Proposal
Approve an on-chain multisig proposal.

```bash
curl -X POST "https://api.ophirpay.com/api/multisig/approve" \
  -b cookies.txt \
  -H "x-csrf-token: $CSRF_TOKEN" \
  -H "Authorization: Bearer oph_live_sk_test123456" \
  -H "Content-Type: application/json" \
  -d '{
    "proposalId": 15
  }'
```

**Sample Response (200 OK):**
```json
{
  "success": true,
  "data": {
    "proposalId": 15,
    "status": "APPROVED",
    "approvalsCount": 2
  }
}
```

---

### 29. Execute Multisig Proposal
Execute a proposal that met threshold.

```bash
curl -X POST "https://api.ophirpay.com/api/multisig/execute" \
  -b cookies.txt \
  -H "x-csrf-token: $CSRF_TOKEN" \
  -H "Authorization: Bearer oph_live_sk_test123456" \
  -H "Content-Type: application/json" \
  -d '{
    "proposalId": 15
  }'
```

**Sample Response (200 OK):**
```json
{
  "success": true,
  "data": {
    "proposalId": 15,
    "status": "EXECUTED",
    "transactionHash": "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2"
  }
}
```

---

### 30. List Multisig Requests
List pending proposal requests.

```bash
curl -X GET "https://api.ophirpay.com/api/multisig/requests" \
  -H "Authorization: Bearer oph_live_sk_test123456"
```

**Sample Response (200 OK):**
```json
{
  "success": true,
  "data": [
    {
      "proposalId": 15,
      "amount": 50000000000,
      "status": "PENDING"
    }
  ]
}
```

---

## DAO Governance API (On-Chain)

### 31. List Governance Proposals
List DAO proposals (requires authentication).

```bash
curl -X GET "https://api.ophirpay.com/api/governance/proposals" \
  -H "Authorization: Bearer oph_live_sk_test123456"
```

**Sample Response (200 OK):**
```json
{
  "success": true,
  "data": [
    {
      "id": 4,
      "title": "Reduce Platform Fee to 0.15%",
      "description": "Adjust base fee parameters",
      "proposer": "GAHK7EEG2WWHVKDNT4CEQFZGKF2LGDSW2IVM4S5DP42RBW3K6BTODBBI",
      "forVotes": 12500000,
      "againstVotes": 420000,
      "status": "ACTIVE",
      "endTime": 1788350400
    }
  ]
}
```

---

### 32. Create Governance Proposal
Submit an on-chain proposal.

```bash
curl -X POST "https://api.ophirpay.com/api/governance/proposals" \
  -b cookies.txt \
  -H "x-csrf-token: $CSRF_TOKEN" \
  -H "Authorization: Bearer oph_live_sk_test123456" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Reduce Platform Fee to 0.15%",
    "description": "Adjust base fee parameters",
    "action": "SET_FEE_BPS"
  }'
```

**Sample Response (201 Created):**
```json
{
  "success": true,
  "data": {
    "id": 5,
    "title": "Reduce Platform Fee to 0.15%",
    "status": "PROPOSED",
    "createdAt": "2026-08-26T15:30:00.000Z"
  }
}
```

---

### 33. Vote on Proposal
Cast a vote on a proposal.

```bash
curl -X POST "https://api.ophirpay.com/api/governance/vote" \
  -b cookies.txt \
  -H "x-csrf-token: $CSRF_TOKEN" \
  -H "Authorization: Bearer oph_live_sk_test123456" \
  -H "Content-Type: application/json" \
  -d '{
    "proposalId": 4,
    "support": true
  }'
```

**Sample Response (200 OK):**
```json
{
  "success": true,
  "data": {
    "proposalId": 4,
    "voter": "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
    "weight": 150000,
    "transactionHash": "e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2"
  }
}
```

---

### 34. Execute Proposal
Execute a passed governance proposal.

```bash
curl -X POST "https://api.ophirpay.com/api/governance/execute" \
  -b cookies.txt \
  -H "x-csrf-token: $CSRF_TOKEN" \
  -H "Authorization: Bearer oph_live_sk_test123456" \
  -H "Content-Type: application/json" \
  -d '{
    "proposalId": 4
  }'
```

**Sample Response (200 OK):**
```json
{
  "success": true,
  "data": {
    "proposalId": 4,
    "status": "EXECUTED",
    "transactionHash": "f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3"
  }
}
```

---

## Analytics & Refunds API

### 35. Get Payment Analytics
Retrieve aggregated settlement metrics.

```bash
curl -X GET "https://api.ophirpay.com/api/analytics?range=30d" \
  -H "Authorization: Bearer oph_live_sk_test123456"
```

**Sample Response (200 OK):**
```json
{
  "success": true,
  "data": {
    "totalVolume": 1428500000000,
    "totalTransactions": 18450,
    "successfulTransactions": 18412,
    "failedTransactions": 38,
    "timeRange": "30d"
  }
}
```

---

### 36. List Refunds
List refund tracking records.

```bash
curl -X GET "https://api.ophirpay.com/api/refunds?limit=20" \
  -H "Authorization: Bearer oph_live_sk_test123456"
```

**Sample Response (200 OK):**
```json
{
  "success": true,
  "data": [
    {
      "id": "ref_01J6H7J8K9L0M1N2P3Q4R5",
      "paymentId": "pay_01J6A1B2C3D4E5F6G7H8J9K0",
      "amount": 1500000000,
      "assetCode": "XLM",
      "status": "COMPLETED",
      "reason": "Customer cancellation within policy"
    }
  ]
}
```

---

### 37. Create Refund
Issue a refund for a payment.

```bash
curl -X POST "https://api.ophirpay.com/api/refunds" \
  -b cookies.txt \
  -H "x-csrf-token: $CSRF_TOKEN" \
  -H "Authorization: Bearer oph_live_sk_test123456" \
  -H "Content-Type: application/json" \
  -d '{
    "paymentId": "pay_01J6A1B2C3D4E5F6G7H8J9K0",
    "amount": 1500000000,
    "reason": "Customer cancellation within policy"
  }'
```

**Sample Response (201 Created):**
```json
{
  "success": true,
  "data": {
    "id": "ref_01J6H7J8K9L0M1N2P3Q4R5",
    "paymentId": "pay_01J6A1B2C3D4E5F6G7H8J9K0",
    "amount": 1500000000,
    "status": "PENDING"
  }
}
```

---

### 38. Update Refund Status
Update notes or status on a refund record.

```bash
curl -X PATCH "https://api.ophirpay.com/api/refunds/ref_01J6H7J8K9L0M1N2P3Q4R5" \
  -b cookies.txt \
  -H "x-csrf-token: $CSRF_TOKEN" \
  -H "Authorization: Bearer oph_live_sk_test123456" \
  -H "Content-Type: application/json" \
  -d '{
    "status": "COMPLETED",
    "notes": "Refund verified on ledger"
  }'
```

**Sample Response (200 OK):**
```json
{
  "success": true,
  "data": {
    "id": "ref_01J6H7J8K9L0M1N2P3Q4R5",
    "status": "COMPLETED"
  }
}
```

---

## Notification Hooks & Audit Logs

### 39. List Notification Hooks
List registered notification hooks.

```bash
curl -X GET "https://api.ophirpay.com/api/hooks" \
  -H "Authorization: Bearer oph_live_sk_test123456"
```

**Sample Response (200 OK):**
```json
{
  "success": true,
  "data": [
    {
      "id": "hook_01J6J8K9L0M1N2P3Q4R5S6",
      "name": "Slack Alert Hook",
      "url": "https://hooks.slack.com/services/T00/B00/X00",
      "events": ["payment.failed"]
    }
  ]
}
```

---

### 40. Register Notification Hook
Register a notification hook.

```bash
curl -X POST "https://api.ophirpay.com/api/hooks" \
  -b cookies.txt \
  -H "x-csrf-token: $CSRF_TOKEN" \
  -H "Authorization: Bearer oph_live_sk_test123456" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Slack Alert Hook",
    "url": "https://hooks.slack.com/services/T00/B00/X00",
    "events": ["payment.failed"]
  }'
```

**Sample Response (201 Created):**
```json
{
  "success": true,
  "data": {
    "id": "hook_01J6J8K9L0M1N2P3Q4R5S6",
    "name": "Slack Alert Hook",
    "status": "ACTIVE"
  }
}
```

---

### 41. Update Notification Hook
Toggle active state or event subscriptions on a hook.

```bash
curl -X PATCH "https://api.ophirpay.com/api/hooks/hook_01J6J8K9L0M1N2P3Q4R5S6" \
  -b cookies.txt \
  -H "x-csrf-token: $CSRF_TOKEN" \
  -H "Authorization: Bearer oph_live_sk_test123456" \
  -H "Content-Type: application/json" \
  -d '{
    "active": true
  }'
```

**Sample Response (200 OK):**
```json
{
  "success": true,
  "data": {
    "id": "hook_01J6J8K9L0M1N2P3Q4R5S6",
    "active": true
  }
}
```

---

### 42. Query Audit Log
Query contract audit trail.

```bash
curl -X GET "https://api.ophirpay.com/api/audit-log?limit=20" \
  -H "Authorization: Bearer oph_live_sk_test123456"
```

**Sample Response (200 OK):**
```json
{
  "success": true,
  "data": [
    {
      "id": 142,
      "action": "CONTRACT_UPGRADE",
      "caller": "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
      "timestamp": "2026-08-26T12:00:00.000Z"
    }
  ]
}
```

---

### 43. Audit Log SSE Stream
Stream real-time audit log entries over SSE.

```bash
curl -N -X GET "https://api.ophirpay.com/api/audit-log/sse" \
  -H "Authorization: Bearer oph_live_sk_test123456" \
  -H "Accept: text/event-stream"
```

**Sample Stream Output (200 OK):**
```text
event: audit
data: {"id":143,"action":"MULTISIG_PROPOSAL_CREATED","caller":"GBBD47IF...","timestamp":"2026-08-26T15:30:00.000Z"}
```

---

## System, Protocol & Diagnostics

### 44. Get Timelock Status
List pending on-chain timelocked administrative actions.

```bash
curl -X GET "https://api.ophirpay.com/api/timelock" \
  -H "Authorization: Bearer oph_live_sk_test123456"
```

**Sample Response (200 OK):**
```json
{
  "success": true,
  "data": []
}
```

---

### 45. Query RBAC Roles
Look up role assignments on-chain.

```bash
curl -X GET "https://api.ophirpay.com/api/rbac?addr=GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5" \
  -H "Authorization: Bearer oph_live_sk_test123456"
```

**Sample Response (200 OK):**
```json
{
  "success": true,
  "data": {
    "address": "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
    "roles": ["ADMIN", "SIGNER"]
  }
}
```

---

### 46. Get Fee Configuration
Retrieve active on-chain fee parameters.

```bash
curl -X GET "https://api.ophirpay.com/api/fee-config" \
  -H "Authorization: Bearer oph_live_sk_test123456"
```

**Sample Response (200 OK):**
```json
{
  "success": true,
  "data": {
    "feeBps": 20,
    "collector": "GCKHE52CM5RRD263Y6GB6OFR5T4P4L2B6V36CQQ4H5H5X5X5X5X5X5X5"
  }
}
```

---

### 47. Get Fee Collector Address
Get the designated fee recipient address.

```bash
curl -X GET "https://api.ophirpay.com/api/fee-config/collector" \
  -H "Authorization: Bearer oph_live_sk_test123456"
```

**Sample Response (200 OK):**
```json
{
  "success": true,
  "data": {
    "collector": "GCKHE52CM5RRD263Y6GB6OFR5T4P4L2B6V36CQQ4H5H5X5X5X5X5X5X5"
  }
}
```

---

### 48. Get Fee Config History
Get historical fee configuration updates.

```bash
curl -X GET "https://api.ophirpay.com/api/fee-config/history" \
  -H "Authorization: Bearer oph_live_sk_test123456"
```

**Sample Response (200 OK):**
```json
{
  "success": true,
  "data": [
    {
      "version": 1,
      "feeBps": 25,
      "updatedAt": "2026-01-01T00:00:00.000Z"
    }
  ]
}
```

---

### 49. Get Policy Versions
Get policy and config version history.

```bash
curl -X GET "https://api.ophirpay.com/api/policy-versions" \
  -H "Authorization: Bearer oph_live_sk_test123456"
```

**Sample Response (200 OK):**
```json
{
  "success": true,
  "data": {
    "feeConfigVersion": 2,
    "multisigConfigVersion": 1
  }
}
```

---

### 50. Get Contract Deployments
Inspect contract address and Soroban deployment version.

```bash
curl -X GET "https://api.ophirpay.com/api/contracts" \
  -H "Authorization: Bearer oph_live_sk_test123456"
```

**Sample Response (200 OK):**
```json
{
  "success": true,
  "data": {
    "version": "1.0.0",
    "network": "testnet",
    "contractId": "CA3D5KRYM6CB7OWQ6TWYRR3Z4EK7O3KNOXY7VAMFUCBGV2G4G7OW3ZLL"
  }
}
```

---

### 51. Get Aggregate Stats
Retrieve on-chain totals and operational counters.

```bash
curl -X GET "https://api.ophirpay.com/api/stats" \
  -H "Authorization: Bearer oph_live_sk_test123456"
```

**Sample Response (200 OK):**
```json
{
  "success": true,
  "data": {
    "paymentCount": 18450,
    "escrowCount": 108,
    "streamCount": 52,
    "batchCount": 120
  }
}
```

---

### 52. Subscribe Payment Events (SSE)
Establish a real-time Server-Sent Events stream for instant payment updates.

```bash
curl -N -X GET "https://api.ophirpay.com/api/events" \
  -H "Authorization: Bearer oph_live_sk_test123456" \
  -H "Accept: text/event-stream"
```

**Sample Stream Output (200 OK):**
```text
event: payment.created
data: {"id":"pay_01J6A7D8E9F0A1B2C3D4E5F6G7","amount":2500000000,"assetCode":"XLM","status":"PENDING"}

event: payment.completed
data: {"id":"pay_01J6A7D8E9F0A1B2C3D4E5F6G7","amount":2500000000,"assetCode":"XLM","status":"COMPLETED","transactionHash":"4f6a1b2c..."}
```

---

### 53. Get Event History
Retrieve historical event logs.

```bash
curl -X GET "https://api.ophirpay.com/api/events/history?limit=20" \
  -H "Authorization: Bearer oph_live_sk_test123456"
```

**Sample Response (200 OK):**
```json
{
  "success": true,
  "data": [
    {
      "id": "evt_01J6K9L0M1N2P3Q4R5S6T7",
      "type": "payment.completed",
      "timestamp": "2026-08-26T10:15:35.000Z"
    }
  ]
}
```

---

### 54. Get CSRF Token
Fetch a CSRF token for web sessions.

```bash
curl -X GET "https://api.ophirpay.com/api/csrf"
```

**Sample Response (200 OK):**
```json
{
  "token": "c9a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1"
}
```

---

### 55. Service Health Check
Liveness and readiness check.

```bash
curl -X GET "https://api.ophirpay.com/api/health" \
  -H "Accept: application/json"
```

**Sample Response (200 OK):**
```json
{
  "status": "healthy",
  "version": "1.0.0",
  "database": "connected",
  "stellarHorizon": "connected",
  "timestamp": "2026-08-26T15:40:00.000Z"
}
```

---

### 56. Prometheus Metrics
Prometheus-formatted telemetry metrics.

```bash
curl -X GET "https://api.ophirpay.com/api/metrics"
```

**Sample Response (200 OK):**
```text
# HELP http_requests_total Total number of HTTP requests processed
# TYPE http_requests_total counter
http_requests_total{method="POST",handler="/api/payments",status="201"} 18420
http_requests_total{method="GET",handler="/api/payments",status="200"} 45210

# HELP http_request_duration_seconds Latency of HTTP requests
# TYPE http_request_duration_seconds histogram
http_request_duration_seconds_bucket{le="0.1"} 58210
http_request_duration_seconds_bucket{le="0.5"} 63400
http_request_duration_seconds_count 63630
```
