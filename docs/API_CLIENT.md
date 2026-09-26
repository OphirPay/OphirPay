# OphirPay Client & Automation SDK

This document specifies the first-party TypeScript/JavaScript client (`@ophirpay/client`), the command-line interface (`ophirpay`), and GitHub Actions for continuous integration and automated payment pipelines.

---

## 1. Overview & Architecture

OphirPay exposes an OpenAPI 3.1.0 specification at [`docs/openapi.yaml`](./openapi.yaml) covering 59 REST routes, scoped API keys, webhook deliveries, multisig proposals, and batch payments.

The `@ophirpay/client` package provides an official, strongly typed SDK generated and modeled from this OpenAPI specification. It runs in Node.js (18+), modern browsers, edge runtimes, and CI environments.

```
┌────────────────────────────────────────────────────────┐
│                   docs/openapi.yaml                    │
└──────────────────────────┬─────────────────────────────┘
                           │
             ┌─────────────┴─────────────┐
             ▼                           ▼
   ┌───────────────────┐       ┌───────────────────┐
   │ @ophirpay/client  │       │   ophirpay CLI    │
   │  TypeScript SDK   │       │  (bin/ophirpay)   │
   └─────────┬─────────┘       └─────────┬─────────┘
             │                           │
             └─────────────┬─────────────┘
                           ▼
             ┌───────────────────────────┐
             │  GitHub Actions / CI/CD   │
             │   (.github/actions/)      │
             └───────────────────────────┘
```

---

## 2. Installation

Install the package from npm or directly from the OphirPay GitHub repository:

```bash
# Via npm
npm install @ophirpay/client

# Direct from GitHub
npm install github:OphirPay/OphirPay#main
```

The CLI is available directly without installation using `npx`:

```bash
npx ophirpay --help
```

---

## 3. Client Initialization

```typescript
import { OphirPayClient } from "@ophirpay/client";

// Configured via environment variables (OPHIRPAY_API_KEY, OPHIRPAY_BASE_URL)
const client = new OphirPayClient();

// Or explicit options
const client = new OphirPayClient({
  apiKey: "sk_live_...",
  baseUrl: "https://api.ophirpay.com",
  timeoutMs: 30000,
});
```

---

## 4. API Reference

### Payments
- `client.payments.create(params: CreatePaymentRequest): Promise<Payment>`:
  Submit a single Stellar payment.
- `client.payments.get(id: string): Promise<Payment>`:
  Retrieve payment status, Stellar transaction hash, and timestamp.
- `client.payments.list(params?: ListPaymentsParams): Promise<PaginatedPayments>`:
  Keyset or offset paginated payment records.

### Batches
- `client.batches.create(params: CreateBatchRequest, idempotencyKey?: string): Promise<BatchDetails>`:
  Submit up to 100 payments atomically.
- `client.batches.get(id: string): Promise<BatchDetails>`:
  Retrieve batch status and per-item progress counters (`sent`, `pending`, `failed`).
- `client.batches.createFromCsv(csvContent: string, meta: BatchMetadata): Promise<BatchDetails>`:
  Parse CSV string and submit batch payout in one step.
- `client.batches.parseCsv(csvContent: string): BatchRecipient[]`:
  Parse and validate CSV string before submission.

### Webhooks
- `client.webhooks.verifySignature(rawBody: string | object, signature: string, secret: string, options?: { maxClockDriftSeconds?: number }): WebhookVerificationResult`:
  Constant-time HMAC-SHA256 signature verification matching OphirPay's canonical format.

### System
- `client.system.health(): Promise<HealthResponse>`:
  Check API server health and failover metrics.

---

## 5. Command-Line Interface (CLI)

The CLI binary (`bin/ophirpay.mjs`) provides standard terminal tools for operators and scripts:

```bash
# Create an individual payment
ophirpay payment create \
  --amount 100 \
  --dest GA2C5RFPE6GCKMY3US5PAB6UZLKIGSPIUKSLRB6ZN7BMQTUM2QXQWXYZ \
  --source GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLABGD \
  --memo "Invoice-101"

# Submit a batch from a CSV file
ophirpay batch create \
  --csv ./payroll.csv \
  --name "Sep-2026-Payroll" \
  --source GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLABGD

# Check status of payment or batch
ophirpay status p_123456
ophirpay status b_789101

# Verify incoming webhook signature
ophirpay webhook verify \
  --payload ./webhook.json \
  --signature 647945219590e65b3f903bdd28baeabdc5ce3915cc9a8a497bfcba9ed2802b64 \
  --secret whsec_mysecret

# Health check
ophirpay health
```

---

## 6. GitHub Actions for CI Pipelines

OphirPay provides official GitHub Actions in `.github/actions/`:

### `.github/actions/batch-payment`
Automates payroll, grants, or automated disbursements from a CSV file.

```yaml
- name: OphirPay Batch Disbursement
  uses: OphirPay/OphirPay/.github/actions/batch-payment@main
  with:
    api-key: ${{ secrets.OPHIRPAY_API_KEY }}
    csv-file: "./payouts.csv"
    batch-name: "Payout-${{ github.sha }}"
    source-account: ${{ secrets.STELLAR_SOURCE_ACCOUNT }}
    fail-on-rejected: "true"
```

**Job Failure Semantics:**
When `fail-on-rejected` is `true`, if any recipient payment within the batch fails validation or is rejected by the network, the action prints a GitHub workflow error annotation (`::error::`) and exits with code 1, immediately failing the CI job to prevent unmonitored payout losses.

### `.github/actions/create-payment`
Triggers single on-demand payments from CI workflows.

---

## 7. Versioning & Deprecation Policy

The OphirPay Client follows strict [Semantic Versioning (SemVer 2.0.0)](https://semver.org/):

| Version Change | Trigger | Guarantee |
|---|---|---|
| **Major (`X.0.0`)** | Breaking changes to method signatures, removals of deprecated endpoints, or incompatible contract migrations. | Announced 6 months in advance. Migration guides provided. |
| **Minor (`0.X.0`)** | New API endpoints, non-breaking parameter additions, new CLI subcommands. | Full backward compatibility guaranteed. |
| **Patch (`0.0.X`)** | Bug fixes, security patches, documentation improvements. | 100% backward compatible drop-in replacement. |

### Deprecation Timeline & Notice
1. **Notice Phase:** An endpoint or method scheduled for deprecation is marked `@deprecated` in TypeScript types and annotated in `docs/openapi.yaml`.
2. **Runtime Warning:** Responses from deprecated API endpoints include standard HTTP headers:
   - `Deprecation: true`
   - `Sunset: <Date>`
3. **Grace Period:** Deprecated endpoints are maintained for a minimum of **6 months (180 days)** from the initial deprecation announcement before removal in a subsequent major release.
