# @ophirpay/client

The official TypeScript/JavaScript client for the [OphirPay](https://github.com/OphirPay/OphirPay) payment orchestration platform on Stellar.

Provides full type safety, automatic authentication, error handling, CSV batch processing, and webhook signature verification for Node.js, Next.js, and CI pipelines.

---

## Installation

Install via npm:

```bash
npm install @ophirpay/client
```

Or install directly from the GitHub repository:

```bash
npm install github:OphirPay/OphirPay#main
```

---

## Authentication

Generate an API key in the OphirPay dashboard or via `POST /api/keys`. Pass your API key when instantiating the client or set the `OPHIRPAY_API_KEY` environment variable:

```typescript
import { OphirPayClient } from "@ophirpay/client";

// Reads OPHIRPAY_API_KEY and OPHIRPAY_BASE_URL from environment automatically:
const client = new OphirPayClient();

// Or configure explicitly:
const client = new OphirPayClient({
  apiKey: "sk_live_...",
  baseUrl: "https://api.ophirpay.com", // or http://localhost:3000 for local development
});
```

---

## Core Operations

### 1. Create a Single Payment

```typescript
const payment = await client.payments.create({
  amount: 100.5,
  assetCode: "XLM",
  destAddress: "GA2C5RFPE6GCKMY3US5PAB6UZLKIGSPIUKSLRB6ZN7BMQTUM2QXQWXYZ",
  sourceAccountId: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLABGD",
  memo: "Invoice #1042",
  description: "Consulting fees",
});

console.log(`Payment created: ${payment.id} (Status: ${payment.status})`);
```

### 2. Submit a Batch Payment from a CSV File

```typescript
import fs from "fs";

const csvData = fs.readFileSync("payroll.csv", "utf8");

const batch = await client.batches.createFromCsv(csvData, {
  name: "September 2026 Payroll",
  sourceAccountId: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLABGD",
  description: "Core team disbursements",
});

console.log(`Batch submitted: ${batch.id}`);
console.log(`Progress: ${batch.progress?.sent}/${batch.progress?.total} sent`);
```

Supported CSV format (`payroll.csv`):

```csv
address,amount,assetCode,memo
GA2C5RFPE6GCKMY3US5PAB6UZLKIGSPIUKSLRB6ZN7BMQTUM2QXQWXYZ,500.00,XLM,Sep-Salary
GBCDEFGH234567ABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGH23,250.00,XLM,Sep-Bonus
```

### 3. Check Payment or Batch Status

```typescript
// Payment status:
const payment = await client.payments.get("p_123456");
console.log(`Status: ${payment.status}, TxHash: ${payment.txHash}`);

// Batch status with per-item progress:
const batch = await client.batches.get("b_789101");
console.log(`Batch Status: ${batch.status}`);
console.log(`Total: ${batch.progress?.total}, Failed: ${batch.progress?.failed}`);
```

### 4. Verify Incoming Webhook Signatures

```typescript
const isValid = client.webhooks.verifySignature(
  rawBody,
  headers["x-ophirpay-signature"],
  process.env.OPHIRPAY_WEBHOOK_SECRET!
);

if (!isValid.valid) {
  throw new Error(`Invalid webhook signature: ${isValid.reason}`);
}
```

---

## Deprecation & Versioning Policy

### Semantic Versioning
- **Major (`v1.x.x` → `v2.x.x`)**: Breaking changes to method signatures, removal of deprecated properties, or breaking API contract updates.
- **Minor (`v0.1.x` → `v0.2.x`)**: Backwards-compatible feature additions, new API endpoint methods, optional parameters.
- **Patch (`v0.1.0` → `v0.1.1`)**: Backwards-compatible bug fixes and security patches.

### Deprecation Notice Window
- Any API route or client method scheduled for removal will be marked as `@deprecated` in TypeScript docstrings and in OpenAPI annotations.
- Deprecated endpoints remain supported for a minimum **6-month grace period** before complete retirement.
- Deprecation schedules are announced in the OphirPay release notes and via HTTP `Sunset` and `Deprecation` response headers.
