# 🚨 OphirPay Disaster Recovery Runbook

> **Executable checklist** for restoring OphirPay's PostgreSQL database from a
> nightly S3 backup, reconciling the restored database with on-chain Stellar
> state, and cutting traffic back to the recovered system.
>
> Read this document end-to-end before executing any step. Steps that have
> never been exercised outside a drill are marked **⚠️ UNTESTED IN PRODUCTION**.

---

## Table of Contents

1. [Recovery Objectives (RPO & RTO)](#1-recovery-objectives-rpo--rto)
2. [When to Declare a Disaster](#2-when-to-declare-a-disaster)
3. [Pre-Requisites](#3-pre-requisites)
4. [Phase 1 — Isolate & Communicate](#phase-1--isolate--communicate)
5. [Phase 2 — Restore the Database](#phase-2--restore-the-database)
6. [Phase 3 — Verify the Restored Database](#phase-3--verify-the-restored-database)
7. [Phase 4 — Chain-vs-Database Reconciliation](#phase-4--chainvs-database-reconciliation)
8. [Phase 5 — Cut Traffic to the Recovered System](#phase-5--cut-traffic-to-the-recovered-system)
9. [Phase 6 — Post-Recovery Verification](#phase-6--post-recovery-verification)
10. [Phase 7 — Rollback (if the Restore Fails)](#phase-7--rollback-if-the-restore-fails)
11. [Communication Templates](#communication-templates)
12. [Related Documents](#related-documents)

---

## 1. Recovery Objectives (RPO & RTO)

| Metric | Target | How it is met |
|--------|--------|---------------|
| **RPO** (Recovery Point Objective — maximum acceptable data loss) | **24 hours** | `.github/workflows/db-backup.yml` runs `pg_dump → gzip → S3` every day at **03:00 UTC** (`cron: "0 3 * * *"`). The worst-case scenario is a failure that occurs just before the next backup, meaning up to 24 hours of transactions must be reconciled from on-chain state (see [Phase 4](#phase-4--chainvs-database-reconciliation)). |
| **RTO** (Recovery Time Objective — time to restore service) | **2 hours** | Breakdown: ~15 min to locate the backup and spin up a fresh PostgreSQL instance, ~30 min to restore + verify (depending on database size), ~45 min for chain reconciliation, ~15 min for traffic cutover and smoke testing. The 2-hour target assumes a single on-call engineer with the required credentials and tool access. |

Backups are stored in **S3 bucket `ophirpay-backups`** with the `STANDARD_IA`
storage class and a **30-day retention policy**. This means up to 30 recovery
points are available at any given time.

---

## 2. When to Declare a Disaster

Trigger this runbook when **any** of the following are true and cannot be
resolved by a normal restart or rollback within 30 minutes:

- Primary PostgreSQL instance is unrecoverable (corrupted data files, accidental
  `DROP DATABASE`, storage failure).
- Data is found to be inconsistent after a failed migration or bulk operation and
  the issue cannot be fixed in place.
- A security incident requires spinning up a clean database from a known-good
  backup.

If the issue is an application code bug or an infrastructure failure that does
**not** affect the database, use [docs/MAINNET_RUNBOOK.md](./MAINNET_RUNBOOK.md)
(Phase 5 — Rollback procedures) instead.

---

## 3. Pre-Requisites

Complete every item before starting Phase 1. If any item is missing, resolve it
before proceeding.

### 3.1 Tools

| Tool | Version | Check command |
|------|---------|---------------|
| `aws` CLI | v2+ | `aws --version` |
| `docker` | 24+ | `docker --version` |
| `psql` (PostgreSQL client) | 14+ | `psql --version` |
| `jq` | 1.6+ | `jq --version` |
| `curl` | any | `curl --version` |

### 3.2 Credentials

All of the following environment variables must be set on the machine running
the restore. See [docs/SECRETS_ROTATION.md](./SECRETS_ROTATION.md) for where
each secret is stored and how to retrieve it.

```bash
export DB_HOST="<production-postgres-host>"      # target DB host for the restored DB
export DB_USER="<db-username>"
export DB_NAME="ophirpay"
export DB_PASSWORD="<db-password>"
export AWS_ACCESS_KEY_ID="<aws-key>"
export AWS_SECRET_ACCESS_KEY="<aws-secret>"
export AWS_REGION="<aws-region>"
export BACKUP_BUCKET="ophirpay-backups"
```

> 🔐 **Never paste these values into a chat, ticket, or commit.** Retrieve them
> from the secrets manager or GitHub Actions Secrets (Settings → Secrets and
> variables → Actions). If credentials are suspected to be compromised, rotate
> them first — see [docs/SECRETS_ROTATION.md](./SECRETS_ROTATION.md).

### 3.3 Access

- [ ] AWS IAM permissions: `s3:GetObject`, `s3:ListBucket` on `ophirpay-backups`
- [ ] Network access to the target PostgreSQL host (VPN or bastion if required)
- [ ] Docker daemon running on the restore machine
- [ ] Write access to the production database host (for Phase 2, step 2.4)

---

## Phase 1 — Isolate & Communicate

> **Goal:** Stop new writes to the broken database and notify stakeholders before
> starting the restore. This prevents the gap between the backup and "now" from
> growing while you work.

- [ ] **1.1 Put the application into maintenance mode** — scale down the app
  pods or flip the load balancer to a maintenance page:

  ```bash
  # Kubernetes (scale to 0 replicas)
  kubectl scale deployment ophirpay --replicas=0 -n ophirpay

  # Or via Helm (set replicaCount to 0 in values):
  helm upgrade ophirpay ./helm/ophirpay --namespace ophirpay --set replicaCount=0 --wait
  ```

  > ⚠️ **UNTESTED IN PRODUCTION** — verify the exact deployment name and
  > namespace with `kubectl get deployments -n ophirpay` before running.

- [ ] **1.2 Record the exact time maintenance mode was activated** — you will
  use this timestamp in Phase 4 to bound the chain query window.

  ```bash
  echo "MAINTENANCE_START=$(date -u +"%Y-%m-%dT%H:%M:%SZ")" | tee -a recovery.log
  ```

- [ ] **1.3 Notify stakeholders** — see [Communication Templates](#communication-templates).
  At minimum: post in the incident Slack channel, update the status page to
  "Investigating", and page the on-call engineer if not already active.

- [ ] **1.4 Open a recovery log file** and record every command and its output:

  ```bash
  exec > >(tee -a recovery.log) 2>&1
  echo "=== Recovery started at $(date -u) by $(whoami) ==="
  ```

---

## Phase 2 — Restore the Database

> **Goal:** Restore the latest available backup into a clean PostgreSQL instance
> and verify its integrity using `scripts/restore-drill.sh`.

### Step 2.1 — Run the automated restore drill

The `scripts/restore-drill.sh` script handles fetching the backup, spinning up
an ephemeral Postgres instance, and asserting row counts. Run it first to
confirm the backup is restorable before touching production.

```bash
# From the repository root, with all env vars set from Section 3.2:
bash scripts/restore-drill.sh
```

Expected output:
```
=== OphirPay Restore Drill ===
Timestamp: 2026-09-25T10:00:00Z
→ Locating latest backup in s3://ophirpay-backups/ ...
✓ Latest backup: ophirpay-2026-09-25T03-00-00Z.sql.gz
→ Starting ephemeral Postgres on port 5433 ...
✓ Postgres is ready
→ Restoring ophirpay-2026-09-25T03-00-00Z.sql.gz ...
✓ Restore complete
→ Asserting key table row counts...
  ✓ Payment: <N> rows
  ✓ Escrow: <N> rows
  ✓ Stream: <N> rows
  ✓ Batch: <N> rows
  ✓ WebhookEndpoint: <N> rows
  ✓ PaymentRequest: <N> rows
→ Tearing down ephemeral Postgres ...
=== Restore Drill Complete ===
✓ All assertions passed
```

Record the row counts from the drill output — you will compare them against the
production restore in Step 2.4.

**If the drill fails**, see [Phase 7 — Rollback](#phase-7--rollback-if-the-restore-fails).

### Step 2.2 — Identify the backup to restore

Normally you want the **latest** backup. If the latest backup is itself
corrupted or was taken after the incident began, list available backups and
select the last known-good one:

```bash
aws s3 ls "s3://${BACKUP_BUCKET}/" | grep '\.sql\.gz$' | sort -k1,2
```

Backup filenames follow the format `ophirpay-<YYYY-MM-DDTHH-MM-SSZ>.sql.gz`.
The timestamp is when the backup was created (03:00 UTC daily). Note the
filename you will restore:

```bash
export RESTORE_FILE="ophirpay-2026-09-25T03-00-00Z.sql.gz"
echo "Restoring from: ${RESTORE_FILE}" | tee -a recovery.log
```

### Step 2.3 — Download and validate the backup file

```bash
aws s3 cp "s3://${BACKUP_BUCKET}/${RESTORE_FILE}" "./${RESTORE_FILE}"

# Verify the file is non-empty and a valid gzip
test -s "./${RESTORE_FILE}" && echo "✓ File is non-empty" || { echo "✕ File is empty"; exit 1; }
gzip -t "./${RESTORE_FILE}" && echo "✓ Valid gzip" || { echo "✕ Invalid gzip"; exit 1; }
```

### Step 2.4 — Restore into the production database

> ⚠️ **UNTESTED IN PRODUCTION** — this step overwrites the production database.
> Confirm that the application is in maintenance mode (Phase 1, Step 1.1) and
> that all stakeholders have been notified before continuing.

```bash
# Drop and recreate the target database to start from a clean slate
PGPASSWORD="${DB_PASSWORD}" psql \
  -h "${DB_HOST}" -U "${DB_USER}" -d postgres \
  -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${DB_NAME}';"

PGPASSWORD="${DB_PASSWORD}" psql \
  -h "${DB_HOST}" -U "${DB_USER}" -d postgres \
  -c "DROP DATABASE IF EXISTS ${DB_NAME};"

PGPASSWORD="${DB_PASSWORD}" psql \
  -h "${DB_HOST}" -U "${DB_USER}" -d postgres \
  -c "CREATE DATABASE ${DB_NAME};"

# Restore from the backup
gunzip -c "./${RESTORE_FILE}" | PGPASSWORD="${DB_PASSWORD}" psql \
  -h "${DB_HOST}" -U "${DB_USER}" -d "${DB_NAME}"

echo "✓ Restore complete at $(date -u)" | tee -a recovery.log
```

### Step 2.5 — Run pending migrations (if any)

If there were database migrations between the backup timestamp and the
current application version, apply them now:

```bash
DATABASE_URL="postgresql://${DB_USER}:${DB_PASSWORD}@${DB_HOST}/${DB_NAME}" \
  npx prisma migrate deploy
```

> If `prisma migrate deploy` reports that no migrations are pending, that is
> expected when restoring to the same app version that was running at backup
> time. If it fails, stop here and escalate — do not proceed with an
> inconsistent schema.

### Step 2.6 — Clean up the downloaded backup file

```bash
rm -f "./${RESTORE_FILE}"
```

---

## Phase 3 — Verify the Restored Database

> **Goal:** Confirm the production restore is structurally sound before allowing
> any traffic.

### Step 3.1 — Row count verification

Connect to the restored production database and compare row counts against what
`scripts/restore-drill.sh` reported in Step 2.1:

```sql
-- Connect:
-- PGPASSWORD=<DB_PASSWORD> psql -h <DB_HOST> -U <DB_USER> -d <DB_NAME>

SELECT
  'Payment'         AS table_name, COUNT(*) FROM "Payment"
UNION ALL SELECT 'Escrow',         COUNT(*) FROM "Escrow"
UNION ALL SELECT 'Stream',         COUNT(*) FROM "Stream"
UNION ALL SELECT 'Batch',          COUNT(*) FROM "Batch"
UNION ALL SELECT 'WebhookEndpoint',COUNT(*) FROM "WebhookEndpoint"
UNION ALL SELECT 'PaymentRequest', COUNT(*) FROM "PaymentRequest";
```

Expected: counts match the drill output from Step 2.1.

### Step 3.2 — Check the most recent records

```sql
-- Most recent 5 payments (confirms data is not truncated)
SELECT id, "createdAt", status, amount
FROM "Payment"
ORDER BY "createdAt" DESC
LIMIT 5;

-- Most recent backup timestamp approximation
SELECT MAX("createdAt") AS latest_payment_ts FROM "Payment";
SELECT MAX("createdAt") AS latest_transaction_ts FROM "Escrow";
```

Record the `latest_payment_ts` value — you will use it in Phase 4 to define
the reconciliation window.

```bash
echo "BACKUP_LATEST_TS=<value from query above>" | tee -a recovery.log
```

### Step 3.3 — Schema integrity check

```sql
-- Confirm foreign-key constraints are intact (no orphaned rows)
SELECT COUNT(*) FROM "Payment" p
LEFT JOIN "Escrow" e ON p."escrowId" = e.id
WHERE p."escrowId" IS NOT NULL AND e.id IS NULL;
-- Expected: 0
```

### Step 3.4 — Health endpoint check (optional pre-cutover)

If you have a staging environment pointed at the restored database, run a quick
health check:

```bash
curl -sf http://<staging-host>/api/health | jq .
# Expected: { "status": "ok", "database": "connected" }
```

---

## Phase 4 — Chain-vs-Database Reconciliation

> **This is the most critical phase for a payments system.** The on-chain Stellar
> ledger is immutable — it cannot be rolled back. After a database restore, the
> DB reflects state as of the backup timestamp. Any Stellar transactions
> submitted between the backup and the incident must be re-indexed into the
> database.

### Why reconciliation is necessary

OphirPay records payment state in both the Stellar blockchain (via the
`OphirPayContract` / `PaymentEventEmitter` Soroban contracts) and the
PostgreSQL database (for querying, history, and business logic). The on-chain
record is the source of truth. After restoring from a backup, the database may
be **hours behind** the chain. Payments that were processed on-chain but are
absent from the DB would appear missing to users and in internal reporting.

### Step 4.1 — Determine the reconciliation window

```bash
# From Phase 3, Step 3.2:
BACKUP_TS="${BACKUP_LATEST_TS}"       # e.g. "2026-09-25T03:00:00Z"
INCIDENT_TS="${MAINTENANCE_START}"    # recorded in Phase 1, Step 1.2

echo "Reconciliation window: ${BACKUP_TS} → ${INCIDENT_TS}" | tee -a recovery.log
```

### Step 4.2 — Query Stellar Horizon for missing transactions

Use the Stellar Horizon REST API to fetch all contract events emitted by the
`PaymentEventEmitter` contract in the reconciliation window. Replace
`<EMITTER_CONTRACT_ID>` with the value from [docs/MAINNET_RUNBOOK.md](./MAINNET_RUNBOOK.md)
Phase 4 registry.

```bash
EMITTER_CONTRACT_ID="<EMITTER_CONTRACT_ID>"
HORIZON_URL="https://horizon.stellar.org"

# Fetch contract events paged from the backup timestamp onward
# The cursor can be derived from a Stellar ledger sequence number near BACKUP_TS.
# Use the /ledgers endpoint to find the ledger at the backup time:
curl -s "${HORIZON_URL}/ledgers?order=asc&limit=1&cursor=$(
  # Convert ISO timestamp to approximate cursor — use Horizon's ledger search:
  curl -s "${HORIZON_URL}/ledgers?order=desc&limit=200" \
    | jq -r "[.._embedded.records[]? | select(.closed_at < \"${BACKUP_TS}\")] | last | .paging_token // empty"
)" | jq '.paging_token'
```

> ⚠️ **UNTESTED IN PRODUCTION** — The cursor arithmetic above is a starting
> point. Adjust the `limit` and `cursor` values based on the actual ledger
> volume. See [docs/STELLAR_101.md](./STELLAR_101.md) for Stellar ledger
> concepts.

A simpler, more reliable approach for most incidents:

```bash
# List all contract events for the emitter in the window (using stellar CLI):
stellar events \
  --network public \
  --contract-id "${EMITTER_CONTRACT_ID}" \
  --start-ledger <ledger-at-backup-time>
```

### Step 4.3 — Re-index missing transactions

For each on-chain event found in Step 4.2 that does not exist in the database:

1. Extract the payment ID, sender, recipient, amount, asset, and timestamp from
   the on-chain event data.
2. Insert a matching row into the `Payment` table with `status = 'CONFIRMED'`
   and the on-chain `txHash`.
3. If an associated `Escrow` record is expected, upsert it with the recovered
   state.

> ⚠️ **UNTESTED IN PRODUCTION** — The re-indexing logic depends on the
> application's internal event schema. Coordinate with the engineering team
> before writing directly to the DB. If an automated re-indexer script exists
> in the codebase (check `scripts/` and `src/jobs/`), prefer that over manual
> SQL.

Manual SQL template (adapt to actual schema from [docs/SCHEMA.md](./SCHEMA.md)):

```sql
-- Example: insert a recovered payment record
INSERT INTO "Payment" (id, "txHash", sender, recipient, amount, asset, status, "createdAt", "updatedAt")
VALUES (
  '<payment-id-from-chain>',
  '<stellar-tx-hash>',
  '<sender-public-key>',
  '<recipient-public-key>',
  <amount-in-stroops>,
  '<asset-code>',
  'CONFIRMED',
  '<on-chain-timestamp>',
  NOW()
)
ON CONFLICT (id) DO NOTHING;
```

### Step 4.4 — Mark reconciliation complete

When all missing transactions have been re-indexed:

```sql
-- Record the reconciliation event for audit purposes
-- (Adapt to your audit/event log table if one exists)
INSERT INTO "AuditLog" (action, detail, "createdAt")
VALUES (
  'DISASTER_RECOVERY_RECONCILIATION',
  json_build_object(
    'backup_file', :'RESTORE_FILE',
    'backup_ts',   :'BACKUP_TS',
    'incident_ts', :'INCIDENT_TS',
    'recovered_by', current_user
  )::text,
  NOW()
);
```

> If no `AuditLog` table exists, record this in the recovery log file and in
> the incident ticket.

```bash
echo "Reconciliation complete at $(date -u). Re-indexed <N> transactions." | tee -a recovery.log
```

---

## Phase 5 — Cut Traffic to the Recovered System

> **Goal:** Restore normal application traffic to the recovered database.

- [ ] **5.1 Re-run database migrations** (idempotent — safe to run again):

  ```bash
  DATABASE_URL="postgresql://${DB_USER}:${DB_PASSWORD}@${DB_HOST}/${DB_NAME}" \
    npx prisma migrate deploy
  ```

- [ ] **5.2 Scale the application back up**:

  ```bash
  # Kubernetes
  kubectl scale deployment ophirpay --replicas=<desired-count> -n ophirpay

  # Or via Helm
  helm upgrade ophirpay ./helm/ophirpay --namespace ophirpay \
    --set replicaCount=<desired-count> --wait
  ```

  See [docs/DEPLOYMENT.md](./DEPLOYMENT.md) for Helm values and replica counts
  for each environment.

- [ ] **5.3 Confirm the health endpoint returns healthy**:

  ```bash
  curl -sf https://ophirpay.com/api/health | jq .
  # Expected: { "status": "ok", "database": "connected" }
  ```

- [ ] **5.4 Update the status page** — change from "Investigating" to
  "Monitoring" or "Resolved" depending on confidence.

- [ ] **5.5 Notify stakeholders** that service has been restored — see
  [Communication Templates](#communication-templates).

---

## Phase 6 — Post-Recovery Verification

Run these checks after traffic has been restored to confirm end-to-end health.

- [ ] Dashboard loads: `curl -s -o /dev/null -w "%{http_code}" https://ophirpay.com/` → `200`

- [ ] Contract endpoints answer:

  ```bash
  curl -sf https://ophirpay.com/api/contracts | jq .
  # Expected: returns contract version and owner — confirms app is wired to mainnet contracts
  ```

- [ ] SSE stream connects and emits heartbeats:

  ```bash
  curl -N --max-time 30 https://ophirpay.com/api/events
  # Expected: "event: connected" then "event: heartbeat" every 15 seconds
  ```

- [ ] Metrics are healthy: `GET /api/metrics` (with `METRICS_TOKEN` bearer
  token) returns Prometheus-format counters with no error spikes.

- [ ] Verify a small test payment end-to-end (non-production funds only — use
  the on-call team's test wallet).

- [ ] Re-enable the nightly backup workflow if it was disabled during the
  incident:

  ```bash
  gh workflow enable db-backup.yml --repo OphirPay/OphirPay
  ```

- [ ] Confirm the next scheduled backup runs successfully (check GitHub Actions
  at 03:00 UTC the following day).

---

## Phase 7 — Rollback (if the Restore Fails)

Use this phase if `scripts/restore-drill.sh` fails or the production restore
produces an inconsistent database that cannot be reconciled.

### 7.1 Drill failure — try the next-oldest backup

```bash
# List backups in reverse order and pick the previous one
aws s3 ls "s3://${BACKUP_BUCKET}/" | grep '\.sql\.gz$' | sort -k1,2 -r | head -5

# Set RESTORE_FILE to the previous backup and repeat Phase 2
export RESTORE_FILE="ophirpay-2026-09-24T03-00-00Z.sql.gz"
```

Repeat Phases 2–4 with the older backup. Extend the reconciliation window
accordingly.

### 7.2 Point-in-time restore (if supported by the DB provider)

If the PostgreSQL instance is hosted on AWS RDS or Aurora and PITR
(Point-in-Time Recovery) is enabled:

```bash
# AWS RDS — restore to a specific time
aws rds restore-db-instance-to-point-in-time \
  --source-db-instance-identifier ophirpay-production \
  --target-db-instance-identifier ophirpay-recovered \
  --restore-time "2026-09-25T02:55:00Z"
```

> ⚠️ **UNTESTED IN PRODUCTION** — confirm that PITR is enabled and that the
> restore window covers the required timestamp before relying on this path.

### 7.3 Escalation

If neither option produces a restorable database within the 2-hour RTO:

1. Keep the application in maintenance mode.
2. Page the engineering lead and CTO.
3. Assess whether a partial restore (restoring only critical tables) is viable.
4. Evaluate standing up a read replica from the last known-good replica snapshot
   if one exists.
5. Document every step taken in the recovery log for the post-mortem.

---

## Communication Templates

### Initial incident notification (Slack / PagerDuty)

```
🚨 [INCIDENT] OphirPay database recovery in progress
- Severity: P1
- Status: Database restore initiated
- Maintenance started: <MAINTENANCE_START>
- Estimated recovery: <MAINTENANCE_START + 2 hours>
- On-call: <engineer name>
- Incident channel: #incident-<date>
- Status page: https://status.ophirpay.com
```

### Status page update — "Investigating"

```
We are investigating an issue affecting OphirPay. Payments may be temporarily
unavailable. Our team is actively working on a resolution. Next update in 30 minutes.
```

### Status page update — "Resolved"

```
The database has been restored and all services are operating normally.
Payments processed during the maintenance window have been reconciled with
on-chain state. We apologise for the disruption. A full post-mortem will be
published within 48 hours.
```

### Internal post-restore summary

```
Recovery complete — summary:
- Backup restored: <RESTORE_FILE>
- Backup timestamp: <BACKUP_TS>
- Maintenance window: <MAINTENANCE_START> → <end time>
- Transactions re-indexed: <count>
- All health checks: PASS
- Recovery log: recovery.log (attach to incident ticket)
```

---

## Related Documents

| Document | Relevance |
|----------|-----------|
| [docs/SECRETS_ROTATION.md](./SECRETS_ROTATION.md) | How to retrieve and rotate the credentials needed for this runbook |
| [docs/DEPLOYMENT.md](./DEPLOYMENT.md) | Helm values, replica counts, and environment configuration for cutover |
| [docs/MAINNET_RUNBOOK.md](./MAINNET_RUNBOOK.md) | App-level rollback procedures; Phase 4 registry for contract IDs |
| [docs/SCHEMA.md](./SCHEMA.md) | Database schema reference for reconciliation SQL |
| [docs/STELLAR_101.md](./STELLAR_101.md) | Stellar ledger and Horizon API concepts used in Phase 4 |
| [docs/TROUBLESHOOTING.md](./TROUBLESHOOTING.md) | Symptom → fix for common errors during recovery |
| `.github/workflows/db-backup.yml` | Backup workflow definition (schedule, bucket, retention) |
| `scripts/restore-drill.sh` | Automated restore drill script used in Phase 2 |
