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

# 4. AUTH_SECRET security validation
echo ""
echo "── Validating AUTH_SECRET configuration ──"

check_auth_secret() {
  local secret="${AUTH_SECRET:-}"

  # Fallback to .env.production or .env if present and variable not explicitly set in process environment
  if [ -z "$secret" ] && [ -f ".env.production" ]; then
    secret=$(grep -E '^[[:space:]]*AUTH_SECRET=' .env.production | head -n1 | cut -d '=' -f2- | tr -d '"' | tr -d "'" | tr -d '\r' || true)
  fi
  if [ -z "$secret" ] && [ -f ".env" ]; then
    secret=$(grep -E '^[[:space:]]*AUTH_SECRET=' .env | head -n1 | cut -d '=' -f2- | tr -d '"' | tr -d "'" | tr -d '\r' || true)
  fi

  if [ -n "$secret" ]; then
    if echo "$secret" | grep -qiE 'replace-with|placeholder|changeme|openssl rand'; then
      echo "  ❌ AUTH_SECRET is set to an insecure placeholder value: '${secret}'"
      echo "     Generate a cryptographically random secret with: openssl rand -hex 32"
      FAIL=1
    elif [ "${#secret}" -lt 32 ]; then
      echo "  ❌ AUTH_SECRET is too short (${#secret} chars, minimum 32 required)"
      echo "     Generate a cryptographically random secret with: openssl rand -hex 32"
      FAIL=1
    else
      echo "  ✅ AUTH_SECRET is valid and has sufficient length (${#secret} chars)"
    fi
  elif [ "${VALIDATE_AUTH_SECRET:-false}" = "true" ] || [ "${NODE_ENV:-}" = "production" ] || [ "${NETWORK_MODE:-}" = "PUBLIC" ]; then
    echo "  ❌ AUTH_SECRET is required in production/PUBLIC deployments but is unset"
    echo "     Generate a cryptographically random secret with: openssl rand -hex 32"
    FAIL=1
  else
    echo "  ℹ️ AUTH_SECRET unset in local env (ensure it is configured for production deployments)"
  fi
}

check_auth_secret

echo ""
if [ "$FAIL" -eq 1 ]; then
  echo "❌ Deploy script and environment validation FAILED"
  exit 1
fi

echo "✅ Deploy script PUBLIC config and security settings are valid"
