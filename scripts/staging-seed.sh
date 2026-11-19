#!/usr/bin/env bash
#
# scripts/staging-seed.sh
#
# Automated staging database seed and test data provisioning script (issue #1423).
# Provisions the staging database with comprehensive multi-user scenarios
# (diverse payments, active escrows, partially vested streams, multisig approval queues),
# protected by strict production URL safety checks.
#
# Usage: ./scripts/staging-seed.sh

set -euo pipefail

echo "═══════════════════════════════════════════"
echo "  OphirPay — Staging Database Seed"
echo "═══════════════════════════════════════════"
echo ""

# ── 1. Check prerequisites ────────────────────────────────
command -v node >/dev/null 2>&1 || { echo "✕ Node.js is required"; exit 1; }
echo "✓ Node.js $(node -v)"

# ── 2. Load environment variables ─────────────────────────
if [ -f .env.local ]; then
  # Export non-comment lines
  set -a
  # shellcheck disable=SC1091
  source .env.local 2>/dev/null || true
  set +a
elif [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  source .env 2>/dev/null || true
  set +a
fi

DATABASE_URL="${DATABASE_URL:-}"
if [ -z "$DATABASE_URL" ]; then
  echo "✕ DATABASE_URL is not set. Please set DATABASE_URL in .env.local or your environment."
  exit 1
fi

# ── 3. Production Safety Check ────────────────────────────
echo "→ Verifying database target safety..."

LOWER_URL=$(echo "$DATABASE_URL" | tr '[:upper:]' '[:lower:]')

# Check for explicit local/staging/dev indicators
IS_SAFE=false
if [[ "$LOWER_URL" =~ (staging|localhost|127\.0\.0\.1|dev\.db|test|sandbox|local) ]]; then
  IS_SAFE=true
fi

# Check for production indicators
IS_PROD=false
if [[ "$LOWER_URL" =~ (rds\.amazonaws\.com|supabase\.co|neon\.tech|cockroachlabs\.cloud|planetscale\.com) ]] && [ "$IS_SAFE" = false ]; then
  IS_PROD=true
fi

if [[ "$LOWER_URL" =~ (prod|production|mainnet|live) ]] && [ "$IS_SAFE" = false ]; then
  IS_PROD=true
fi

if [ "$IS_PROD" = true ]; then
  echo ""
  echo "✕ [SAFETY HALT] Refusing to seed database!"
  echo "  DATABASE_URL appears to target a production environment."
  echo "  Detected URL pattern: $DATABASE_URL"
  echo "  Seeding is strictly limited to local and staging environments."
  exit 1
fi

echo "✓ Database safety check passed: target is safe for staging seed."

# ── 4. Generate Prisma client ──────────────────────────────
echo ""
echo "→ Generating Prisma client..."
npx prisma generate
echo "✓ Prisma client ready."

# ── 5. Push schema / deploy migrations ────────────────────
echo ""
echo "→ Synchronizing database schema..."
npx prisma db push --accept-data-loss
echo "✓ Schema synchronized."

# ── 6. Seed staging data ──────────────────────────────────
echo ""
echo "→ Executing staging seed profile..."
npx tsx prisma/seed.ts --profile=staging
echo ""
echo "═══════════════════════════════════════════"
echo "✓ Staging database seeded successfully!"
echo "═══════════════════════════════════════════"
