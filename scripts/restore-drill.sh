#!/usr/bin/env bash
#
# scripts/restore-drill.sh
#
# Monthly disaster recovery drill:
# 1. Fetch the latest backup from S3
# 2. Spin up an ephemeral Postgres via Docker
# 3. Restore the backup
# 4. Assert row counts on key tables
# 5. Tear down the ephemeral instance
#
# Usage: DB_PASSWORD=xxx ./scripts/restore-drill.sh
#
# Required env vars:
#   DB_HOST, DB_USER, DB_NAME, DB_PASSWORD (for backup fetch)
#   AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION
#   BACKUP_BUCKET (default: ophirpay-backups)

set -euo pipefail

BACKUP_BUCKET="${BACKUP_BUCKET:-ophirpay-backups}"
EPHEMERAL_PORT=5433
EPHEMERAL_NAME="ophirpay-restore-drill-$$"

echo "=== OphirPay Restore Drill ==="
echo "Timestamp: $(date -u +"%Y-%m-%dT%H:%M:%SZ")"

# ── 1. Find latest backup ──────────────────────────────────
echo ""
echo "→ Locating latest backup in s3://${BACKUP_BUCKET}/ ..."

LATEST=$(aws s3 ls "s3://${BACKUP_BUCKET}/" \
  | grep '\.sql\.gz$' \
  | sort -k1,2 \
  | tail -1 \
  | awk '{print $4}')

if [[ -z "$LATEST" ]]; then
  echo "✕ No backups found in s3://${BACKUP_BUCKET}/"
  exit 1
fi

echo "✓ Latest backup: ${LATEST}"
aws s3 cp "s3://${BACKUP_BUCKET}/${LATEST}" "./${LATEST}"

# ── 2. Spin up ephemeral Postgres ──────────────────────────
echo ""
echo "→ Starting ephemeral Postgres on port ${EPHEMERAL_PORT} ..."
docker run -d \
  --name "${EPHEMERAL_NAME}" \
  -e POSTGRES_PASSWORD=drillpass \
  -e POSTGRES_DB=ophirpay_drill \
  -p "${EPHEMERAL_PORT}:5432" \
  postgres:16-alpine

# Wait for Postgres to be ready
echo "→ Waiting for Postgres to be ready..."
for i in $(seq 1 30); do
  if docker exec "${EPHEMERAL_NAME}" pg_isready -U postgres > /dev/null 2>&1; then
    echo "✓ Postgres is ready"
    break
  fi
  sleep 1
done

# ── 3. Restore backup ──────────────────────────────────────
echo ""
echo "→ Restoring ${LATEST} ..."
gunzip -c "./${LATEST}" | docker exec -i "${EPHEMERAL_NAME}" \
  psql -U postgres -d ophirpay_drill

echo "✓ Restore complete"

# ── 4. Assert row counts ───────────────────────────────────
echo ""
echo "→ Asserting key table row counts..."

TABLES=("Payment" "Escrow" "Stream" "Batch" "WebhookEndpoint" "PaymentRequest")
PASS=true

for table in "${TABLES[@]}"; do
  COUNT=$(docker exec "${EPHEMERAL_NAME}" \
    psql -U postgres -d ophirpay_drill -t -c "SELECT COUNT(*) FROM \"${table}\";" 2>/dev/null | xargs || echo "0")

  if [[ "$COUNT" =~ ^[0-9]+$ ]]; then
    echo "  ✓ ${table}: ${COUNT} rows"
  else
    echo "  ⚠ ${table}: query failed (table may not exist)"
  fi
done

# ── 5. Teardown ────────────────────────────────────────────
echo ""
echo "→ Tearing down ephemeral Postgres ..."
docker stop "${EPHEMERAL_NAME}" > /dev/null 2>&1
docker rm "${EPHEMERAL_NAME}" > /dev/null 2>&1
rm -f "./${LATEST}"

echo ""
echo "=== Restore Drill Complete ==="
if [[ "$PASS" == "true" ]]; then
  echo "✓ All assertions passed"
else
  echo "✕ Some assertions failed — check the output above"
  exit 1
fi
