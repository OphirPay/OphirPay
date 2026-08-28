# 🚀 OphirPay — Mainnet Deployment Runbook

An executable, step-by-step operations runbook for deploying the Soroban smart contracts and Next.js frontend to **Stellar Mainnet** (`PUBLIC`).

---

## 📋 Phase 1: Pre-Flight Checklist

Execute these verifications before initiating the deployment window:

```bash
# 1. Verify Node.js version matches repo spec
node -v # Must match .nvmrc

# 2. Check deployer account mainnet balance (> 100 XLM required for contract initialization)
export DEPLOYER_PUBLIC_KEY="G..."
curl -s "https://horizon.stellar.org/accounts/${DEPLOYER_PUBLIC_KEY}" | jq -r '.balances[] | select(.asset_type=="native") | .balance'

# 3. Confirm Soroban RPC health and ledger sequence
curl -s -X POST https://soroban.stellar.org/ \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"getLatestLedger"}' | jq .result.sequence

# 4. Verify WASM artifact deterministic build hash
stellar contract build --package ophirpay
sha256sum target/wasm32-unknown-unknown/release/ophirpay.wasm
```

- [ ] Deployer account funded with > 100 XLM on Mainnet
- [ ] Database connection pool provisioned & accessible with SSL (`pg_isready`)
- [ ] Production secrets loaded (`AUTH_SECRET`, `DATABASE_URL`, `DIRECT_DATABASE_URL`)
- [ ] Ingress TLS certificates valid (`cert-manager` ready)
- [ ] On-call engineer in incident response channel

---

## ⚡ Phase 2: Execution Steps

### 1. Database Schema Migration
```bash
# Run schema migrations with zero downtime deploy
DATABASE_URL="$PROD_DATABASE_URL" npx prisma migrate deploy
DATABASE_URL="$PROD_DATABASE_URL" npx prisma migrate status
```

### 2. Smart Contract WASM Installation & Initialization
```bash
# Install WASM byte code on Mainnet
WASM_HASH=$(stellar contract install \
  --wasm target/wasm32-unknown-unknown/release/ophirpay.wasm \
  --source-account "$DEPLOYER_SECRET_KEY" \
  --network mainnet)

echo "Installed WASM Hash: $WASM_HASH"

# Instantiate contract instance
CONTRACT_ID=$(stellar contract deploy \
  --wasm-hash "$WASM_HASH" \
  --source-account "$DEPLOYER_SECRET_KEY" \
  --network mainnet)

echo "Mainnet Contract ID: $CONTRACT_ID"

# Initialize contract state (Admin = Multi-sig or Governance Account)
stellar contract invoke \
  --id "$CONTRACT_ID" \
  --source-account "$DEPLOYER_SECRET_KEY" \
  --network mainnet \
  -- initialize \
  --admin "$GOVERNANCE_PUBLIC_KEY"
```

### 3. Application Deployment
```bash
# Set environment variables in Vercel / Kubernetes
export NEXT_PUBLIC_STELLAR_NETWORK=PUBLIC
export NEXT_PUBLIC_CONTRACT_ID="$CONTRACT_ID"
export NEXT_PUBLIC_HORIZON_URL="https://horizon.stellar.org"
export NEXT_PUBLIC_SOROBAN_RPC_URL="https://soroban.stellar.org"

# Build & deploy container / Vercel build
npm run build
```

---

## 🔍 Phase 3: Post-Deployment Verification Commands

Run these automated sanity checks immediately following deployment:

```bash
# 1. Healthcheck probe
curl -f -s https://ophirpay.com/api/health | jq .

# 2. Verify Contract on-chain metadata & Admin binding
stellar contract invoke \
  --id "$NEXT_PUBLIC_CONTRACT_ID" \
  --network mainnet \
  -- get_admin

# 3. Test Challenge token generation endpoint
curl -f -s "https://ophirpay.com/api/auth/challenge?publicKey=${DEPLOYER_PUBLIC_KEY}" | jq .

# 4. Ingress SSL and Security Headers audit
curl -s -I https://ophirpay.com | grep -E "strict-transport-security|x-frame-options|content-security-policy"
```

---

## 🚨 Phase 4: Rollback & Disaster Recovery Procedures

If health checks fail or severe anomalies occur:

### 1. Frontend Traffic Reroute / Maintenance Mode
```bash
# Switch Cloudflare / Ingress to static maintenance page
kubectl apply -f k8s/maintenance-ingress.yaml
```

### 2. Contract Emergency Pause
```bash
# If multi-sig admin is invoked to halt contract operations
stellar contract invoke \
  --id "$NEXT_PUBLIC_CONTRACT_ID" \
  --source-account "$GOVERNANCE_SECRET_KEY" \
  --network mainnet \
  -- emergency_pause
```

### 3. Database Migration Rollback
```bash
# Revert down to previous known stable schema tag if necessary
DATABASE_URL="$PROD_DATABASE_URL" npx prisma migrate resolve --rolled-back "<FAILED_MIGRATION_NAME>"
```
