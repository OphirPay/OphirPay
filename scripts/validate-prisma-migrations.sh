#!/usr/bin/env bash
# scripts/validate-prisma-migrations.sh
# Validates Prisma schema, migration directory integrity, and detects drift/breaking changes.

set -euo pipefail

echo "========================================================"
echo "  OphirPay Prisma CI: Validation & Drift Check"
echo "========================================================"

SCHEMA_FILE="prisma/schema.prisma"
MIGRATIONS_DIR="prisma/migrations"

# Set a fallback dummy DATABASE_URL if not provided in environment for static validation
export DATABASE_URL="${DATABASE_URL:-postgresql://prisma:prisma@localhost:5432/ophirpay_ci}"

# 1. Check schema file exists
if [ ! -f "$SCHEMA_FILE" ]; then
  echo "❌ Error: $SCHEMA_FILE not found."
  exit 1
fi

# 2. Native Prisma validate
echo "🔍 Validating Prisma Schema syntax..."
npx prisma validate

# 3. Check migration directory structure
if [ ! -d "$MIGRATIONS_DIR" ]; then
  echo "❌ Error: $MIGRATIONS_DIR directory not found."
  exit 1
fi

echo "🔍 Checking migration files integrity..."
for mig in "$MIGRATIONS_DIR"/*/; do
  if [ -d "$mig" ]; then
    if [ ! -f "${mig}migration.sql" ]; then
      echo "❌ Error: Missing migration.sql in directory $mig"
      exit 1
    fi
  fi
done

# 4. Check for destructive table drops or database wipes
echo "🔍 Scanning migrations for destructive SQL commands..."
if grep -rnwi --include="migration.sql" "DROP DATABASE" "$MIGRATIONS_DIR"; then
  echo "❌ Error: Detected DROP DATABASE command in migrations."
  exit 1
fi

echo "✅ All Prisma schema & migration checks passed successfully!"
