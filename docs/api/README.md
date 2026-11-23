# OphirPay REST API Reference & Tooling

Welcome to the OphirPay REST API documentation. This directory provides developer documentation, integration specifications, security policies, and pre-built API collections for rapid testing.

---

## Table of Contents

- [API Overview](#api-overview)
- [API Tooling & Collection Imports](#api-tooling--collection-imports)
  - [Postman Import](#postman-import)
  - [Insomnia Import](#insomnia-import)
  - [Environment Variables Setup](#environment-variables-setup)
- [Authentication Methods](#authentication-methods)
- [Key Documentation Guides](#key-documentation-guides)
- [OpenAPI Specification](#openapi-specification)

---

## API Overview

OphirPay provides production-grade payment orchestration over the Stellar network and Soroban smart contracts. The REST API handles:

- **Payments**: Single payments, status tracking, idempotency, and refunds.
- **Batch Disbursements**: Atomic multi-recipient payments amortizing base fees.
- **Escrows & Streaming**: Time-locked vesting, milestone escrows, and streaming payments.
- **Wallet Authentication**: SIWE-style cryptographic challenge verification.
- **API Key Management**: Scoped key generation, rotation, and lifecycle controls.

---

## API Tooling & Collection Imports

OphirPay ships a complete, pre-configured collection in [`examples/postman_collection.json`](../../examples/postman_collection.json) adhering to the Postman v2.1.0 schema, fully compatible with both **Postman** and **Insomnia**.

### Postman Import

1. Launch Postman.
2. Click **Import** (top left).
3. Drag and drop `examples/postman_collection.json` or click **files** and select it.
4. The **OphirPay REST API** collection will appear in your left sidebar with all pre-configured endpoints and request payloads.

### Insomnia Import

1. Launch Insomnia.
2. Click on your active Project or Workspace, then click **Import**.
3. Select **Import from File** and choose `examples/postman_collection.json`.
4. Confirm import. All endpoints, folders, and variables will be imported.

### Environment Variables Setup

The collection is pre-configured with collection-level variables. Customize them for your target environment:

| Variable       | Default Value           | Description                                                                                                |
| -------------- | ----------------------- | ---------------------------------------------------------------------------------------------------------- |
| `baseUrl`      | `http://localhost:3000` | The target OphirPay server host. For production, set to your API domain (e.g. `https://api.ophirpay.com`). |
| `apiKey`       | `ophir_test_0123...`    | Your secret API key. Passed via `Authorization: Bearer {{apiKey}}`.                                        |
| `metricsToken` | `metrics_secret_...`    | Bearer token for authorized Prometheus scraping at `GET /api/metrics`.                                     |

---

## Authentication Methods

OphirPay supports two primary forms of API authentication:

1. **API Keys**:
   - Passed via standard authorization header:
     ```http
     Authorization: Bearer ophir_live_...
     ```
   - Or via custom header:
     ```http
     X-API-Key: ophir_live_...
     ```
   - Generated and rotated via `/api/keys`.

2. **Wallet Authentication**:
   - Cryptographic challenge-response workflow:
     1. Call `GET /api/auth/challenge?publicKey=G...` to obtain a random nonce.
     2. Sign the challenge with your Stellar wallet (Freighter, Albedo, or hardware wallet).
     3. Submit signature to `POST /api/auth/session` to establish an authenticated HTTP-only session cookie.

---

## Key Documentation Guides

- [**Batch Payments API**](batches.md): Endpoint specification, cURL & TypeScript examples, Zod schemas, and idempotency guarantees for `POST /api/batches`.
- [**CORS Policy & Allowed Headers**](cors.md): Cross-Origin Resource Sharing specifications, allowed origins, preflight headers, and frontend dApp integration instructions.
- [**Rate Limiting & Tier Quotas**](rate-limiting.md): Rate limiting headers (`X-RateLimit-*`, `Retry-After`), tier quotas across proxy, auth, lookup, and API keys, and exponential backoff implementation with full jitter.
- [**Contract SSE Reference**](../CONTRACT_SSE_REFERENCE.md): Real-time Server-Sent Events (SSE) and native Soroban contract event emission.
- [**Metrics & Monitoring Guide**](../metrics-endpoints.md): Detailed Prometheus metrics export and bearer authentication.

---

## OpenAPI Specification

- **YAML Specification**: Located at [`docs/openapi.yaml`](../openapi.yaml).
- **JSON Endpoint**: Served directly by the application at `GET /api/openapi.json`.
- **Interactive UI**: Interactive API documentation powered by Scalar is served at `/docs/api`.
