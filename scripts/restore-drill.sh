#!/usr/bin/env bash
#
# scripts/restore-drill.sh
#
# Automated disaster recovery restore drill:
# 1. Fetch latest backup from S3 (or accept a local backup file as argument / BACKUP_FILE)
# 2. Validate backup integrity (non-empty, valid gzip format)
# 3. Spin up an ephemeral Postgres instance via Docker
# 4. Atomically restore the backup with ON_ERROR_STOP=1
# 5. Assert row counts across canonical Prisma tables
# 6. Verify schema migration status via `npx prisma migrate status`
# 7. Tear down the ephemeral container via EXIT trap
#
# Usage:
#   ./scripts/restore-drill.sh                       # Downloads latest from s3://${BACKUP_BUCKET}/
#   ./scripts/restore-drill.sh path/to/backup.sql.gz # Uses local backup file
#   BACKUP_FILE=path/to/backup.sql.gz ./scripts/restore-drill.sh
#
# Environment variables:
#   BACKUP_FILE      Path to local backup file (skips S3 fetch if provided)
#   BACKUP_BUCKET    S3 bucket containing backups (default: ophirpay-backups)
#   EPHEMERAL_PORT   Host port for ephemeral Postgres container (default: 5433)
#   SKIP_MIGRATIONS  Set to "true" to skip prisma migrate status check (optional)

set -euo pipefail

BACKUP_BUCKET="${BACKUP_BUCKET:-ophirpay-backups}"
EPHEMERAL_PORT="${EPHEMERAL_PORT:-5433}"
EPHEMERAL_NAME="ophirpay-restore-drill-$$"
CLEANUP_TEMP_BACKUP=false

echo "=== OphirPay Restore Drill ==="
echo "Timestamp: $(date -u +"%Y-%m-%dT%H:%M:%SZ")"

# ── Cleanup Trap ───────────────────────────────────────────
cleanup() {
  local exit_code=$?
  echo ""
  echo "→ Cleaning up ephemeral resources..."
  if command -v docker >/dev/null 2>&1; then
    docker stop "${EPHEMERAL_NAME}" >/dev/null 2>&1 || true
    docker rm "${EPHEMERAL_NAME}" >/dev/null 2>&1 || true
  fi
  if [[ "$CLEANUP_TEMP_BACKUP" == "true" && -n "${BACKUP_PATH:-}" && -f "${BACKUP_PATH}" ]]; then
    echo "→ Removing temporary downloaded backup: ${BACKUP_PATH}"
    rm -f "${BACKUP_PATH}"
  fi
  if [[ $exit_code -ne 0 ]]; then
    echo "::error::Restore drill failed with exit code ${exit_code}" >&2
  fi
  exit "$exit_code"
}
trap cleanup EXIT

# ── 1. Locate and Validate Backup ──────────────────────────
BACKUP_PATH="${1:-${BACKUP_FILE:-}}"

if [[ -z "$BACKUP_PATH" ]]; then
  echo ""
  echo "→ Locating latest backup in s3://${BACKUP_BUCKET}/ ..."
  if ! command -v aws >/dev/null 2>&1; then
    echo "::error::aws CLI not found and no local BACKUP_FILE provided" >&2
    exit 1
  fi

  LATEST=$(aws s3 ls "s3://${BACKUP_BUCKET}/" \
    | grep '\.sql\.gz$' \
    | sort -k1,2 \
    | tail -1 \
    | awk '{print $4}')

  if [[ -z "$LATEST" ]]; then
    echo "::error::No backups found in s3://${BACKUP_BUCKET}/" >&2
    exit 1
  fi

  echo "✓ Latest backup located: ${LATEST}"
  BACKUP_PATH="./${LATEST}"
  aws s3 cp "s3://${BACKUP_BUCKET}/${LATEST}" "${BACKUP_PATH}"
  CLEANUP_TEMP_BACKUP=true
fi

echo ""
echo "→ Validating backup archive: ${BACKUP_PATH}"
if [[ ! -f "$BACKUP_PATH" ]]; then
  echo "::error::Backup file does not exist: ${BACKUP_PATH}" >&2
  exit 1
fi

if [[ ! -s "$BACKUP_PATH" ]]; then
  echo "::error::Backup file is empty (0 bytes): ${BACKUP_PATH}" >&2
  exit 1
fi

if ! gzip -t "$BACKUP_PATH" 2>/dev/null; then
  echo "::error::Backup archive is corrupted or not a valid gzip file: ${BACKUP_PATH}" >&2
  exit 1
fi
echo "✓ Backup archive integrity verified (valid gzip, size $(du -h "${BACKUP_PATH}" | cut -f1))"

# ── 2. Spin Up Ephemeral Postgres ──────────────────────────
if ! command -v docker >/dev/null 2>&1; then
  echo "::error::Docker is required to run the ephemeral database restore drill" >&2
  exit 1
fi

echo ""
echo "→ Starting ephemeral Postgres on port ${EPHEMERAL_PORT} ..."
docker run -d \
  --name "${EPHEMERAL_NAME}" \
  -e POSTGRES_PASSWORD=drillpass \
  -e POSTGRES_DB=ophirpay_drill \
  -p "${EPHEMERAL_PORT}:5432" \
  postgres:16-alpine

echo "→ Waiting for Postgres to be ready..."
READY=false
for i in $(seq 1 30); do
  if docker exec "${EPHEMERAL_NAME}" pg_isready -U postgres >/dev/null 2>&1; then
    READY=true
    echo "✓ Postgres is ready"
    break
  fi
  sleep 1
done

if [[ "$READY" != "true" ]]; then
  echo "::error::Ephemeral Postgres failed to become ready within 30 seconds" >&2
  exit 1
fi

# ── 3. Atomically Restore Backup ───────────────────────────
echo ""
echo "→ Restoring ${BACKUP_PATH} into ephemeral database..."
if ! gunzip -c "${BACKUP_PATH}" | docker exec -i "${EPHEMERAL_NAME}" \
  psql -U postgres -d ophirpay_drill -v ON_ERROR_STOP=1 --single-transaction; then
  echo "::error::Failed to restore database dump (syntax error or corrupted data)" >&2
  exit 1
fi

echo "✓ Restore command completed successfully"

# ── 4. Assert Key Table Row Counts ─────────────────────────
echo ""
echo "→ Asserting key table row counts..."

TABLES=("User" "Account" "Payment" "Batch" "PaymentRequest" "Webhook" "ApiKey")
PASS=true

for table in "${TABLES[@]}"; do
  COUNT=$(docker exec "${EPHEMERAL_NAME}" \
    psql -U postgres -d ophirpay_drill -t -c "SELECT COUNT(*) FROM \"${table}\";" 2>/dev/null | xargs || echo "FAIL")

  if [[ "$COUNT" =~ ^[0-9]+$ ]]; then
    echo "  ✓ ${table}: ${COUNT} rows"
  else
    echo "  ✕ ${table}: query failed (table may be missing or corrupt in restored dump)"
    PASS=false
  fi
done

# ── 5. Verify Migration Status via Prisma ──────────────────
if [[ "${SKIP_MIGRATIONS:-false}" != "true" ]]; then
  echo ""
  echo "→ Verifying migration status via Prisma..."
  DRILL_DATABASE_URL="postgresql://postgres:drillpass@localhost:${EPHEMERAL_PORT}/ophirpay_drill"
  if command -v npx >/dev/null 2>&1; then
    if DATABASE_URL="${DRILL_DATABASE_URL}" npx prisma migrate status; then
      echo "✓ Prisma migration status: database schema is up to date"
    else
      echo "  ✕ Prisma migration status reported unapplied migrations or schema drift"
      PASS=false
    fi
  else
    echo "  ⚠ npx not found, skipping prisma migrate status check"
  fi
fi

# ── 6. Summary ─────────────────────────────────────────────
echo ""
echo "=== Restore Drill Complete ==="
if [[ "$PASS" == "true" ]]; then
  echo "✓ All restore assertions passed successfully"
  exit 0
else
  echo "✕ Restore drill failed: one or more checks failed" >&2
  exit 1
fi
