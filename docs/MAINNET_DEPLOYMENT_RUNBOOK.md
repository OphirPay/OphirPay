# OphirPay — Mainnet Deployment Runbook

> **Executable Operational Checklist & Runbook**  
> This document consolidates all deployment prerequisites, step-by-step installation instructions, environment validation, pre-flight checklists, post-deployment verification commands, rollback procedures, and emergency incident drills for deploying OphirPay to Stellar Mainnet.

---

## Table of Contents

1. [Pre-Flight Verification Checklist](#1-pre-flight-verification-checklist)
2. [Target Architecture & Secret Setup](#2-target-architecture--secret-setup)
3. [Step 1: Database Migration & Schema Deploy](#3-step-1-database-migration--schema-deploy)
4. [Step 2: Soroban Smart Contract Compilation & Deployment](#4-step-2-soroban-smart-contract-compilation--deployment)
5. [Step 3: Application Build & Infrastructure Rollout](#5-step-3-application-build--infrastructure-rollout)
6. [Step 4: Post-Deployment Smoke Tests & Health Verification](#6-step-4-post-deployment-smoke-tests--health-verification)
7. [Step 5: Rollback & Disaster Recovery Procedures](#7-step-5-rollback--disaster-recovery-procedures)
8. [Emergency Contacts & Operational Drills](#8-emergency-contacts--operational-drills)

---

## 1. Pre-Flight Verification Checklist

Before executing any mainnet deployment steps, ensure that all items on this checklist are satisfied and verified by the deployment lead.

| Category | Verification Item | Command / Check | Status |
|---|---|---|---|
| **Stellar Network** | Horizon & Soroban RPC mainnet endpoints reachable | `curl -s -X POST https://soroban.stellar.org -H 'Content-Type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"getHealth"}'` | `[ ]` |
| **Deployer Account** | Deployer account exists on Mainnet and funded with >= 150 XLM | `stellar keys address deployer-mainnet` && check Horizon balance | `[ ]` |
| **WASM Hash** | Reproducible builds verified and matches CI artifact hash | `cargo build --target wasm32-unknown-unknown --release` in `/contracts` | `[ ]` |
| **PostgreSQL** | PostgreSQL 16+ instance running with connection pooling | `pg_isready -h $DB_HOST -p 5432` | `[ ]` |
| **Secrets & Keys** | Sentry DSN, NextAuth secrets, and deployer seed phrases loaded | Checked against vault / KMS | `[ ]` |
| **SSL & DNS** | TLS certificates provisioned and DNS resolves to LB / Ingress IP | `dig +short app.ophirpay.com` | `[ ]` |

---

## 2. Target Architecture & Secret Setup

### 2.1 Production Environment Variables (`.env.production`)

```env
# ── Network & RPC ─────────────────────────
NEXT_PUBLIC_STELLAR_NETWORK=PUBLIC
NEXT_PUBLIC_STELLAR_RPC_URL=https://soroban.stellar.org
NEXT_PUBLIC_STELLAR_HORIZON_URL=https://horizon.stellar.org
NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE="Public Global Stellar Network ; September 2015"

# ── Database ──────────────────────────────
DATABASE_URL="postgresql://ophir_admin:SECRET_PASSWORD@prod-db.ophirpay.internal:5432/ophirpay_prod?sslmode=require&pgbouncer=true"
DATABASE_PROVIDER=postgresql

# ── Contract Addresses ────────────────────
NEXT_PUBLIC_CONTRACT_ID=C...MAINNET_OPHIRPAY_ID
NEXT_PUBLIC_EMITTER_CONTRACT_ID=C...MAINNET_EMITTER_ID

# ── Application & Telemetry ───────────────
NEXT_PUBLIC_APP_URL=https://app.ophirpay.com
NODE_ENV=production
NEXTAUTH_URL=https://app.ophirpay.com
NEXTAUTH_SECRET=LONG_RANDOM_GENERATED_SECRET_KEY_HEX
NEXT_PUBLIC_SENTRY_DSN=https://example@o0.ingest.sentry.io/0
```

---

## 3. Step 1: Database Migration & Schema Deploy

Execute Prisma schema migrations safely on the production PostgreSQL database:

```bash
# 1. Generate Prisma client bindings
npx prisma generate

# 2. Check pending migrations status
DATABASE_URL="$DATABASE_URL" npx prisma migrate status

# 3. Apply migrations to production database
DATABASE_URL="$DATABASE_URL" npx prisma migrate deploy

# 4. Verify database connectivity & core tables
DATABASE_URL="$DATABASE_URL" node -e '
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
async function main() {
  await prisma.$connect();
  const count = await prisma.payment.count();
  console.log("Database connection successful. Existing payments count:", count);
}
main().finally(() => prisma.$disconnect());
'
```

---

## 4. Step 2: Soroban Smart Contract Compilation & Deployment

### 4.1 Build Contracts with Reproducible Target

```bash
cd contracts

# Ensure toolchain is locked to soroban-supported Rust
rustup target add wasm32-unknown-unknown

# Build optimized WASM binaries
cargo build --target wasm32-unknown-unknown --release --package ophirpay
cargo build --target wasm32-unknown-unknown --release --package payment-event-emitter

# Verify wasm files exist
ls -la target/wasm32-unknown-unknown/release/*.wasm
```

### 4.2 Deploy Contracts to Mainnet

```bash
# 1. Install/Upload OphirPay contract WASM to Mainnet
OPHIR_WASM_HASH=$(stellar contract install \
  --wasm target/wasm32-unknown-unknown/release/ophirpay.wasm \
  --source-account deployer-mainnet \
  --network mainnet)
echo "OphirPay WASM Hash: $OPHIR_WASM_HASH"

# 2. Deploy OphirPay contract instance
OPHIR_CONTRACT_ID=$(stellar contract deploy \
  --wasm-hash $OPHIR_WASM_HASH \
  --source-account deployer-mainnet \
  --network mainnet)
echo "OphirPay Contract ID: $OPHIR_CONTRACT_ID"

# 3. Install & Deploy PaymentEventEmitter WASM
EMITTER_WASM_HASH=$(stellar contract install \
  --wasm target/wasm32-unknown-unknown/release/payment_event_emitter.wasm \
  --source-account deployer-mainnet \
  --network mainnet)

EMITTER_CONTRACT_ID=$(stellar contract deploy \
  --wasm-hash $EMITTER_WASM_HASH \
  --source-account deployer-mainnet \
  --network mainnet)
echo "Payment Event Emitter Contract ID: $EMITTER_CONTRACT_ID"
```

### 4.3 Initialize & Link Smart Contracts

```bash
# Initialize OphirPay contract with Admin/Owner address
stellar contract invoke \
  --id $OPHIR_CONTRACT_ID \
  --source-account deployer-mainnet \
  --network mainnet \
  -- \
  init \
  --owner $(stellar keys address deployer-mainnet)

# Initialize PaymentEventEmitter contract
stellar contract invoke \
  --id $EMITTER_CONTRACT_ID \
  --source-account deployer-mainnet \
  --network mainnet \
  -- \
  init \
  --owner $(stellar keys address deployer-mainnet)

# Link Emitter contract inside OphirPay
stellar contract invoke \
  --id $OPHIR_CONTRACT_ID \
  --source-account deployer-mainnet \
  --network mainnet \
  -- \
  set_emitter \
  --caller $(stellar keys address deployer-mainnet) \
  --emitter $EMITTER_CONTRACT_ID

# Whitelist OphirPay in Emitter
stellar contract invoke \
  --id $EMITTER_CONTRACT_ID \
  --source-account deployer-mainnet \
  --network mainnet \
  -- \
  set_allowed_source \
  --caller $(stellar keys address deployer-mainnet) \
  --source $OPHIR_CONTRACT_ID
```

---

## 5. Step 3: Application Build & Infrastructure Rollout

### Option A: Kubernetes (Helm) Rollout

```bash
# Update Helm chart values with deployed contract IDs
helm upgrade --install ophirpay-prod ./helm/ophirpay \
  --namespace ophirpay-prod \
  --create-namespace \
  --set env.NEXT_PUBLIC_CONTRACT_ID=$OPHIR_CONTRACT_ID \
  --set env.NEXT_PUBLIC_EMITTER_CONTRACT_ID=$EMITTER_CONTRACT_ID \
  --values ./helm/ophirpay/values-production.yaml

# Monitor rollout status
kubectl rollout status deployment/ophirpay -n ophirpay-prod --timeout=300s
```

### Option B: Docker Container Deployment

```bash
# Build production Docker image
docker build -t ophirpay:v1.0.0 .

# Run container with production env
docker run -d \
  --name ophirpay-prod \
  -p 3000:3000 \
  --env-file .env.production \
  --restart always \
  ophirpay:v1.0.0
```

---

## 6. Step 4: Post-Deployment Smoke Tests & Health Verification

Run these verification commands immediately after rollout:

```bash
# 1. Check HTTP Health Endpoint
curl -i -f https://app.ophirpay.com/api/health
# Expected: 200 OK {"status":"ok","network":"PUBLIC","uptime":...}

# 2. Check Metrics Endpoint
curl -s https://app.ophirpay.com/api/metrics | grep -E "ophirpay_http_requests_total|ophirpay_payments_count"

# 3. Verify On-Chain Version & Stats
stellar contract invoke \
  --id $OPHIR_CONTRACT_ID \
  --network mainnet \
  -- \
  get_version
# Expected: 2

stellar contract invoke \
  --id $OPHIR_CONTRACT_ID \
  --network mainnet \
  -- \
  get_stats

# 4. Check Frontend Static & Client Bundle Status
curl -I https://app.ophirpay.com/
# Expected: HTTP/2 200
```

---

## 7. Step 5: Rollback & Disaster Recovery Procedures

### 7.1 Web App Rollback

#### Kubernetes
```bash
# Rollback to the previous deployment revision
kubectl rollout undo deployment/ophirpay -n ophirpay-prod
kubectl rollout status deployment/ophirpay -n ophirpay-prod
```

#### Docker
```bash
# Stop faulty container and revert to previous image tag
docker stop ophirpay-prod && docker rm ophirpay-prod
docker run -d --name ophirpay-prod -p 3000:3000 --env-file .env.production ophirpay:v0.9.9
```

### 7.2 Emergency Contract Pause

In the event of a suspected vulnerability or anomalous transactions:

```bash
stellar contract invoke \
  --id $OPHIR_CONTRACT_ID \
  --source-account deployer-mainnet \
  --network mainnet \
  -- \
  emergency_pause_all \
  --caller $(stellar keys address deployer-mainnet)
```

Verify paused state:
```bash
stellar contract invoke --id $OPHIR_CONTRACT_ID --network mainnet -- is_paused
# Expected: true
```

---

## 8. Emergency Contacts & Operational Drills

- **Lead Engineer / On-Call**: Telegram: `@ophirpay_ops`
- **Security Team**: `security@ophirpay.com`
- **Stellar Horizon / RPC Status**: [https://status.stellar.org/](https://status.stellar.org/)
