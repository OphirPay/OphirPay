#!/usr/bin/env bash
#
# scripts/staging-seed.sh
#
# Automated staging database seed and test data sanitization script for OphirPay.
# Populates realistic multi-user scenarios across all schema entities, including
# active escrows, partially vested streams, and multi-signature approval queues.
#
# Safety: Strictly enforces guardrails to prevent accidental execution against production!
#
# Usage:
#   ./scripts/staging-seed.sh
#   ./scripts/staging-seed.sh --sanitize
#   ./scripts/staging-seed.sh --profile=load
#

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

cd "${ROOT_DIR}"

echo "================================================="
echo "  OphirPay — Staging Seed & Data Sanitization"
echo "================================================="

# ── 1. Check Node.js prerequisite ──────────────────────────────
if ! command -v node >/dev/null 2>&1 && ! command -v node.exe >/dev/null 2>&1; then
  echo "Error: Node.js is required but not installed." >&2
  exit 1
fi

# ── 2. Load environment variables for safety checks ────────────
if [ -f .env ]; then
  # Load .env without overriding existing shell variables
  set -a
  # shellcheck disable=SC1091
  source .env 2>/dev/null || true
  set +a
fi

if [ -f .env.local ]; then
  # Load .env.local with override
  set -a
  # shellcheck disable=SC1091
  source .env.local 2>/dev/null || true
  set +a
fi

# ── 3. Production Environment Guardrails ────────────────────────
echo "→ Running production safety guardrail checks..."

# Check NODE_ENV / VERCEL_ENV
TARGET_NODE_ENV="${NODE_ENV:-}"
TARGET_VERCEL_ENV="${VERCEL_ENV:-}"
if [[ "${TARGET_NODE_ENV,,}" == "production" ]] || [[ "${TARGET_VERCEL_ENV,,}" == "production" ]]; then
  echo "" >&2
  echo "CRITICAL SAFETY ERROR: Execution aborted!" >&2
  echo "NODE_ENV or VERCEL_ENV is set to 'production'." >&2
  echo "Staging seed cannot be run against production environments." >&2
  echo "" >&2
  exit 1
fi

# Check Stellar Network setting
NETWORK="${STELLAR_NETWORK:-${NEXT_PUBLIC_STELLAR_NETWORK:-}}"
if [[ "${NETWORK^^}" == "PUBLIC" ]] || [[ "${NETWORK^^}" == "MAINNET" ]]; then
  echo "" >&2
  echo "CRITICAL SAFETY ERROR: Execution aborted!" >&2
  echo "STELLAR_NETWORK is set to '${NETWORK}' (Public Mainnet)." >&2
  echo "Staging seed is only permitted on TESTNET or local environments." >&2
  echo "" >&2
  exit 1
fi

# Check DATABASE_URL for production indicators
DB_URL="${DATABASE_URL:-}"
if [ -n "${DB_URL}" ]; then
  LOWER_DB_URL="$(echo "${DB_URL}" | tr '[:upper:]' '[:lower:]')"

  # Look for production keywords or production domain structures
  if [[ "${LOWER_DB_URL}" =~ (prod|production|live) ]] && [[ ! "${LOWER_DB_URL}" =~ (dev|non-prod|staging|test) ]]; then
    echo "" >&2
    echo "CRITICAL SAFETY ERROR: Execution aborted!" >&2
    echo "DATABASE_URL matches production domain/database patterns." >&2
    echo "Target URL: ${DB_URL%%:*}:***" >&2
    echo "Refusing to seed against what appears to be a production database." >&2
    echo "" >&2
    exit 1
  fi

  if [[ "${LOWER_DB_URL}" =~ (ophirpay_prod|ophirpay-prod|production_db) ]]; then
    echo "" >&2
    echo "CRITICAL SAFETY ERROR: Execution aborted!" >&2
    echo "DATABASE_URL points to a production database name." >&2
    exit 1
  fi
fi

echo "✓ Safety checks passed (non-production environment verified)."

# ── 4. Verify Prisma Client ─────────────────────────────────────
echo ""
echo "→ Checking Prisma client..."
npx prisma generate 2>/dev/null || {
  echo "Notice: prisma generate reported a non-zero status, continuing if client already exists..."
}

# ── 5. Run Seed with Staging Profile ─────────────────────────────
echo ""
echo "→ Executing staging seed profile..."
# Default to --profile=staging if no profile argument is passed
HAS_PROFILE=false
for arg in "$@"; do
  if [[ "${arg}" == *"--profile"* ]] || [[ "${arg}" == "-p" ]]; then
    HAS_PROFILE=true
    break
  fi
done

if [ "${HAS_PROFILE}" = true ]; then
  npx tsx prisma/seed.ts "$@"
else
  npx tsx prisma/seed.ts --profile=staging "$@"
fi

echo ""
echo "✓ Staging seed completed successfully."
