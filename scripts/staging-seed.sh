#!/usr/bin/env bash
set -euo pipefail

# OphirPay Staging Database Seed & Test Data Sanitization Runner (Issue #1423)
# Strictly refuses execution against production database URLs or NODE_ENV=production.

PROFILE="${SEED_PROFILE:-staging}"
DRY_RUN=false

for arg in "$@"; do
  case "$arg" in
    --profile=*)
      PROFILE="${arg#*=}"
      ;;
    --dry-run)
      DRY_RUN=true
      ;;
    --help|-h)
      echo "Usage: ./scripts/staging-seed.sh [--profile=staging|minimal|load] [--dry-run]"
      exit 0
      ;;
    *)
      echo "Unknown argument: $arg" >&2
      echo "Usage: ./scripts/staging-seed.sh [--profile=staging|minimal|load] [--dry-run]" >&2
      exit 1
      ;;
  esac
done

case "$PROFILE" in
  staging|minimal|load)
    ;;
  *)
    echo "ERROR: Invalid seed profile '$PROFILE'. Allowed values: staging, minimal, load." >&2
    exit 1
    ;;
esac

if [[ "${NODE_ENV:-}" == "production" ]]; then
  echo "CRITICAL: Refusing to run staging-seed.sh when NODE_ENV=production." >&2
  exit 1
fi

DB_URL="${DATABASE_URL:-}"
if [[ -z "$DB_URL" ]]; then
  echo "ERROR: DATABASE_URL is not set. Point DATABASE_URL to a local or staging database." >&2
  exit 1
fi

LOWER_DB_URL="$(printf '%s' "$DB_URL" | tr '[:upper:]' '[:lower:]')"
if [[ "$LOWER_DB_URL" =~ (^|[^a-z0-9])(prod|production|mainnet)([^a-z0-9]|$) ]] || \
   [[ "$LOWER_DB_URL" == *".rds.amazonaws.com"* ]] || \
   [[ "$LOWER_DB_URL" == *".supabase.co"* ]] || \
   [[ "$LOWER_DB_URL" == *".aws.neon.tech"* ]]; then
  echo "CRITICAL: Refusing to seed database — DATABASE_URL matches a protected production host or identifier." >&2
  exit 1
fi

echo "Verified safe non-production DATABASE_URL for profile '$PROFILE'."

if [[ "$DRY_RUN" == "true" ]]; then
  echo "[DRY-RUN] Would execute: npx tsx prisma/seed.ts --profile=$PROFILE"
  exit 0
fi

npx tsx prisma/seed.ts "--profile=$PROFILE"
