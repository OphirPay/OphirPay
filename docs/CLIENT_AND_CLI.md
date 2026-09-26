# OphirPay Typed Client, CLI & CI Automation

This document provides complete instructions for using the typed OphirPay API client, the standalone command-line interface (`ophirpay`), and the automated GitHub Action for CI payment pipelines.

---

## 1. Typed API Client (`@ophirpay/client`)

The typed client provides end-to-end type safety for institutional payments and batch processing derived directly from the OpenAPI 3.1.0 specification.

### Installation

```bash
npm install github:OphirPay/OphirPay#integration/staging
```

### Usage

```typescript
import { OphirPayClient } from "ophirpay/client";

const client = new OphirPayClient({
  baseUrl: process.env.OPHIRPAY_BASE_URL || "https://api.ophirpay.com",
  apiKey: process.env.OPHIRPAY_API_KEY!,
});

// Single payment
const payment = await client.createPayment({
  amount: 100,
  assetCode: "XLM",
  destAddress: "GBQMIN7KLT4R473IGGFBGUYM2UNPGKZRTX2LZ4M2KQIY2ASYJL6ACBMZ",
  sourceAccountId: "GBQMIN7KLT4R473IGGFBGUYM2UNPGKZRTX2LZ4M2KQIY2ASYJL6ACBMZ",
  memo: "Invoice #1042",
});
console.log(`Payment created: ${payment.id} [${payment.status}]`);

// Batch payment from CSV text
const csvData = `address,amount,assetCode,memo
GBQMIN7KLT4R473IGGFBGUYM2UNPGKZRTX2LZ4M2KQIY2ASYJL6ACBMZ,50,XLM,payroll-1
GBQMIN7KLT4R473IGGFBGUYM2UNPGKZRTX2LZ4M2KQIY2ASYJL6ACBMZ,200,USDC,payroll-2`;

const batch = await client.createBatchFromCsv(csvData, {
  name: "September Payroll Run",
  sourceAccountId: "GBQMIN7KLT4R473IGGFBGUYM2UNPGKZRTX2LZ4M2KQIY2ASYJL6ACBMZ",
});
console.log(`Batch submitted: ${batch.id} (${batch.totalRecipients} recipients)`);
```

---

## 2. Command-Line Interface (`bin/ophirpay.mjs`)

The CLI is a lightweight, zero-dependency utility for operators and CI pipelines.

### Commands

* **Single Payment:**
  ```bash
  node bin/ophirpay.mjs payment create \
    --dest GBQMIN7KLT4R473IGGFBGUYM2UNPGKZRTX2LZ4M2KQIY2ASYJL6ACBMZ \
    --amount 25 \
    --source GBQMIN7KLT4R473IGGFBGUYM2UNPGKZRTX2LZ4M2KQIY2ASYJL6ACBMZ \
    --asset XLM
  ```

* **Batch Submission (with instant failure on rejected payments):**
  ```bash
  node bin/ophirpay.mjs batch submit \
    --file ./payroll.csv \
    --name "Nightly CI Run" \
    --source GBQMIN7KLT4R473IGGFBGUYM2UNPGKZRTX2LZ4M2KQIY2ASYJL6ACBMZ \
    --fail-on-rejected
  ```

* **Status Lookup:**
  ```bash
  node bin/ophirpay.mjs status pay_abc123
  ```

* **Webhook Signature Verification:**
  ```bash
  node bin/ophirpay.mjs webhook verify \
    --secret "your-webhook-secret" \
    --signature "83ab64c58dadec406835..." \
    --file ./webhook-payload.json
  ```

---

## 3. GitHub Action (`.github/actions/ophirpay-payment`)

Automate payment disbursements directly from GitHub Actions workflows. If any payment is rejected or fails, the job immediately terminates with an error annotation.

```yaml
name: Scheduled Vendor Disbursement

on:
  workflow_dispatch:

jobs:
  payout:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Execute OphirPay Payout
        uses: ./.github/actions/ophirpay-payment
        with:
          api-key: ${{ secrets.OPHIRPAY_API_KEY }}
          base-url: "https://api.ophirpay.com"
          batch-csv: "disbursements.csv"
          source-account: ${{ secrets.STELLAR_SOURCE_ACCOUNT }}
          batch-name: "Vendor Payout"
          fail-on-rejected: "true"
```

---

## 4. API Deprecation & Versioning Policy

- **SemVer Adherence:** The client adheres strictly to Semantic Versioning (`MAJOR.MINOR.PATCH`).
- **Notice Period:** Any breaking change or deprecation of an API route requires a minimum of **6 months' advance notice**.
- **Deprecation Headers:** Deprecated endpoints return HTTP `Deprecation: true` and `Sunset: <date>` headers per RFC 8594.
- **Backwards Compatibility:** Client SDKs remain compatible with the previous major version for at least one release cycle.
