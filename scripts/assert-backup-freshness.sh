#!/usr/bin/env bash
#
# scripts/assert-backup-freshness.sh
#
# Asserts that the newest database backup in S3 satisfies the freshness SLO.
# Fails with exit code 1 if no backup exists or if the latest backup is older
# than the maximum allowed threshold (default: 26 hours for 24h RPO + 2h grace).
#
# Usage:
#   ./scripts/assert-backup-freshness.sh [--bucket <name>] [--max-age-hours <N>] [--mock-listing <file>] [--now-epoch <seconds>]
#
# Environment variables:
#   BACKUP_BUCKET         S3 bucket name (default: ophirpay-backups)
#   MAX_BACKUP_AGE_HOURS  Maximum age in hours before alert (default: 26)

set -euo pipefail

BACKUP_BUCKET="${BACKUP_BUCKET:-ophirpay-backups}"
MAX_AGE_HOURS="${MAX_BACKUP_AGE_HOURS:-26}"
MOCK_LISTING=""
NOW_EPOCH=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --bucket)
      BACKUP_BUCKET="$2"
      shift 2
      ;;
    --max-age-hours)
      MAX_AGE_HOURS="$2"
      shift 2
      ;;
    --mock-listing)
      MOCK_LISTING="$2"
      shift 2
      ;;
    --now-epoch)
      NOW_EPOCH="$2"
      shift 2
      ;;
    -h|--help)
      echo "Usage: $0 [--bucket <name>] [--max-age-hours <N>] [--mock-listing <file>] [--now-epoch <seconds>]"
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      exit 1
      ;;
  esac
done

if [[ -z "$NOW_EPOCH" ]]; then
  NOW_EPOCH=$(date +%s)
fi

echo "=== Database Backup Freshness Assertion ==="
echo "Target bucket: s3://${BACKUP_BUCKET}/"
echo "Max allowed age: ${MAX_AGE_HOURS} hours"

# ── 1. Retrieve backup listing ──────────────────────────────
if [[ -n "$MOCK_LISTING" ]]; then
  if [[ ! -f "$MOCK_LISTING" ]]; then
    echo "::error::Mock listing file '${MOCK_LISTING}' not found!" >&2
    exit 1
  fi
  LISTING=$(cat "$MOCK_LISTING")
else
  if ! command -v aws >/dev/null 2>&1; then
    echo "::error::AWS CLI not installed or not in PATH" >&2
    exit 1
  fi
  LISTING=$(aws s3 ls "s3://${BACKUP_BUCKET}/" 2>/dev/null || true)
fi

# Filter for .sql.gz backup files
BACKUP_LINES=$(echo "$LISTING" | grep -E '\.sql\.gz$' || true)

if [[ -z "$BACKUP_LINES" ]]; then
  echo "::error::Freshness assertion failed: No backup files (*.sql.gz) found in s3://${BACKUP_BUCKET}/!" >&2
  exit 1
fi

# ── 2. Identify the newest backup file ──────────────────────
LATEST_LINE=$(echo "$BACKUP_LINES" | sort -k1,2 | tail -n 1)
LATEST_FILE=$(echo "$LATEST_LINE" | awk '{print $NF}')

if [[ -z "$LATEST_FILE" ]]; then
  echo "::error::Freshness assertion failed: Could not determine latest backup file from listing." >&2
  exit 1
fi

echo "Latest backup identified: ${LATEST_FILE}"

# ── 3. Parse backup timestamp ───────────────────────────────
# Expected filename pattern: ophirpay-YYYY-MM-DDTHH-MM-SSZ.sql.gz
BACKUP_ISO=""
if [[ "$LATEST_FILE" =~ ([0-9]{4}-[0-9]{2}-[0-9]{2})T([0-9]{2})-([0-9]{2})-([0-9]{2})Z ]]; then
  DATE_PART="${BASH_REMATCH[1]}"
  HOUR="${BASH_REMATCH[2]}"
  MIN="${BASH_REMATCH[3]}"
  SEC="${BASH_REMATCH[4]}"
  BACKUP_ISO="${DATE_PART}T${HOUR}:${MIN}:${SEC}Z"
fi

BACKUP_EPOCH=0
if [[ -n "$BACKUP_ISO" ]]; then
  if date -d "$BACKUP_ISO" +%s >/dev/null 2>&1; then
    BACKUP_EPOCH=$(date -d "$BACKUP_ISO" +%s)
  elif command -v node >/dev/null 2>&1; then
    BACKUP_EPOCH=$(node -e "console.log(Math.floor(Date.parse('$BACKUP_ISO') / 1000))")
  fi
fi

# Fallback: if filename didn't match timestamp pattern, try line timestamp (columns 1 and 2)
if [[ "$BACKUP_EPOCH" -le 0 ]]; then
  LINE_DATE=$(echo "$LATEST_LINE" | awk '{print $1}')
  LINE_TIME=$(echo "$LATEST_LINE" | awk '{print $2}')
  if [[ -n "$LINE_DATE" && -n "$LINE_TIME" ]]; then
    FALLBACK_ISO="${LINE_DATE}T${LINE_TIME}Z"
    if date -d "$FALLBACK_ISO" +%s >/dev/null 2>&1; then
      BACKUP_EPOCH=$(date -d "$FALLBACK_ISO" +%s)
      BACKUP_ISO="$FALLBACK_ISO"
    fi
  fi
fi

if [[ "$BACKUP_EPOCH" -le 0 ]]; then
  echo "::error::Freshness assertion failed: Unable to parse timestamp from backup '${LATEST_FILE}'." >&2
  exit 1
fi

# ── 4. Calculate backup age and assert freshness ───────────
AGE_SECONDS=$(( NOW_EPOCH - BACKUP_EPOCH ))

# Handle minor clock skew
if [[ "$AGE_SECONDS" -lt 0 ]]; then
  AGE_SECONDS=0
fi

AGE_HOURS=$(( AGE_SECONDS / 3600 ))
AGE_MINUTES=$(( (AGE_SECONDS % 3600) / 60 ))

echo "Backup timestamp: ${BACKUP_ISO} (${BACKUP_EPOCH}s epoch)"
echo "Current timestamp: $(date -u -d "@${NOW_EPOCH}" +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null || date -u +"%Y-%m-%dT%H:%M:%SZ") (${NOW_EPOCH}s epoch)"
echo "Backup age: ${AGE_HOURS} hours, ${AGE_MINUTES} minutes (${AGE_SECONDS} seconds)"

if [[ "$AGE_HOURS" -gt "$MAX_AGE_HOURS" ]]; then
  echo "::error::Database backup freshness assertion FAILED! The latest backup '${LATEST_FILE}' is ${AGE_HOURS} hours old, which exceeds the freshness threshold of ${MAX_AGE_HOURS} hours." >&2
  echo "This indicates scheduled backups have stalled or failed silently. Immediate investigation required!" >&2
  exit 1
fi

echo "✓ Database backup freshness assertion PASSED: latest backup '${LATEST_FILE}' is within the ${MAX_AGE_HOURS} hour threshold."
exit 0
