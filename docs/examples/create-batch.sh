#!/usr/bin/env bash
# SPDX-License-Identifier: MIT
#
# OphirPay Batch Payment Submission Example using cURL
#
# Submits an atomic batch payment request to the OphirPay API (POST /api/batches).
#
# Prerequisites:
#   - An OphirPay API key with 'batches:create' scope
#   - curl installed (and optionally jq for formatted output)
#
# Environment variables:
#   OPHIRPAY_API_URL - Base URL of the OphirPay instance (default: http://localhost:3000)
#   OPHIRPAY_API_KEY - API Key with 'batches:create' scope (default: test key)
#
# Usage:
#   chmod +x create-batch.sh
#   ./create-batch.sh

set -euo pipefail

API_URL="${OPHIRPAY_API_URL:-http://localhost:3000}"
API_KEY="${OPHIRPAY_API_KEY:-ophir_live_demo_test_key_0123456789}"
IDEMPOTENCY_KEY="idem_batch_$(date +%s)_$RANDOM"

echo "Submitting batch payment to ${API_URL}/api/batches..."
echo "Using Idempotency-Key: ${IDEMPOTENCY_KEY}"

curl -sS -X POST "${API_URL}/api/batches" \
  -H "Authorization: Bearer ${API_KEY}" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: ${IDEMPOTENCY_KEY}" \
  -d '{
    "name": "Contributor Rewards - March 2026",
    "description": "Monthly developer compensation and grant disbursement",
    "sourceAccountId": "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
    "recipients": [
      {
        "address": "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
        "amount": 250.50,
        "assetCode": "XLM",
        "memo": "Dev reward #101",
        "memoType": "text"
      },
      {
        "address": "GCGNWKCJ3KHRLPM3TMVCUIYKAQUTVCC52UKNO5ZXOSIWBZMLGLBKIA21",
        "amount": 175.00,
        "assetCode": "USDC",
        "memo": "Grant payout #42",
        "memoType": "text"
      }
    ]
  }' | (command -v jq >/dev/null 2>&1 && jq . || cat)
