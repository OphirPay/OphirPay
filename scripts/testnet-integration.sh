#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────
# OphirPay — Testnet Contract Integration Test Runner
# ─────────────────────────────────────────────────────────────────
# Runs end-to-end integration tests against live Stellar Testnet RPC.
# Covers payment, batch, refund, governance, and emitter orchestration.
#
# Usage:
#   ./scripts/testnet-integration.sh
#
# Environment variables:
#   SOROBAN_RPC_URL        — RPC endpoint (default: https://soroban-testnet.stellar.org)
#   SKIP_ON_NETWORK_ERROR  — Set to "true" (default) to skip gracefully on network failure
# ─────────────────────────────────────────────────────────────────

set -eo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

echo "============================================"
echo " OphirPay Testnet Integration Tests"
echo "============================================"
echo "RPC: ${SOROBAN_RPC_URL:-https://soroban-testnet.stellar.org}"
echo "Skip on network error: ${SKIP_ON_NETWORK_ERROR:-true}"
echo ""

cd "$PROJECT_DIR"

if ! command -v node >/dev/null 2>&1; then
  echo "❌ node is required to run testnet integration tests."
  exit 1
fi

node "$SCRIPT_DIR/testnet-integration.mjs"
