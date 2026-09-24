# OphirPay CI/CD Pipeline Integration

This example demonstrates how institutional teams and DAO contributors integrate OphirPay into GitHub Actions pipelines, scheduled cron jobs, and automation workflows.

---

## 🚀 Quick Start: Batch Payout Action

Use `.github/actions/batch-payment` to disburse funds to up to 100 Stellar addresses from a CSV file directly in your CI pipeline.

### Step 1: Add Secrets to GitHub Repository
In your GitHub repository settings (**Settings → Secrets and variables → Actions**), add:
- `OPHIRPAY_API_KEY`: API Key generated from OphirPay dashboard (`POST /api/keys`).
- `STELLAR_SOURCE_ACCOUNT`: Funding Stellar account public key (`G...`).

### Step 2: Prepare Recipients CSV
Create a CSV file (e.g. `payouts.csv`) with the required columns:

```csv
address,amount,assetCode,memo
GA2C5RFPE6GCKMY3US5PAB6UZLKIGSPIUKSLRB6ZN7BMQTUM2QXQWXYZ,150.00,XLM,Salary-Sep
GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLABGD,220.50,XLM,Bonus-Q3
```

### Step 3: Add the Workflow
Add `.github/workflows/payroll.yml`:

```yaml
name: Monthly Payroll Disbursal

on:
  schedule:
    - cron: "0 0 1 * *" # 1st of every month
  workflow_dispatch:

jobs:
  payout:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Disburse Batch via OphirPay
        uses: OphirPay/OphirPay/.github/actions/batch-payment@main
        with:
          api-key: ${{ secrets.OPHIRPAY_API_KEY }}
          csv-file: "./payouts.csv"
          batch-name: "Payroll-${{ github.run_id }}"
          source-account: ${{ secrets.STELLAR_SOURCE_ACCOUNT }}
          fail-on-rejected: "true"
```

### 🛡️ Safety & Failure Handling
When `fail-on-rejected` is set to `"true"` (the default), the Action will:
1. Validate every Stellar address and positive amount before submitting.
2. Monitor batch execution for rejected or failed transactions.
3. If any recipient is rejected or fails, the GitHub Action job immediately terminates with an error code and logs a GitHub workflow error annotation (`::error::`), preventing silent financial failures.

---

## 💻 CLI Usage in Custom Automation

You can also run the OphirPay CLI in bash scripts or Docker containers:

```bash
# Install or run directly with npx
npx ophirpay batch create \
  --api-key "$OPHIRPAY_API_KEY" \
  --csv "./payouts.csv" \
  --name "Bounty-Disbursements" \
  --source "$STELLAR_SOURCE_ACCOUNT"

# Verify incoming webhook signatures in serverless functions:
npx ophirpay webhook verify \
  --payload payload.json \
  --signature "$X_OPHIRPAY_SIGNATURE" \
  --secret "$OPHIRPAY_WEBHOOK_SECRET"
```
