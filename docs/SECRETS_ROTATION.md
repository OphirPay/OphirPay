# 🔐 Secrets Inventory & Rotation Runbook

> **Purpose:** Maintain an up-to-date inventory of every secret used by OphirPay,
> where it is stored, and a step-by-step rotation checklist. This document
> satisfies issue #562 — audit secrets and rotation workflow.
>
> **Last audited:** 2026-08-29

---

## Table of Contents

- [1. Secrets Inventory](#1-secrets-inventory)
- [2. Where Each Secret Is Set](#2-where-each-secret-is-set)
- [3. Git History Audit](#3-git-history-audit)
- [4. Rotation Checklists](#4-rotation-checklists)
- [5. Incident Response — Suspected Compromise](#5-incident-response--suspected-compromise)
- [6. Verification Steps](#6-verification-steps)

---

## 1. Secrets Inventory

| # | Secret | Purpose | Sensitivity | Storage Location(s) |
|---|--------|---------|-------------|---------------------|
| 1 | `AUTH_SECRET` | HMAC-SHA256 key that signs wallet session cookies (`src/lib/auth-session.ts`). Forges the entire auth layer if exposed. | **Critical** | Vercel env / K8s Secret / Helm values |
| 2 | `HOOK_SECRET` | HMAC-SHA256 key for webhook payload signing (`scripts/relayer.ts`). Exposure allows forging webhook deliveries. | **Critical** | K8s Secret / Helm values / `.env.local` |
| 3 | `DATABASE_URL` | PostgreSQL connection string (contains password). Full database read/write access. | **Critical** | Vercel env / K8s Secret / Helm values / Docker env |
| 4 | `DIRECT_DATABASE_URL` | Direct (non-pooled) PostgreSQL connection string for Prisma migrations. | **High** | Same as `DATABASE_URL` |
| 5 | `REDIS_URL` | Redis connection URL for distributed rate limiting (`src/lib/rate-limit.ts`). | **High** | K8s Secret / Helm values / Docker env |
| 6 | `DB_PASSWORD` | PostgreSQL password for the backup workflow (`db-backup.yml`). | **High** | GitHub Actions Secrets |
| 7 | `DB_HOST` | PostgreSQL host for the backup workflow. | **Medium** | GitHub Actions Secrets |
| 8 | `DB_USER` | PostgreSQL user for the backup workflow. | **Medium** | GitHub Actions Secrets |
| 9 | `DB_NAME` | Database name for the backup workflow. | **Low** | GitHub Actions Secrets |
| 10 | `AWS_ACCESS_KEY_ID` | AWS key for S3 backup uploads (`db-backup.yml`). | **High** | GitHub Actions Secrets |
| 11 | `AWS_SECRET_ACCESS_KEY` | AWS secret for S3 backup uploads. | **Critical** | GitHub Actions Secrets |
| 12 | `AWS_REGION` | AWS region for S3 operations. | **Low** | GitHub Actions Secrets |
| 13 | `NEXT_PUBLIC_SENTRY_DSN` | Sentry error-tracking DSN. Low risk (DSNs are public in client bundles). | **Low** | Vercel env |
| 14 | `NEXT_PUBLIC_GA_ID` | Google Analytics measurement ID. Public by design. | **Info** | Vercel env |

> **Not secrets** (public by design, do not rotate):
> `NEXT_PUBLIC_STELLAR_NETWORK`, `NEXT_PUBLIC_STELLAR_RPC_URL`,
> `NEXT_PUBLIC_STELLAR_HORIZON_URL`, `STELLAR_NETWORK_PASSPHRASE`,
> `NEXT_PUBLIC_CONTRACT_ID`, `NEXT_PUBLIC_EMITTER_CONTRACT_ID`,
> `NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_CHAIN_READ_SOURCE`,
> `NEXT_PUBLIC_FEATURE_*`, `NEXT_PUBLIC_DEMO_MODE`, `NEXT_PUBLIC_APP_VERSION`,
> `NEXT_PUBLIC_EVENTS_WS_PORT`, `RATE_LIMIT_RPM`, `AUTH_RATE_LIMIT_*`,
> `NODE_ENV`, `VERCEL`, `CI`.

---

## 2. Where Each Secret Is Set

### 2.1 Vercel (Production)

Set in **Vercel Dashboard → Settings → Environment Variables** (Production):

| Variable | Notes |
|----------|-------|
| `AUTH_SECRET` | Generate with `openssl rand -hex 32` |
| `DATABASE_URL` | PostgreSQL connection string |
| `DIRECT_DATABASE_URL` | For Prisma migrations (when using connection pooling) |
| `NEXT_PUBLIC_SENTRY_DSN` | Optional — Sentry DSN |

### 2.2 Kubernetes / Helm

Managed via Kubernetes `Secret` resource (`k8s/namespace-config.yaml`) or
Helm values (`helm/ophirpay/values.yaml`):

```bash
kubectl create secret generic ophirpay-secrets \
  --namespace ophirpay \
  --from-literal=DATABASE_URL="postgresql://..." \
  --from-literal=AUTH_SECRET="$(openssl rand -hex 32)" \
  --from-literal=HOOK_SECRET="$(openssl rand -hex 32)" \
  --from-literal=NEXT_PUBLIC_CONTRACT_ID="..." \
  --from-literal=NEXT_PUBLIC_EMITTER_CONTRACT_ID="..."
```

Referenced in:
- `k8s/deployment.yaml` → `secretRef: ophirpay-secrets`
- `helm/ophirpay/templates/config.yaml` → `kind: Secret`
- `helm/ophirpay/templates/deployment.yaml` → `secretRef`

### 2.3 Docker Compose

Set in `docker-compose.yml` or passed via `.env.local` (never committed).

### 2.4 GitHub Actions

Managed in **GitHub → Settings → Secrets and variables → Actions**:

| Secret | Used in |
|--------|---------|
| `DB_PASSWORD` | `db-backup.yml` |
| `DB_HOST` | `db-backup.yml` |
| `DB_USER` | `db-backup.yml` |
| `DB_NAME` | `db-backup.yml` |
| `AWS_ACCESS_KEY_ID` | `db-backup.yml` |
| `AWS_SECRET_ACCESS_KEY` | `db-backup.yml` |
| `AWS_REGION` | `db-backup.yml` |

### 2.5 Local Development

Set in `.env.local` (gitignored via `.gitignore`). Use `.env.example` as a
template — never commit `.env.local`.

---

## 3. Git History Audit

### 3.1 Historical Findings (Verified Clean)

| File | Commit | Content | Verdict |
|------|--------|---------|---------|
| `.env` | `5ed8d4a` | Dev defaults: SQLite DB, localhost URLs only. **No secrets.** | ✅ Safe |
| `.env.testnet` | `75834a4` | Testnet contract IDs + public Stellar endpoints. **No secrets.** | ✅ Safe |

Both files were subsequently removed from tracking and added to `.gitignore`.

### 3.2 Protections in Place

- **`.gitignore`** excludes: `.env`, `.env*.local`, `.env.testnet`, `*.pem`
- **`.gitleaks.toml`** configures Gitleaks to scan the full history, with
  allowlist entries for known public identifiers (testnet contract IDs, demo
  addresses) — **not** real secrets
- **CI pipeline** (`.github/workflows/ci.yml` → `secrets-scan` job) runs
  `gitleaks detect --config .gitleaks.toml --verbose --redact` with
  `fetch-depth: 0` on every push and PR
- **No real secrets** (AUTH_SECRET, HOOK_SECRET, DB_PASSWORD, AWS keys) have
  ever been committed to the repository

### 3.3 Recommended: Periodic History Scan

Run this quarterly (or after a suspected compromise):

```bash
# Full history scan with Gitleaks
gitleaks detect --config .gitleaks.toml --verbose --redact

# Or scan without redaction for debugging
gitleaks detect --config .gitleaks.toml --verbose
```

---

## 4. Rotation Checklists

### 4.1 AUTH_SECRET (Critical — Session Signing)

**Risk if compromised:** An attacker can forge valid session cookies and
impersonate any user.

**Rotation frequency:** Every 90 days, or immediately on suspected compromise.

```bash
# 1. Generate a new secret
NEW_SECRET=$(openssl rand -hex 32)
echo "New AUTH_SECRET: $NEW_SECRET"

# 2. Update the secret in your platform:
#    - Vercel: Dashboard → Settings → Environment Variables → AUTH_SECRET
#    - K8s: kubectl create secret generic ophirpay-secrets --from-literal=AUTH_SECRET="$NEW_SECRET" -n ophirpay --dry-run=client -o yaml | kubectl apply -f -
#    - Helm: helm upgrade ophirpay ./helm/ophirpay --set secrets.AUTH_SECRET="$NEW_SECRET"
#    - Docker: Update docker-compose.yml or .env.local

# 3. Restart the application (Vercel auto-redeploys; K8s: kubectl rollout restart deployment/ophirpay -n ophirpay)

# 4. Verify — all existing sessions are invalidated (users must re-authenticate):
curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/api/auth/session
# Expected: 401 (no valid session cookie)

# 5. Test a fresh login flow
#    - Connect a Freighter wallet
#    - Sign the challenge
#    - Confirm session cookie is issued and subsequent API calls succeed

# 6. Document the rotation in your change log
```

**Zero-downtime note:** Rotating AUTH_SECRET immediately invalidates all active
sessions. Users will need to reconnect their wallets. Schedule during low-traffic
periods and notify users in advance.

### 4.2 HOOK_SECRET (Critical — Webhook Signing)

**Risk if compromised:** An attacker can forge webhook payloads that appear
legitimate to downstream consumers.

**Rotation frequency:** Every 90 days, or immediately on suspected compromise.

```bash
# 1. Generate a new secret
NEW_SECRET=$(openssl rand -hex 32)
echo "New HOOK_SECRET: $NEW_SECRET"

# 2. Update in your platform (same locations as AUTH_SECRET, plus relayer env)

# 3. Notify webhook subscribers to update their signature verification key
#    (send the new secret via a secure channel — NOT email)

# 4. Restart the relayer:
#    - K8s: kubectl rollout restart deployment/relayer -n ophirpay
#    - Docker: docker compose restart relayer

# 5. Verify — send a test webhook and confirm the signature is valid
#    (check X-OphirPay-Signature header)
```

**Important:** Webhook subscribers need the new secret before you rotate.
Coordinate the switch with them to avoid dropped deliveries.

### 4.3 DATABASE_URL / DIRECT_DATABASE_URL (Critical)

**Risk if compromised:** Full database read/write access, including user data
and financial records.

**Rotation frequency:** Every 90 days, or when a team member with DB access
departs.

```bash
# 1. Generate a new PostgreSQL password
NEW_DB_PASS=$(openssl rand -base64 24)
echo "New DB password: $NEW_DB_PASS"

# 2. Update the PostgreSQL user password
psql -h $DB_HOST -U postgres -d postgres \
  -c "ALTER USER ophirpay WITH PASSWORD '$NEW_DB_PASS';"

# 3. Update DATABASE_URL in all platforms (Vercel, K8s, Helm, Docker)
#    Format: postgresql://ophirpay:${NEW_DB_PASS}@${DB_HOST}:5432/ophirpay

# 4. Also update DIRECT_DATABASE_URL if using connection pooling

# 5. Restart the application

# 6. Verify:
curl -s https://your-domain.com/api/health | jq .database
# Expected: "connected"
```

### 4.4 Redis URL (High)

**Risk if compromised:** Rate limiting bypass, potential cache poisoning.

```bash
# 1. Generate a new Redis password
NEW_REDIS_PASS=$(openssl rand -hex 16)

# 2. Update Redis password
redis-cli CONFIG SET requirepass "$NEW_REDIS_PASS"

# 3. Update REDIS_URL in all platforms
#    Format: redis://:${NEW_REDIS_PASS}@${REDIS_HOST}:6379

# 4. Restart the application

# 5. Verify rate limiting works:
curl -s https://your-domain.com/api/health | jq .redis
```

### 4.5 AWS Credentials (db-backup workflow)

**Risk if compromised:** Unauthorized S3 access, potential data exfiltration.

**Rotation frequency:** Every 90 days (AWS best practice).

```bash
# 1. Create a new IAM access key in AWS Console:
#    IAM → Users → ophirpay-backup → Security credentials → Create access key

# 2. Update GitHub Actions secrets:
#    GitHub → OphirPay → Settings → Secrets → Actions:
#    - AWS_ACCESS_KEY_ID
#    - AWS_SECRET_ACCESS_KEY

# 3. Delete the old access key in AWS Console

# 4. Test the backup workflow:
gh workflow run db-backup.yml
# Or wait for the next nightly run

# 5. Verify the backup completed:
gh run list --workflow=db-backup.yml --limit=1
```

### 4.6 GitHub Actions Secrets (DB_PASSWORD, DB_HOST, etc.)

**Rotation frequency:** When the underlying credentials change.

```bash
# Update via GitHub UI:
# Repository → Settings → Secrets and variables → Actions → [secret name] → Update

# Or via CLI:
gh secret set DB_PASSWORD --body "$NEW_DB_PASS"
gh secret set DB_HOST --body "new-host.example.com"
gh secret set DB_USER --body "ophirpay"
gh secret set DB_NAME --body "ophirpay"
```

---

## 5. Incident Response — Suspected Compromise

If you suspect a secret has been exposed:

### 5.1 Immediate (Within 1 Hour)

1. **Rotate the compromised secret** using the checklist above.
2. **Revoke any active sessions** if `AUTH_SECRET` was exposed — force all
   users to re-authenticate.
3. **Check for unauthorized access:**
   - Database: `SELECT * FROM audit_log WHERE created_at > NOW() - INTERVAL '24 hours';`
   - GitHub: Review Actions logs for unusual workflows
   - AWS: Check CloudTrail for unauthorized S3 access
4. **Rotate adjacent secrets** if there is any doubt about scope.

### 5.2 Within 24 Hours

1. **Scan git history** to confirm no secrets were committed:
   ```bash
   gitleaks detect --config .gitleaks.toml --verbose
   ```
2. **Review access logs** for all affected systems.
3. **Notify affected users** if user data may have been exposed.
4. **File a security advisory** if the incident affects production users.

### 5.3 Post-Incident

1. Update this document with lessons learned.
2. Review and tighten access controls.
3. Consider adding automated secret rotation (e.g., via Vault, AWS Secrets
   Manager, or Doppler).

---

## 6. Verification Steps

After any rotation, verify the application is healthy:

```bash
# 1. Health check
curl -s https://your-domain.com/api/health | jq .
# Expected: { "status": "ok", "database": "connected", ... }

# 2. Auth flow (if AUTH_SECRET rotated)
#    - Clear browser cookies
#    - Connect Freighter wallet
#    - Sign challenge → confirm session issued

# 3. Webhook test (if HOOK_SECRET rotated)
#    - Create a test webhook endpoint
#    - Trigger a payment event
#    - Verify X-OphirPay-Signature validates with new secret

# 4. Backup test (if AWS credentials rotated)
gh workflow run db-backup.yml
# Confirm backup uploaded to S3

# 5. Rate limiting (if Redis URL rotated)
for i in $(seq 1 5); do
  curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/api/health
done
# All should return 200 (rate limiting working normally)
```

---

## Appendix: Secret Generation Commands

| Secret | Command |
|--------|---------|
| `AUTH_SECRET` | `openssl rand -hex 32` |
| `HOOK_SECRET` | `openssl rand -hex 32` |
| `DB_PASSWORD` | `openssl rand -base64 24` |
| `REDIS_PASSWORD` | `openssl rand -hex 16` |
| AWS access key | Create via AWS IAM Console |

> **Never** generate secrets with `Math.random()`, `Date.now()`, or other
> non-cryptographic sources. Always use `openssl rand`, `crypto.randomBytes`,
> or a dedicated secrets manager.

---

<div align="center">

**[← Back to OphirPay README](../README.md)** · **[SECURITY.md](../SECURITY.md)**

</div>
