#!/bin/bash
# ─────────────────────────────────────────────────────────────
# OphirPay — Deploy Script PUBLIC-config Validation
# ─────────────────────────────────────────────────────────────
# Validates that scripts/deploy-workflow.sh:
#   1. Is syntactically valid bash
#   2. PUBLIC network mode targets Stellar Mainnet (not testnet)
#   3. Friendbot is disabled in PUBLIC mode
#   4. The dry-run guard refuses any real submission to PUBLIC
#
# Intended to be run in CI (and locally) before any mainnet deploy.
# Exit code 0 = config is safe; non-zero = a guard failed.
# ─────────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT="scripts/deploy-workflow.sh"
FAIL=0

echo "── Validating ${SCRIPT} ──"

# 1. Syntax check
if bash -n "$SCRIPT"; then
  echo "  ✅ bash syntax OK"
else
  echo "  ❌ bash syntax error"
  FAIL=1
fi

# 2. PUBLIC mode targets Stellar Mainnet
check_grep() {
  local pattern="$1"
  local label="$2"
  if grep -q "$pattern" "$SCRIPT"; then
    echo "  ✅ ${label}"
  else
    echo "  ❌ missing: ${label}"
    FAIL=1
  fi
}

check_grep 'soroban.stellar.org:443' 'PUBLIC RPC URL targets soroban.stellar.org'
check_grep 'horizon.stellar.org' 'PUBLIC Horizon URL targets horizon.stellar.org'
check_grep 'Public Global Stellar Network' 'PUBLIC network passphrase is mainnet'
check_grep 'NETWORK_FLAG="--network public"' 'PUBLIC network flag is --network public'
check_grep 'FRIENDBOT_ENABLED=false' 'friendbot disabled in PUBLIC mode'

# 3. Dry-run guard refuses PUBLIC submissions
check_grep 'DRY_RUN' 'dry-run flag present'
check_grep 'refusing to submit any transaction to PUBLIC network' 'dry-run refuses PUBLIC submissions'

echo ""
if [ "$FAIL" -eq 1 ]; then
  echo "❌ Deploy script PUBLIC config validation FAILED"
  exit 1
fi

echo "✅ Deploy script PUBLIC config is valid and targets Stellar Mainnet"
