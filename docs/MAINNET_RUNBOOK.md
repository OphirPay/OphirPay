# 🚀 OphirPay Mainnet Deployment Runbook

> **Executable checklist** for deploying OphirPay (two Soroban contracts + the
> web app) to **Stellar Mainnet**. This runbook consolidates
> [docs/deployment-mainnet.md](./deployment-mainnet.md) into a step-by-step
> runbook with **pre-flight checks, rollback steps, and post-deploy
> verification**. Read the companion guide for background detail; execute this
> runbook line-by-line.

> ⚠️ **Mainnet is real money.** There is **no friendbot** on mainnet, deployments
> are irreversible, and every submission costs real XLM. A botched deployment
> can be rolled back — but only within the 24-hour upgrade timelock window, and
> only if the runbook's rollback steps are executed in order. **Never skip
> Phase 0.**

---

## Before you start

| Tool | Version | Check |
|---|---|---|
| `stellar` CLI | latest | `stellar --version` |
| Rust | 1.85+ with `wasm32v1-none` target | `rustup target list --installed \| grep wasm32v1-none` |
| `jq` | 1.6+ | `jq --version` |
| `kubectl` + `helm` | 3+ | `kubectl version --client`, `helm version` |
| Deployer wallet | Freighter (hardware wallet recommended) | Secret key available to the operator **only** |

> 🔐 The **deployer secret key** (`<MAINNET_SECRET_KEY>`) should be held by the
> on-call operator, never committed, and ideally stored in a secrets manager
> (the CI secret-scan job enforces this repo-wide). The **owner public key**
> (`<OWNER_PUBLIC_KEY>`) is embedded in the contracts at init time — record it
> alongside the contract IDs in [Phase 4](#phase-4--record-addresses-and-hashes).

---

## Phase 0 — Pre-flight checklist

> Complete **every** item before executing any mainnet transaction. Each item
> has a command that must return the listed expected output.

### 0.1 Funding

- [ ] **Deployer account balance > 100 XLM** (covers upload + deploy + init + verification fees):

  ```bash
  curl -s "https://horizon.stellar.org/accounts/<MAINNET_PUBLIC_KEY>" \
    | jq '.balances[] | select(.asset_type=="native") | .balance'
  # Expected: a number > 100 (e.g. "1500.0000000")
  ```

  - **No friendbot on mainnet.** Fund from an exchange or a funded wallet by
    sending XLM to `<MAINNET_PUBLIC_KEY>`.
  - Recommended minimum: **100 XLM**; budget 10–20 XLM per contract deploy+init
    round plus headroom for the timelocked upgrade path.

- [ ] **Owner account funded** (same source) — it will later sign
  `init`, `set_emitter`, and any `propose_upgrade` transactions.

- [ ] **Fee budget confirmed** — mainnet `--fee` is set explicitly
  (`--fee 10000000` = 10 XLM max) so an unexpected surge cannot stall the
  submission mid-sequence.

### 0.2 Build & record WASM hashes

- [ ] Build both contracts from a **tagged release commit** (never from a
  dirty working tree):

  ```bash
  git checkout v1.0.0        # or the release commit SHA you intend to ship
  cd contracts/ophirpay && cargo build --target wasm32v1-none --release
  cd ../emitter && cargo build --target wasm32v1-none --release
  ```

- [ ] **Compute and record the SHA-256 of both artifacts** (you will compare
  these against the on-chain state in Phase 3, and reuse them for
  `propose_upgrade` on future releases):

  ```bash
  sha256sum contracts/ophirpay/target/wasm32v1-none/release/ophirpay_contract.wasm
  sha256sum contracts/emitter/target/wasm32v1-none/release/ophirpay_emitter.wasm
  # → record both hashes in the registry (Phase 4)
  ```

- [ ] **WASM size ≤ 128 KB** (Soroban protocol limit — enforced in CI by the
  `contract-wasm` job, re-verify locally):

  ```bash
  stat -c '%n %s bytes' contracts/ophirpay/target/wasm32v1-none/release/ophirpay_contract.wasm \
    contracts/emitter/target/wasm32v1-none/release/ophirpay_emitter.wasm
  ```

### 0.3 Contract IDs

- [ ] **Prepare the registry** (Phase 4) with placeholder rows for
  `NEXT_PUBLIC_CONTRACT_ID` and `NEXT_PUBLIC_EMITTER_CONTRACT_ID`. Actual IDs
  are returned by `stellar contract deploy` in Phase 2 — record them there.

- [ ] If this is an **upgrade of an existing deployment**: confirm you have the
  existing main/emitter IDs and their current owner keys before starting.

### 0.4 Network configuration

- [ ] **Mainnet endpoints and passphrase** verified (a testnet value here is the
  most common mainnet foot-gun):

  ```bash
  bash scripts/validate-deploy-config.sh
  # Expected: exits 0 and confirms PUBLIC mode, mainnet RPC/Horizon,
  #           friendbot disabled
  ```

- [ ] **Dry-run** completes (see Phase 1) and **fails cleanly**, proving the
  script targets mainnet and would not submit anything.

### 0.5 Infrastructure

- [ ] PostgreSQL 16 provisioned and reachable (`psql` test or
  `DATABASE_URL=... npx prisma migrate deploy` on a scratch copy).
- [ ] Kubernetes cluster + ingress-nginx + cert-manager ready (if deploying via
  Helm).
- [ ] Domain DNS record pointed at the cluster ingress IP.
- [ ] Monitoring (Prometheus + Grafana) and alerting (PagerDuty/Slack) reachable
  — see [docs/metrics-endpoints.md](./metrics-endpoints.md).
- [ ] Nightly DB backup job enabled (`.github/workflows/db-backup.yml`) so the
  rollback path in Phase 5 has a restore point.

---

## Phase 1 — Build & dry-run validation

- [ ] Build both contracts (repeat of 0.2 if not already done).
- [ ] **Dry-run the deploy workflow** — must **fail** before submitting anything:

  ```bash
  NETWORK_MODE=PUBLIC DRY_RUN=true \
    ./scripts/deploy-workflow.sh <MAINNET_SECRET_KEY> <OWNER_PUBLIC_KEY> <EMITTER_CONTRACT_ID>
  # Expected: script announces PUBLIC mode, friendbot disabled, and exits
  #           non-zero with a clear dry-run message — no transaction submitted.
  ```

- [ ] Sanity-check the release app build once:

  ```bash
  npm ci
  npx prisma generate
  npm run build
  ```

---

## Phase 2 — Deploy contracts

> **Order matters: deploy the emitter first**, then the main contract (the main
> contract is initialized with the emitter ID). All commands use the mainnet
> RPC (`https://soroban.stellar.org:443`) and the mainnet passphrase
> (`Public Global Stellar Network ; September 2015`).

### 2.1 Deploy emitter

- [ ] **Deploy `PaymentEventEmitter`**:

  ```bash
  stellar contract deploy \
    --wasm contracts/emitter/target/wasm32v1-none/release/ophirpay_emitter.wasm \
    --source <MAINNET_SECRET_KEY> \
    --rpc-url "https://soroban.stellar.org:443" \
    --network-passphrase "Public Global Stellar Network ; September 2015" \
    --network public \
    --fee 10000000
  # → copy the returned contract ID into the registry as <EMITTER_CONTRACT_ID>
  ```

- [ ] **Initialize the emitter** (owner-only):

  ```bash
  stellar contract invoke \
    --id <EMITTER_CONTRACT_ID> \
    --source <MAINNET_SECRET_KEY> \
    --rpc-url "https://soroban.stellar.org:443" \
    --network-passphrase "Public Global Stellar Network ; September 2015" \
    --network public \
    -- init --owner <OWNER_PUBLIC_KEY>
  ```

### 2.2 Deploy main contract

- [ ] **Deploy `OphirPayContract`**:

  ```bash
  stellar contract deploy \
    --wasm contracts/ophirpay/target/wasm32v1-none/release/ophirpay_contract.wasm \
    --source <MAINNET_SECRET_KEY> \
    --rpc-url "https://soroban.stellar.org:443" \
    --network-passphrase "Public Global Stellar Network ; September 2015" \
    --network public \
    --fee 10000000
  # → copy the returned contract ID into the registry as <CONTRACT_ID>
  ```

- [ ] **Initialize the main contract** (owner + emitter wiring):

  ```bash
  stellar contract invoke \
    --id <CONTRACT_ID> \
    --source <MAINNET_SECRET_KEY> \
    --rpc-url "https://soroban.stellar.org:443" \
    --network-passphrase "Public Global Stellar Network ; September 2015" \
    --network public \
    -- init --owner <OWNER_PUBLIC_KEY> --emitter <EMITTER_CONTRACT_ID>
  ```

- [ ] **Record the deployer's remaining balance** — used later to confirm fee
  accounting:

  ```bash
  curl -s "https://horizon.stellar.org/accounts/<MAINNET_PUBLIC_KEY>" \
    | jq '.balances[] | select(.asset_type=="native") | .balance'
  ```

---

## Phase 3 — Post-deploy verification (contracts)

> Run these **before** touching the app. Each must return the listed value.

- [ ] Main contract owner matches `<OWNER_PUBLIC_KEY>`:

  ```bash
  stellar contract invoke \
    --id <CONTRACT_ID> \
    --source <MAINNET_SECRET_KEY> \
    --rpc-url "https://soroban.stellar.org:443" \
    --network-passphrase "Public Global Stellar Network ; September 2015" \
    --network public \
    --send no \
    -- get_owner
  ```

- [ ] Emitter owner matches `<OWNER_PUBLIC_KEY>`:

  ```bash
  stellar contract invoke \
    --id <EMITTER_CONTRACT_ID> \
    --source <MAINNET_SECRET_KEY> \
    --rpc-url "https://soroban.stellar.org:443" \
    --network-passphrase "Public Global Stellar Network ; September 2015" \
    --network public \
    --send no \
    -- get_owner
  ```

- [ ] **Payment counter is 0** on a fresh deployment (or matches the prior
  deployment's count on an upgrade):

  ```bash
  stellar contract invoke \
    --id <CONTRACT_ID> \
    --source <MAINNET_SECRET_KEY> \
    --rpc-url "https://soroban.stellar.org:443" \
    --network-passphrase "Public Global Stellar Network ; September 2015" \
    --network public \
    --send no \
    -- get_payment_count
  # Expected: 0 on a fresh deployment
  ```

- [ ] **Emitter event count is 0** (fresh deployment):

  ```bash
  stellar contract invoke \
    --id <EMITTER_CONTRACT_ID> \
    --source <MAINNET_SECRET_KEY> \
    --rpc-url "https://soroban.stellar.org:443" \
    --network-passphrase "Public Global Stellar Network ; September 2015" \
    --network public \
    --send no \
    -- get_event_count
  # Expected: 0 on a fresh deployment
  ```

- [ ] **Version endpoint reports the deployed contract** (app-level check after
  env config — `GET /api/contracts` returns `get_version`/`get_owner`).

---

## Phase 4 — Record addresses and hashes

- [ ] **Fill the registry** (keep it in a private, backed-up location — this is
  the source of truth for rollback and future upgrades):

  | Artifact | Value |
  |---|---|
  | Deploy commit / tag | `v1.0.0` (or SHA) |
  | Mainnet `OphirPayContract` ID | `<CONTRACT_ID>` |
  | Mainnet `PaymentEventEmitter` ID | `<EMITTER_CONTRACT_ID>` |
  | Owner public key | `<OWNER_PUBLIC_KEY>` |
  | `ophirpay_contract.wasm` SHA-256 | `<from Phase 0.2>` |
  | `ophirpay_emitter.wasm` SHA-256 | `<from Phase 0.2>` |
  | Deploy date | `<date>` |
  | Operator | `<name>` |

- [ ] Update `.env.production` with the real IDs (see [Phase 6](#phase-6--deploy-the-app)).

- [ ] Update this table in [docs/deployment-mainnet.md](./deployment-mainnet.md)
  (§ 2.6 Contract Address Registry) so future operators can find the IDs.

---

## Phase 5 — Rollback procedures

> Trigger these **only** if a deployment is broken. Each path has a time
> constraint — read it before acting.

### 5.1 App rollback (helm/k8s)

- [ ] Roll back the Helm release to the previous revision:

  ```bash
  helm rollback ophirpay -n ophirpay
  # or pin an explicit previous image:
  helm upgrade ophirpay ./helm/ophirpay \
    --namespace ophirpay \
    --set image.tag=v0.9.0
  ```

- [ ] Restore the previous environment block (contract IDs, network config) in
  the secret/ConfigMap before rolling back — the app must point at the **old**
  contract IDs, not the new ones.

- [ ] Verify with the [Phase 7](#phase-7--post-deploy-verification-app) health
  checks.

### 5.2 Contract rollback — upgrade window (24h)

> `propose_upgrade` starts a **24-hour timelock**. Within that window the owner
> can cancel; after it expires anyone can execute. **This is the only
> time-bounded rollback for contracts.**

- [ ] **Upgrade proposed but not executed** → cancel it (owner only):

  ```bash
  stellar contract invoke \
    --id <CONTRACT_ID> \
    --source <OWNER_KEY> \
    --network public \
    -- cancel_upgrade
  # Same for the emitter: --id <EMITTER_CONTRACT_ID>
  ```

- [ ] **Upgrade already executed** → there is no on-chain "undo". Roll back by
  deploying the previous artifact and pointing the app at the new (old-code)
  contract IDs:

  1. Deploy the previous release WASM (Phase 2 flow) → new `<CONTRACT_ID>`.
  2. Re-init with the original owner and emitter.
  3. Update `.env.production` + helm secrets with the new IDs.
  4. Re-run Phase 3 verification.
  5. Optionally `propose_upgrade` the new contract back to the intended code —
     this time watching the 24h window.

### 5.3 Database rollback

- [ ] Restore the nightly backup (`.github/workflows/db-backup.yml` retains 30
  days):

  ```bash
  DB_HOST=... DB_USER=... DB_PASSWORD=... \
  AWS_ACCESS_KEY_ID=... AWS_SECRET_ACCESS_KEY=... \
  ./scripts/restore-drill.sh
  ```

- [ ] After restore, re-run the app health checks and confirm
  `GET /api/health` reports `database: connected`.

---

## Phase 6 — Deploy the app

- [ ] Provision PostgreSQL and run migrations:

  ```bash
  DATABASE_URL="postgresql://..." npx prisma migrate deploy
  ```

- [ ] Configure `.env.production` with the **recorded** contract IDs and
  mainnet network values:

  ```env
  NEXT_PUBLIC_STELLAR_NETWORK=PUBLIC
  NEXT_PUBLIC_HORIZON_URL=https://horizon.stellar.org
  NEXT_PUBLIC_SOROBAN_RPC_URL=https://soroban.stellar.org
  STELLAR_NETWORK_PASSPHRASE=Public Global Stellar Network ; September 2015
  NEXT_PUBLIC_CONTRACT_ID=<CONTRACT_ID from Phase 4>
  NEXT_PUBLIC_EMITTER_CONTRACT_ID=<EMITTER_CONTRACT_ID from Phase 4>
  NEXT_PUBLIC_APP_URL=https://ophirpay.com
  AUTH_SECRET=$(openssl rand -hex 32)
  NODE_ENV=production
  ```

- [ ] Deploy via Helm:

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

---

## Phase 7 — Post-deploy verification (app)

- [ ] Health check reports a healthy database:

  ```bash
  curl -s https://ophirpay.com/api/health | jq .
  # Expected: HTTP 200 and database: "connected"
  ```

- [ ] Dashboard loads: `curl -s -o /dev/null -w "%{http_code}" https://ophirpay.com/` → `200`.

- [ ] **Contract endpoints answer**: `curl -s https://ophirpay.com/api/contracts | jq .` returns the deployed version and owner.

- [ ] **SSE stream connects**: `curl -N https://ophirpay.com/api/events` emits a
  `connected` event then `heartbeat` frames every 15s (see
  [docs/SSE.md](./SSE.md)).

- [ ] **Manual smoke test**:
  - [ ] Dashboard loads without console errors
  - [ ] Freighter connects and the balance displays
  - [ ] Send a small test payment (0.01 XLM) — transaction succeeds
  - [ ] Payment appears on the Payments page
  - [ ] On-chain record exists: `get_payment(1)` returns data
  - [ ] Live feed shows a `payment:created` event
- [ ] **E2E against production**:

  ```bash
  E2E_BASE_URL=https://ophirpay.com npx playwright test
  ```

---

## Sign-off

- [ ] All Phase 0 checkboxes checked before any submission
- [ ] Phase 3 contract verification all green
- [ ] Phase 4 registry filled and backed up
- [ ] Phase 7 app verification all green
- [ ] Monitoring shows healthy metrics (`/api/metrics`)
- [ ] Emergency contact recorded (on-call engineer, status.stellar.org)

> **Done — OphirPay is live on mainnet.** Keep the Phase 4 registry safe: it is
> the anchor for every future upgrade and rollback.

---

## Related docs

- [docs/deployment-mainnet.md](./deployment-mainnet.md) — background detail & infrastructure setup
- [docs/DEPLOYMENT.md](./DEPLOYMENT.md) — multi-platform deployment guide (Vercel/Docker/Node)
- [docs/TROUBLESHOOTING.md](./TROUBLESHOOTING.md) — symptom → cause → fix for common errors
- [docs/metrics-endpoints.md](./metrics-endpoints.md) — monitoring endpoints
- [docs/SSE.md](./SSE.md) — real-time event stream contract
