# OphirPay — Mainnet Deployment Guide

This guide walks through deploying OphirPay to Stellar Mainnet with PostgreSQL, Soroban contracts, Kubernetes, and monitoring.

## Pre-Flight Checklist

- [ ] Stellar Mainnet Horizon URL and Soroban RPC URL obtained
- [ ] Mainnet Freighter wallet with sufficient XLM (>100 XLM for contract deployment)
- [ ] PostgreSQL 16 instance provisioned (RDS, Cloud SQL, or self-hosted)
- [ ] Kubernetes cluster with ingress-nginx and cert-manager
- [ ] Domain with DNS pointing to cluster ingress IP
- [ ] S3-compatible bucket for database backups
- [ ] Prometheus + Grafana instance for monitoring
- [ ] PagerDuty or Slack webhook for alerts

---

## 1. Environment Configuration

### 1.1 Create `.env.production`

```env
# Network
NEXT_PUBLIC_STELLAR_NETWORK=PUBLIC
NEXT_PUBLIC_HORIZON_URL=https://horizon.stellar.org
NEXT_PUBLIC_SOROBAN_RPC_URL=https://soroban.stellar.org

# Database
DATABASE_URL=postgresql://user:password@host:5432/ophirpay
DATABASE_PROVIDER=postgresql

# Contracts
NEXT_PUBLIC_CONTRACT_ID=<deployed-mainnet-contract-id>
NEXT_PUBLIC_EMITTER_CONTRACT_ID=<deployed-emitter-contract-id>

# App
NEXT_PUBLIC_APP_URL=https://ophirpay.com
NODE_ENV=production
```

### 1.2 Verify configuration

```bash
npx prisma generate
DATABASE_URL="postgresql://..." npx prisma migrate deploy
```

---

## 2. Soroban Contract Deployment

### 2.1 Build WASM artifacts

```bash
cd contracts/ophirpay
cargo build --target wasm32v1-none --release
cd ../emitter
cargo build --target wasm32v1-none --release
```

### 2.2 Deploy OphirPay contract

```bash
stellar contract deploy \
  --wasm target/wasm32v1-none/release/ophirpay.wasm \
  --source <MAINNET_KEY> \
  --network public \
  --fee 10000000

# Save the returned contract ID → NEXT_PUBLIC_CONTRACT_ID
```

### 2.3 Deploy Emitter contract

```bash
stellar contract deploy \
  --wasm ../emitter/target/wasm32v1-none/release/emitter.wasm \
  --source <MAINNET_KEY> \
  --network public \
  --fee 10000000

# Save the returned contract ID → NEXT_PUBLIC_EMITTER_CONTRACT_ID
```

### 2.4 Initialize contracts

```bash
# Initialize OphirPay with owner address
stellar contract invoke \
  --id <CONTRACT_ID> \
  --source <MAINNET_KEY> \
  --network public \
  -- init --owner <OWNER_PUBLIC_KEY>

# Verify
stellar contract invoke \
  --id <CONTRACT_ID> \
  --source <MAINNET_KEY> \
  --network public \
  -- get_owner
```

---

## 2.5 Contract Address Registry

| Network | OphirPay Contract | Emitter Contract |
|---|---|---|
| **Testnet** | `CBRCZHMNWOFTWOTCI2WBQ5A5HVKVLO2AXHYIWJ5FVYB45OHLSLWGJGYB` | `CA6LAPR4OWABPWORBQGK5O5H5S62GIPQBKP3PH7H2DQ3ZNSWSH3RHFE4` |
| **Mainnet** | *To be deployed* | *To be deployed* |

> After mainnet deployment, update this table and set the contract IDs in `.env.production`.

---

## 3. Database Setup

### 3.1 Provision PostgreSQL

```sql
CREATE DATABASE ophirpay;
CREATE USER ophirpay WITH PASSWORD '<secure-password>';
GRANT ALL PRIVILEGES ON DATABASE ophirpay TO ophirpay;
```

### 3.2 Run migrations

```bash
DATABASE_URL="postgresql://ophirpay:<password>@<host>:5432/ophirpay" \
  npx prisma migrate deploy
```

### 3.3 Seed initial data (optional)

```bash
DATABASE_URL="..." npx prisma db seed
```

### 3.4 Verify connectivity

```bash
DATABASE_URL="..." npx prisma db push --force-reset  # Test only
```

---

## 4. Kubernetes Deployment

### 4.1 Create namespace and secrets

```bash
kubectl create namespace ophirpay

kubectl create secret generic ophirpay-secrets \
  --namespace ophirpay \
  --from-literal=DATABASE_URL="postgresql://..." \
  --from-literal=NEXT_PUBLIC_CONTRACT_ID="<contract-id>" \
  --from-literal=NEXT_PUBLIC_EMITTER_CONTRACT_ID="<emitter-id>"
```

### 4.2 Deploy with Helm

```bash
helm upgrade --install ophirpay ./helm/ophirpay \
  --namespace ophirpay \
  --set image.tag=v1.0.0 \
  --set ingress.hosts[0].host=ophirpay.com \
  --set config.NEXT_PUBLIC_STELLAR_NETWORK=PUBLIC \
  --set config.NEXT_PUBLIC_HORIZON_URL=https://horizon.stellar.org \
  --set config.NEXT_PUBLIC_SOROBAN_RPC_URL=https://soroban.stellar.org \
  --set config.DATABASE_PROVIDER=postgresql \
  --set config.NODE_ENV=production \
  --wait
```

### 4.3 Verify deployment

```bash
kubectl get pods -n ophirpay
kubectl get svc -n ophirpay
kubectl get ingress -n ophirpay

# Check health
curl https://ophirpay.com/api/health
```

---

## 5. Monitoring Setup

### 5.1 Verify Prometheus scraping

```bash
# Metrics should be available at:
curl https://ophirpay.com/api/metrics
```

### 5.2 Import Grafana dashboard

1. Go to Grafana → Dashboards → Import
2. Upload `monitoring/grafana-dashboard.json`
3. Select the Prometheus datasource
4. Verify panels populate with data

### 5.3 Configure alerts

Recommended alert thresholds:
- **5xx error rate > 1%** → PagerDuty critical
- **p99 latency > 2s** → Slack warning
- **Webhook failure rate > 5%** → Slack warning
- **DB backup missed** → PagerDuty critical
- **Restore drill failed** → PagerDuty critical

---

## 6. DNS & SSL

### 6.1 Configure DNS

```
ophirpay.com     A     <INGRESS_IP>
api.ophirpay.com CNAME ophirpay.com
```

### 6.2 Verify SSL

cert-manager will auto-provision Let's Encrypt certificates:

```bash
kubectl get certificate -n ophirpay
# Should show READY=True
```

---

## 7. Post-Deployment Verification

### 7.1 Smoke test

- [ ] Visit `https://ophirpay.com` — dashboard loads
- [ ] Connect Freighter wallet — balance displays
- [ ] Send a test payment — transaction succeeds
- [ ] Check on-chain record — `get_payment(1)` returns data
- [ ] Verify webhook delivery — POST received at test endpoint
- [ ] Metrics endpoint returns data — `/api/metrics`

### 7.2 Run E2E tests against production

```bash
E2E_BASE_URL=https://ophirpay.com npx playwright test
```

---

## 8. Rollback Plan

If a deployment causes issues:

```bash
# Rollback Helm release
helm rollback ophirpay -n ophirpay

# Or deploy previous image
helm upgrade ophirpay ./helm/ophirpay \
  --namespace ophirpay \
  --set image.tag=v0.9.0
```

For contract issues, the two-step upgrade timelock provides 24 hours to cancel a bad upgrade:

```bash
# If upgrade was just proposed:
stellar contract invoke \
  --id <CONTRACT_ID> \
  --source <OWNER_KEY> \
  --network public \
  -- cancel_upgrade
```

---

## 9. Maintenance

### Nightly backups
Automated via `.github/workflows/db-backup.yml` — runs at 3 AM UTC, retains 30 days.

### Monthly restore drill
```bash
DB_HOST=... DB_USER=... DB_PASSWORD=... \
AWS_ACCESS_KEY_ID=... AWS_SECRET_ACCESS_KEY=... \
./scripts/restore-drill.sh
```

### Contract upgrades
Use the two-step timelock:
1. `propose_upgrade(new_wasm_hash)` — starts 24h countdown
2. Wait 24h
3. `execute_upgrade()` — applies the upgrade

---

## 10. Emergency Contacts

| Role | Contact |
|---|---|
| On-call engineer | PagerDuty escalation policy |
| Stellar network status | https://status.stellar.org |
| Soroban RPC status | https://status.stellar.org |
