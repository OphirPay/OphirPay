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

# 4. AUTH_SECRET guard (issue #705)
#    Mirrors src/lib/env.ts: a deployment must never ship with the
#    .env.example placeholder or a value shorter than 32 bytes. Only checked
#    when AUTH_SECRET is present in the environment, so local runs and the
#    CI deploy-config job (which sets no secrets) still pass.
echo ""
echo "── Validating AUTH_SECRET ──"
if [ -z "${AUTH_SECRET:-}" ]; then
  echo "  ℹ️  AUTH_SECRET not set in this environment — skipping length/placeholder check"
else
  AUTH_SECRET_LEN=$(printf '%s' "$AUTH_SECRET" | wc -c | tr -d ' ')
  if [ "$AUTH_SECRET_LEN" -lt 32 ]; then
    echo "  ❌ AUTH_SECRET is shorter than 32 bytes (got ${AUTH_SECRET_LEN})"
    FAIL=1
  else
    echo "  ✅ AUTH_SECRET length OK (${AUTH_SECRET_LEN} bytes)"
  fi

  AUTH_SECRET_LOWER=$(printf '%s' "$AUTH_SECRET" | tr '[:upper:]' '[:lower:]')
  case "$AUTH_SECRET_LOWER" in
    *replace-with*|*replace_with*|*changeme*|*change-me*|*change_me*|*placeholder*|*your-secret*|*your_secret*|*example-secret*|*example_secret*|*insecure*|*not-a-real*|*dummy-secret*)
      echo "  ❌ AUTH_SECRET looks like a placeholder — generate one with: openssl rand -hex 32"
      FAIL=1
      ;;
    *)
      echo "  ✅ AUTH_SECRET is not a known placeholder"
      ;;
  esac
fi

echo ""
if [ "$FAIL" -eq 1 ]; then
  echo "❌ Deploy script PUBLIC config validation FAILED"
  exit 1
fi

echo "✅ Deploy script PUBLIC config is valid and targets Stellar Mainnet"
