#!/usr/bin/env bash
#
# scripts/restore-drill.sh
#
# Restore drill for the nightly S3 backup — issue #751.
#
# A backup that has never been restored is an assumption. This script proves
# the assumption on every run:
#   1. Fetch a backup from S3 (the newest, or an explicit BACKUP_KEY).
#   2. Spin up an ephemeral Postgres via Docker.
#   3. Restore the backup (fail on an empty or corrupt gzip).
#   4. Assert row counts on the core tables — a missing/unqueryable table is a
#      failure, not a warning (the previous version printed a warning and still
#      exited 0, so a damaged dump could pass).
#   5. Assert the restored schema is migration-consistent via
#      `prisma migrate status`.
#   6. Tear down the ephemeral instance.
#
# The workflow `.github/workflows/db-restore-drill.yml` runs this on a schedule
# and on demand, and fails loudly when the drill fails.
#
# Usage:
#   DB_PASSWORD=xxx ./scripts/restore-drill.sh
#
# Required env vars:
#   AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION
#
# Optional env vars:
#   BACKUP_BUCKET            (default: ophirpay-backups)
#   BACKUP_KEY               explicit S3 object key to restore (default: newest)
#   EPHEMERAL_PORT           host port for the disposable Postgres (default: 5433)
#   MIGRATION_STATUS_STRICT  'true' to fail when migrations are merely pending
#                            (default: false — fail only on a *broken*/
#                            inconsistent migrations table, since a backup may
#                            legitimately predate a migration)
#   SKIP_MIGRATION_STATUS    'true' to skip step 5 entirely (default: false)
#   RESTORE_ON_ERROR_STOP    'false' to keep going past SQL errors (default: true)

set -euo pipefail

BACKUP_BUCKET="${BACKUP_BUCKET:-ophirpay-backups}"
BACKUP_KEY="${BACKUP_KEY:-}"
EPHEMERAL_PORT="${EPHEMERAL_PORT:-5433}"
EPHEMERAL_NAME="ophirpay-restore-drill-$$"
EPHEMERAL_DB="ophirpay_drill"
EPHEMERAL_USER="postgres"
EPHEMERAL_PASSWORD="drillpass"
MIGRATION_STATUS_STRICT="${MIGRATION_STATUS_STRICT:-false}"
SKIP_MIGRATION_STATUS="${SKIP_MIGRATION_STATUS:-false}"
RESTORE_ON_ERROR_STOP="${RESTORE_ON_ERROR_STOP:-true}"

# Core tables that must exist and be queryable in a restorable dump. These are
# the Prisma models at the heart of the application (prisma/schema.prisma).
CORE_TABLES=(
  "Payment"
  "Batch"
  "Recurrence"
  "ScheduledPayment"
  "PaymentRequest"
  "Webhook"
  "WebhookDelivery"
  "Refund"
  "User"
)

DOWNLOADED=""
FAIL=0

cleanup() {
  echo ""
  echo "→ Tearing down ephemeral Postgres ..."
  docker stop "${EPHEMERAL_NAME}" > /dev/null 2>&1 || true
  docker rm "${EPHEMERAL_NAME}" > /dev/null 2>&1 || true
  if [[ -n "${DOWNLOADED}" && -f "${DOWNLOADED}" ]]; then
    rm -f "${DOWNLOADED}"
  fi
}
trap cleanup EXIT

fail() {
  echo "  ✕ $1"
  FAIL=1
}

echo "=== OphirPay Restore Drill ==="
echo "Timestamp: $(date -u +"%Y-%m-%dT%H:%M:%SZ")"

# ── 1. Locate the backup ───────────────────────────────────
echo ""
if [[ -n "${BACKUP_KEY}" ]]; then
  LATEST="${BACKUP_KEY}"
  echo "→ Using explicitly requested backup: ${LATEST}"
else
  echo "→ Locating latest backup in s3://${BACKUP_BUCKET}/ ..."
  LATEST=$(aws s3 ls "s3://${BACKUP_BUCKET}/" \
    | grep '\.sql\.gz$' \
    | sort -k1,2 \
    | tail -1 \
    | awk '{print $4}')
fi

if [[ -z "${LATEST}" ]]; then
  echo "✕ No backups found in s3://${BACKUP_BUCKET}/"
  exit 1
fi

echo "✓ Backup: ${LATEST}"
aws s3 cp "s3://${BACKUP_BUCKET}/${LATEST}" "./${LATEST}"
DOWNLOADED="./${LATEST}"

# ── 1b. Validate the downloaded artifact ───────────────────
# A missing/truncated/corrupt object must fail the drill before we pretend to
# restore it (issue #751 acceptance criterion).
if [[ ! -s "${DOWNLOADED}" ]]; then
  echo "✕ Downloaded backup is empty: ${DOWNLOADED}"
  exit 1
fi
if ! gzip -t "${DOWNLOADED}" 2>/dev/null; then
  echo "✕ Downloaded backup is not a valid gzip file: ${DOWNLOADED}"
  exit 1
fi
echo "✓ Backup is a non-empty, valid gzip ($(du -h "${DOWNLOADED}" | cut -f1))"

# ── 2. Spin up an ephemeral Postgres ───────────────────────
echo ""
echo "→ Starting ephemeral Postgres on port ${EPHEMERAL_PORT} ..."
docker run -d \
  --name "${EPHEMERAL_NAME}" \
  -e POSTGRES_PASSWORD="${EPHEMERAL_PASSWORD}" \
  -e POSTGRES_DB="${EPHEMERAL_DB}" \
  -p "${EPHEMERAL_PORT}:5432" \
  postgres:16-alpine > /dev/null

echo "→ Waiting for Postgres to be ready..."
READY=false
for _ in $(seq 1 30); do
  if docker exec "${EPHEMERAL_NAME}" pg_isready -U "${EPHEMERAL_USER}" > /dev/null 2>&1; then
    READY=true
    echo "✓ Postgres is ready"
    break
  fi
  sleep 1
done
if [[ "${READY}" != "true" ]]; then
  echo "✕ Ephemeral Postgres never became ready"
  exit 1
fi

DATABASE_URL="postgresql://${EPHEMERAL_USER}:${EPHEMERAL_PASSWORD}@127.0.0.1:${EPHEMERAL_PORT}/${EPHEMERAL_DB}"

# ── 3. Restore the backup ──────────────────────────────────
echo ""
echo "→ Restoring ${LATEST} ..."
PSQL_EXTRA=()
if [[ "${RESTORE_ON_ERROR_STOP}" == "true" ]]; then
  PSQL_EXTRA=(-v ON_ERROR_STOP=1)
fi

if gunzip -c "${DOWNLOADED}" | docker exec -i "${EPHEMERAL_NAME}" \
  psql -U "${EPHEMERAL_USER}" -d "${EPHEMERAL_DB}" "${PSQL_EXTRA[@]}" > /tmp/restore-drill-psql.log 2>&1; then
  echo "✓ Restore complete"
else
  echo "✕ Restore command failed — see the SQL log below"
  tail -50 /tmp/restore-drill-psql.log || true
  exit 1
fi

# ── 4. Assert row counts on the core tables ────────────────
echo ""
echo "→ Asserting key table row counts..."
for table in "${CORE_TABLES[@]}"; do
  if COUNT=$(docker exec "${EPHEMERAL_NAME}" \
    psql -U "${EPHEMERAL_USER}" -d "${EPHEMERAL_DB}" -tA \
    -c "SELECT COUNT(*) FROM \"${table}\";" 2>/dev/null) && [[ "${COUNT}" =~ ^[0-9]+$ ]]; then
    echo "  ✓ ${table}: ${COUNT} rows"
  else
    fail "${table}: missing or unqueryable in the restored database"
  fi
done

# ── 5. Migration-status verification ───────────────────────
echo ""
if [[ "${SKIP_MIGRATION_STATUS}" == "true" ]]; then
  echo "→ Skipping migration-status check (SKIP_MIGRATION_STATUS=true)"
elif command -v npx > /dev/null 2>&1 && [[ -f prisma/schema.prisma ]]; then
  echo "→ Checking migration status with prisma migrate status..."

  # The migrations bookkeeping lives in _prisma_migrations. A missing table
  # means the dump did not restore the full schema, and a row with a NULL
  # finished_at means a migration failed or was interrupted.
  if docker exec "${EPHEMERAL_NAME}" \
    psql -U "${EPHEMERAL_USER}" -d "${EPHEMERAL_DB}" -tA \
    -c "SELECT to_regclass('public.\"_prisma_migrations\"');" 2>/dev/null | grep -q _prisma_migrations; then
    UNFINISHED=$(docker exec "${EPHEMERAL_NAME}" \
      psql -U "${EPHEMERAL_USER}" -d "${EPHEMERAL_DB}" -tA \
      -c "SELECT COUNT(*) FROM \"_prisma_migrations\" WHERE finished_at IS NULL AND rolled_back_at IS NULL;" \
      2>/dev/null | tr -d '[:space:]' || true)
    if [[ "${UNFINISHED:-1}" == "0" ]]; then
      echo "  ✓ _prisma_migrations present, no unfinished migrations"
    else
      fail "_prisma_migrations has ${UNFINISHED:-<unknown>} unfinished migration(s)"
    fi
  else
    fail "_prisma_migrations table is missing from the restored database"
  fi

  STATUS_OUTPUT="$(DATABASE_URL="${DATABASE_URL}" npx --no-install prisma migrate status 2>&1 || true)"
  echo "${STATUS_OUTPUT}" | sed 's/^/  │ /'

  if echo "${STATUS_OUTPUT}" | grep -qiE "failed migration|have failed|P3009"; then
    fail "prisma migrate status reports a failed migration"
  fi
  if echo "${STATUS_OUTPUT}" | grep -qiE "P3005|migrations table.*(missing|not found)|migration.*table.*does not exist"; then
    fail "prisma migrate status reports a missing migrations table"
  fi
  if echo "${STATUS_OUTPUT}" | grep -qiE "not yet been applied|following migration"; then
    if [[ "${MIGRATION_STATUS_STRICT}" == "true" ]]; then
      fail "prisma migrate status reports pending migrations (strict mode)"
    else
      echo "  ⚠ pending migration(s) relative to this checkout — the backup predates them; set MIGRATION_STATUS_STRICT=true to fail"
    fi
  fi
  if echo "${STATUS_OUTPUT}" | grep -qi "Database schema is up to date"; then
    echo "  ✓ Database schema is up to date"
  fi
else
  echo "  ⚠ npx/prisma unavailable — skipping migration-status check"
fi

# ── 6. Summary ─────────────────────────────────────────────
echo ""
echo "=== Restore Drill Complete ==="
if [[ "${FAIL}" -eq 1 ]]; then
  echo "✕ Drill FAILED — see the assertions above"
  exit 1
fi
echo "✓ All assertions passed"
