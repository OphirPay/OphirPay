# OphirPay — Mainnet Deployment Guide

This guide walks through deploying OphirPay to Stellar Mainnet with PostgreSQL, Soroban contracts, Kubernetes, and monitoring.

> 🚀 **Looking for the executable checklist?** Use the
> [**Mainnet Deployment Runbook**](./MAINNET_RUNBOOK.md) — it consolidates this
> guide into a step-by-step runbook with a pre-flight checklist (funding, WASM
> hashes, contract IDs), rollback procedures, and post-deploy verification.

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

> ⚠ **WARNING:** This section targets the **live Stellar Mainnet**. There is **no friendbot** — the deployer account must be funded with real XLM. Deployments are irreversible and cost real XLM. Always run the dry-run first.

### 2.1 Account funding

Mainnet accounts are **not** funded by friendbot. Fund the deployer account with real XLM before deploying:

```bash
# Check the deployer account balance (must be > 100 XLM for contract deployment)
curl -s "https://horizon.stellar.org/accounts/<MAINNET_PUBLIC_KEY>" | jq '.balances[] | select(.asset_type=="native") | .balance'

# Fund from an exchange or another funded wallet by sending XLM to <MAINNET_PUBLIC_KEY>.
# Recommended minimum: 100 XLM to cover upload + deploy + init + verification fees.
```

### 2.2 Build WASM artifacts

```bash
cd contracts/ophirpay
cargo build --target wasm32v1-none --release
cd ../emitter
cargo build --target wasm32v1-none --release
```

### 2.3 Dry-run validation (REQUIRED before any real submission)

Validate the PUBLIC network configuration **without** submitting any transaction:

```bash
NETWORK_MODE=PUBLIC DRY_RUN=true \
  ./scripts/deploy-workflow.sh <MAINNET_SECRET_KEY> <OWNER_PUBLIC_KEY> <EMITTER_CONTRACT_ID>
```

The dry-run must **fail** with a clear message before any real submission. Only proceed once it confirms the correct mainnet RPC/Horizon and that friendbot is disabled.

You can also run the standalone CI validation script, which asserts the deploy script's PUBLIC config compiles and targets Stellar Mainnet:

```bash
bash scripts/validate-deploy-config.sh
```

This script is used in CI to guard against accidental testnet/mainnet misconfiguration.

### 2.4 Deploy order: emitter → main

Deploy the **emitter first**, then the **main contract** (the main contract is initialized with the emitter ID).

#### 2.4.1 Deploy Emitter contract

```bash
stellar contract deploy \
  --wasm contracts/emitter/target/wasm32v1-none/release/ophirpay_emitter.wasm \
  --source <MAINNET_SECRET_KEY> \
  --rpc-url "https://soroban.stellar.org:443" \
  --network-passphrase "Public Global Stellar Network ; September 2015" \
  --network public \
  --fee 10000000

# Save the returned contract ID → NEXT_PUBLIC_EMITTER_CONTRACT_ID
```

#### 2.4.2 Initialize Emitter

```bash
stellar contract invoke \
  --id <EMITTER_CONTRACT_ID> \
  --source <MAINNET_SECRET_KEY> \
  --rpc-url "https://soroban.stellar.org:443" \
  --network-passphrase "Public Global Stellar Network ; September 2015" \
  --network public \
  -- init --owner <OWNER_PUBLIC_KEY>
```

#### 2.4.3 Deploy OphirPay main contract

```bash
stellar contract deploy \
  --wasm contracts/ophirpay/target/wasm32v1-none/release/ophirpay_contract.wasm \
  --source <MAINNET_SECRET_KEY> \
  --rpc-url "https://soroban.stellar.org:443" \
  --network-passphrase "Public Global Stellar Network ; September 2015" \
  --network public \
  --fee 10000000

# Save the returned contract ID → NEXT_PUBLIC_CONTRACT_ID
```

#### 2.4.4 Initialize OphirPay main contract (with emitter)

```bash
stellar contract invoke \
  --id <CONTRACT_ID> \
  --source <MAINNET_SECRET_KEY> \
  --rpc-url "https://soroban.stellar.org:443" \
  --network-passphrase "Public Global Stellar Network ; September 2015" \
  --network public \
  -- init --owner <OWNER_PUBLIC_KEY> --emitter <EMITTER_CONTRACT_ID>
```

### 2.5 Post-deploy verification

```bash
# Verify main contract owner
stellar contract invoke \
  --id <CONTRACT_ID> \
  --source <MAINNET_SECRET_KEY> \
  --rpc-url "https://soroban.stellar.org:443" \
  --network-passphrase "Public Global Stellar Network ; September 2015" \
  --network public \
  --send no \
  -- get_owner

# Verify emitter owner
stellar contract invoke \
  --id <EMITTER_CONTRACT_ID> \
  --source <MAINNET_SECRET_KEY> \
  --rpc-url "https://soroban.stellar.org:443" \
  --network-passphrase "Public Global Stellar Network ; September 2015" \
  --network public \
  --send no \
  -- get_owner

# Verify payment counter is 0 on a fresh deployment
stellar contract invoke \
  --id <CONTRACT_ID> \
  --source <MAINNET_SECRET_KEY> \
  --rpc-url "https://soroban.stellar.org:443" \
  --network-passphrase "Public Global Stellar Network ; September 2015" \
  --network public \
  --send no \
  -- get_payment_count
```

---

## 2.6 Contract Address Registry

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
- **Webhook sustained failure rate > 25% for 10m** → Slack warning. This is
  measured from `ophirpay_delivery_final_outcomes_total{delivery_type="webhook"}`
  and should be investigated alongside
  `ophirpay_delivery_attempts_total{delivery_type="webhook"}` to distinguish
  first-attempt endpoint failures from retry exhaustion.
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
