# Troubleshooting Guide

Common setup and network errors encountered while developing or using OphirPay, with step-by-step fixes.

## Wallet & Authentication

### Freighter wallet won't connect

**Symptom**: "Connect Wallet" button shows spinner indefinitely, or Freighter popup doesn't appear.

**Cause**: Freighter extension not installed, wrong network, or permissions denied.

**Fix**:
1. Install [Freighter](https://freighter.app) from the Chrome Web Store
2. Open Freighter → Settings → switch to **Testnet** (for dev) or **Public** (for mainnet)
3. Refresh the OphirPay page
4. If issue persists: Chrome → Extensions → Freighter → toggle off/on

### Wallet rejects transaction

**Symptom**: After signing, Freighter shows "Transaction Failed" or "User declined".

**Cause**: Insufficient balance, wrong network in wallet, or corrupted nonce.

**Fix**:
1. Check your XLM balance: `curl https://horizon-testnet.stellar.org/accounts/<YOUR_PUBLIC_KEY>`
2. If balance < 2 XLM (minimum reserve): fund via Friendbot
3. Switch Freighter to correct network matching the app
4. Reset Freighter: Settings → Advanced → Reset account data

---

## Friendbot & Testnet Funding

### Friendbot returns "Account already exists"

**Symptom**: `curl -X POST "https://friendbot.stellar.org?addr=G..."` returns error.

**Cause**: The account is already funded. Friendbot funds each account exactly once.

**Fix**: Create a new Freighter wallet for testing, or use an unfunded account.

### RPC timeout during funding

**Symptom**: Friendbot request hangs or times out.

**Cause**: Testnet RPC overload or network connectivity issue.

**Fix**:
1. Check testnet status: `curl https://horizon-testnet.stellar.org/`
2. Retry after 30 seconds
3. Use an alternative RPC endpoint if available

---

## Trustlines & Assets

### Cannot receive USDC / token payment

**Symptom**: Payment fails with "op_no_trust" or "Destination requires trustline".

**Cause**: The receiving account hasn't established a trustline for the asset.

**Fix**:
1. Open Stellar Laboratory → Build Transaction → Change Trust
2. Set asset: `USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN`
3. Set limit (e.g., 1,000,000)
4. Sign and submit

### Trustline limit exceeded

**Symptom**: Payment fails even though trustline exists.

**Cause**: The payment amount exceeds the trustline limit.

**Fix**:
1. Increase the trustline limit via Change Trust operation
2. Or split the payment into smaller amounts

---

## Network & RPC

### "RPC connection failed" in gateway logs

**Symptom**: Gateway cannot connect to Soroban RPC.

**Cause**: `SOROBAN_RPC_URL` misconfigured or RPC service down.

**Fix**:
1. Verify env: `echo $SOROBAN_RPC_URL`
2. Test connectivity: `curl $SOROBAN_RPC_URL/health`
3. For testnet: use `https://soroban-testnet.stellar.org`
4. For mainnet: use `https://soroban.stellar.org`
5. Check [Stellar Status](https://status.stellar.org/) for outages

### Database connection refused

**Symptom**: App fails to start with "connection refused" or "could not connect to server".

**Cause**: PostgreSQL not running or DATABASE_URL incorrect.

**Fix**:
1. Verify PostgreSQL is running: `pg_isready`
2. Check connection string format: `postgresql://user:password@host:port/database`
3. For Docker: `docker-compose up -d db`
4. For local: `brew services start postgresql@16`

---

## Prisma & Migrations

### `prisma migrate dev` fails

**Symptom**: `npx prisma migrate dev` errors with drift or constraint violation.

**Cause**: Schema changes not reflected in migrations, or existing data conflicts.

**Fix**:
1. Reset dev database: `npx prisma migrate reset` (WARNING: deletes all data)
2. Re-apply migrations: `npx prisma migrate dev`
3. Check migration history: `npx prisma migrate status`

### Schema/client mismatch

**Symptom**: TypeScript errors about missing Prisma fields.

**Cause**: `prisma generate` not run after schema changes.

**Fix**: `npx prisma generate`

---

## Contract & Soroban

### Contract deploy fails

**Symptom**: `stellar contract deploy` fails with error.

**Cause**: Deployer account unfunded, WASM not built, or wrong network.

**Fix**:
1. Verify WASM exists: `ls contracts/ophirpay/target/wasm32v1-none/release/`
2. Fund deployer: `curl -X POST "https://friendbot.stellar.org?addr=<DEPLOYER_PUBKEY>"`
3. Build WASM: `cargo build --release -p ophirpay-contract --target wasm32v1-none`

### invoke fails with "HostError"

**Symptom**: `stellar contract invoke` returns HostError.

**Cause**: Contract not initialized, wrong args, or insufficient XLM for fees.

**Fix**:
1. Check if initialized: `stellar contract invoke --id <CONTRACT_ID> --source-account <KEY> --network testnet -- get_owner` — if it errors, run `init`
2. Initialize: `stellar contract invoke --id <CONTRACT_ID> --source-account <KEY> --network testnet -- init --owner <ADDR>`
3. Verify args match the function signature
4. Ensure caller has >10 XLM for transaction fees

---

## CI & Build

### CI fails on lint

**Symptom**: `npx eslint . --max-warnings 20` fails in CI.

**Cause**: Code style violations.

**Fix**:
1. Run locally: `npx eslint . --fix`
2. Check output for specific rule violations
3. Address each warning/error

### TypeScript errors in CI

**Symptom**: `npx tsc --noEmit` fails with type errors.

**Cause**: Type mismatches or missing type imports.

**Fix**:
1. Run locally: `npx tsc --noEmit`
2. Fix each error starting from the top (cascade fixes many at once)
3. Regenerate types: `npx prisma generate`

---

## See Also

- [Dev Environment Guide](./DEPLOYMENT.md)
- [Mainnet Deployment](./deployment-mainnet.md)
- [Security Policy](../SECURITY.md)
- [API Cookbook](./API_COOKBOOK.md)
