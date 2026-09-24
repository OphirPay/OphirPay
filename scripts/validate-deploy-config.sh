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

# 4. Helm chart configuration validation
echo ""
echo "── Validating Helm Chart Configuration ──"
HELM_VALUES="helm/ophirpay/values.yaml"
if grep -q 'NEXT_PUBLIC_HORIZON_URL:' "$HELM_VALUES"; then
  echo "  ❌ deprecated NEXT_PUBLIC_HORIZON_URL found in $HELM_VALUES"
  FAIL=1
else
  echo "  ✅ no deprecated NEXT_PUBLIC_HORIZON_URL in $HELM_VALUES"
fi

if grep -q 'NEXT_PUBLIC_SOROBAN_RPC_URL:' "$HELM_VALUES"; then
  echo "  ❌ deprecated NEXT_PUBLIC_SOROBAN_RPC_URL found in $HELM_VALUES"
  FAIL=1
else
  echo "  ✅ no deprecated NEXT_PUBLIC_SOROBAN_RPC_URL in $HELM_VALUES"
fi

if grep -q 'NEXT_PUBLIC_STELLAR_HORIZON_URL:' "$HELM_VALUES"; then
  echo "  ✅ aligned NEXT_PUBLIC_STELLAR_HORIZON_URL present in $HELM_VALUES"
else
  echo "  ❌ missing NEXT_PUBLIC_STELLAR_HORIZON_URL in $HELM_VALUES"
  FAIL=1
fi

if grep -q 'NEXT_PUBLIC_STELLAR_RPC_URL:' "$HELM_VALUES"; then
  echo "  ✅ aligned NEXT_PUBLIC_STELLAR_RPC_URL present in $HELM_VALUES"
else
  echo "  ❌ missing NEXT_PUBLIC_STELLAR_RPC_URL in $HELM_VALUES"
  FAIL=1
fi

node -e '
const fs = require("fs");
const yaml = require("js-yaml");
const envContent = fs.readFileSync(".env.example", "utf8");
const allowed = new Set();
for (const line of envContent.split("\n")) {
  const m = line.match(/^(?:#\s*)?([A-Z][A-Z0-9_]+)=/);
  if (m) allowed.add(m[1]);
}
const values = yaml.load(fs.readFileSync("helm/ophirpay/values.yaml", "utf8"));
const configKeys = Object.keys(values.config || {});
const secretKeys = Object.keys(values.secrets || {});
const unknown = [...configKeys, ...secretKeys].filter(k => !allowed.has(k));
if (unknown.length > 0) {
  console.error("  ❌ Unknown Helm config/secret keys not found in .env.example:", unknown);
  process.exit(1);
}
console.log("  ✅ All Helm values.yaml config/secret keys match .env.example");
' || FAIL=1

echo ""
if [ "$FAIL" -eq 1 ]; then
  echo "❌ Deploy script and Helm config validation FAILED"
  exit 1
fi

echo "✅ Deploy script and Helm config are valid"
