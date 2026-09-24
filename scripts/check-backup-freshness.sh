#!/usr/bin/env bash
#
# scripts/check-backup-freshness.sh
#
# Freshness assertion for the nightly database backups (issue #752).
#
# Lists the backup bucket and fails when the newest backup object is older
# than BACKUP_MAX_AGE_HOURS. A scheduled workflow that stops running — or that
# fails before uploading — produces no error anyone sees, so freshness has to
# be asserted rather than assumed. This script turns that silence into a
# failed run (and, in CI, into a maintainer-facing alert).
#
# Usage:
#   BACKUP_BUCKET=ophirpay-backups ./scripts/check-backup-freshness.sh
#
# Environment:
#   BACKUP_BUCKET         bucket to inspect (default: ophirpay-backups)
#   BACKUP_MAX_AGE_HOURS  freshness budget in hours (default: 26)
#   NOW_EPOCH             override "now" as Unix seconds — for tests only
#   BACKUP_LISTING_FILE   read the bucket listing from this file instead of
#                         calling `aws s3 ls` — for tests and dry runs
#
# Requires: the AWS CLI with s3:ListBucket on the bucket (AWS_* env vars or
# configured credentials). Nothing is written to the bucket.
#
# Exit codes: 0 = newest backup within the budget, 1 = stale, missing, or the
# bucket could not be listed.

set -euo pipefail

BACKUP_BUCKET="${BACKUP_BUCKET:-ophirpay-backups}"
BACKUP_MAX_AGE_HOURS="${BACKUP_MAX_AGE_HOURS:-26}"
NOW_EPOCH="${NOW_EPOCH:-$(date -u +%s)}"

if [[ ! "$BACKUP_MAX_AGE_HOURS" =~ ^[0-9]+$ ]]; then
  echo "::error::BACKUP_MAX_AGE_HOURS must be a whole number of hours (got: ${BACKUP_MAX_AGE_HOURS})"
  exit 1
fi

echo "=== OphirPay backup freshness check ==="
echo "Bucket:           s3://${BACKUP_BUCKET}/"
echo "Freshness budget: ${BACKUP_MAX_AGE_HOURS}h"
echo "Now (UTC):        $(date -u -d "@${NOW_EPOCH}" +"%Y-%m-%dT%H:%M:%SZ")"
echo ""

if [[ -n "${BACKUP_LISTING_FILE:-}" ]]; then
  if ! listing="$(cat -- "${BACKUP_LISTING_FILE}")"; then
    echo "::error::cannot read BACKUP_LISTING_FILE=${BACKUP_LISTING_FILE}"
    exit 1
  fi
  echo "(listing read from ${BACKUP_LISTING_FILE} — aws s3 ls was not called)"
elif ! listing="$(aws s3 ls "s3://${BACKUP_BUCKET}/")"; then
  echo "::error::cannot list s3://${BACKUP_BUCKET}/ — check the AWS credentials and s3:ListBucket permission"
  exit 1
fi

# Only objects produced by .github/workflows/db-backup.yml count:
#   ophirpay-<UTC timestamp>.sql.gz
# Anything else in the bucket (manuals, restore-drill scratch copies, ...) is
# ignored so the assertion measures the real pipeline. The age is computed
# from the timestamp embedded in the object name (explicit UTC) rather than
# the listing column, so the result does not depend on the CLI's display
# timezone.
newest_epoch=0
newest_name=""
backup_count=0

while IFS= read -r raw_line; do
  line="${raw_line%$'\r'}"
  [[ -n "$line" ]] || continue
  [[ "$line" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}[[:space:]]+[0-9]{2}:[0-9]{2}:[0-9]{2}[[:space:]]+[0-9]+[[:space:]]+(ophirpay-([0-9]{4})-([0-9]{2})-([0-9]{2})T([0-9]{2})-([0-9]{2})-([0-9]{2})Z\.sql\.gz)$ ]] || continue

  backup_count=$((backup_count + 1))
  epoch="$(date -u -d "${BASH_REMATCH[2]}-${BASH_REMATCH[3]}-${BASH_REMATCH[4]}T${BASH_REMATCH[5]}:${BASH_REMATCH[6]}:${BASH_REMATCH[7]}Z" +%s)"

  if ((epoch > newest_epoch)); then
    newest_epoch="$epoch"
    newest_name="${BASH_REMATCH[1]}"
  fi
done <<<"$listing"

if [[ "$newest_epoch" -eq 0 ]]; then
  echo "✕ No backup objects matching ophirpay-*.sql.gz found in s3://${BACKUP_BUCKET}/"
  echo "::error::no database backups found in s3://${BACKUP_BUCKET}/"
  exit 1
fi

age_seconds=$((NOW_EPOCH - newest_epoch))
age_hours=$((age_seconds / 3600))
max_age_seconds=$((BACKUP_MAX_AGE_HOURS * 3600))

echo "Backups found:    ${backup_count}"
echo "Newest backup:    ${newest_name}"
echo "Newest age:       ${age_hours}h (${age_seconds}s)"
echo ""

if ((age_seconds > max_age_seconds)); then
  echo "✕ STALE: the newest backup is ${age_hours}h old — the budget is ${BACKUP_MAX_AGE_HOURS}h"
  echo "::error::the newest database backup is ${age_hours}h old (budget ${BACKUP_MAX_AGE_HOURS}h)"
  exit 1
fi

echo "✓ FRESH: the newest backup is ${age_hours}h old — within the ${BACKUP_MAX_AGE_HOURS}h budget"
