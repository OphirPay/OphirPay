<div align="center">
  <img src="https://raw.githubusercontent.com/OphirPay/OphirPay/main/public/ophirpay-banner.svg" alt="OphirPay Banner" width="100%" />

  <h1>🏦 OphirPay</h1>

  <h3><em>The Open-Source Payment Orchestration Layer for Stellar</em></h3>

  <p>
    Send, batch, schedule, and track blockchain payments — all from one powerful dashboard.
    Built natively on <strong>Stellar</strong> & <strong>Soroban</strong> for individuals, startups,
    nonprofits, and DAOs who demand speed, transparency, and low fees.
  </p>

  <br />

  <p>
    <a href="https://github.com/OphirPay/OphirPay/actions/workflows/ci.yml">
      <img src="https://img.shields.io/github/actions/workflow/status/OphirPay/OphirPay/ci.yml?label=CI%20(22%20jobs)&logo=githubactions&logoColor=white" alt="CI — 22 jobs" />
    </a>
    <a href="#-testing--quality">
      <img src="https://img.shields.io/badge/tests-970%20passed%20(806%20app%20%2B%2067%20contracts%20%2B%2097%20e2e)-brightgreen.svg" alt="970 Tests Passing" />
    </a>
    <a href="#-testing--quality">
      <img src="https://img.shields.io/badge/coverage-87.6%25%20overall-brightgreen.svg?logo=vitest" alt="87.6% Overall Coverage" />
    </a>
    <a href="docs/AUDIT.md">
      <img src="https://img.shields.io/badge/audit-manual%20review%2C%202H%2F6M%20fixed-orange.svg" alt="Manual review — 2 High / 6 Medium fixed in code, 3rd-party audit pending" />
    </a>
    <a href="e2e/">
      <img src="https://img.shields.io/badge/e2e-Playwright%2097%20cases-blue.svg?logo=playwright" alt="97 E2E Tests" />
    </a>
    <a href="docs/GAS.md">
      <img src="https://img.shields.io/badge/gas-optimized-brightgreen.svg?logo=stellar" alt="Gas Optimized" />
    </a>
    <a href="https://ophirpay.vercel.app">
      <img src="https://img.shields.io/badge/vercel-live-black.svg?logo=vercel" alt="Live on Vercel" />
    </a>
    <a href="https://www.loom.com/share/0d59c50285c04224a4857720b3640018">
      <img src="https://img.shields.io/badge/pitch%20video-3%20min-8A2BE2.svg?logo=video" alt="3-Minute Pitch Video (Loom)" />
    </a>
    <a href="https://stellar.expert/explorer/testnet/contract/CCQGGUJRRVXMHNEX2RYPODGJE2YRMYY4Y7A3KTJH3QP2LWZLTCOPRPET">
      <img src="https://img.shields.io/badge/contract-stellar%20testnet-7B68EE.svg" alt="Contract on Testnet" />
    </a>
    <a href="LICENSE">
      <img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="MIT License" />
    </a>
    <a href="https://github.com/OphirPay/OphirPay/releases">
      <img src="https://img.shields.io/badge/version-v0.1.0-blue.svg" alt="v0.1.0" />
    </a>
  </p>
</div>

---

## 📑 Table of Contents

- [✨ Why OphirPay?](#-why-ophirpay)
- [🚀 Live Demo](#-live-demo)
- [🧭 System Architecture](#-system-architecture)
- [⚡ Quick Start](#-quick-start)
- [🔐 Wallet Integration](#-wallet-integration)
- [📡 Real-Time Events](#-real-time-events)
- [🧪 Smart Contracts](#-smart-contracts)
- [🌟 New to Stellar?](docs/STELLAR_101.md)
- [📊 Testing & Quality](#-testing--quality)
- [🔄 CI/CD Pipeline](#-cicd-pipeline)
- [📸 Screenshots](#-screenshots)
- [🛠 Tech Stack](#-tech-stack)
- [📊 Database Schema](docs/SCHEMA.md)
- [🚀 Deployment Guide](docs/DEPLOYMENT.md)
- [🤝 Contributing](#-contributing)
- [🗺 Roadmap](#-roadmap)
- [🔬 Formal Verification](#-formal-verification)
- [🛡️ Security Audit](#️-security-audit)
- [🔒 Security](#-security)
- [⚡ Performance & Gas](#-performance--gas)
- [🌐 Community](#-community)
- [📄 License & Credits](#-license--credits)

---

## ✨ Why OphirPay?

Most blockchain payment tools are either developer-facing SDKs or complex enterprise dashboards. **OphirPay bridges the gap** — a production-grade, open-source payment platform that's powerful enough for DAO treasuries yet intuitive enough for a freelancer sending their first crypto payment.

| Capability | OphirPay | Typical dApp |
|---|---|---|
| Single payments | ✅ | ✅ |
| **Batch payments** (multi-recipient in 1 tx) | ✅ | ❌ |
| **Recurring payment schedules** | ✅ | ❌ |
| **Payment requests** (invoice-style, QR codes) | ✅ | ❌ |
| **Real-time event streaming** (SSE) | ✅ | ❌ |
| **Webhook delivery** (HMAC signed, retries) | ✅ | ❌ |
| **Cross-contract communication** | ✅ | ❌ |
| **Multi-wallet support** (6 wallets: Freighter, xBull, Rabet, Albedo, Lobstr, Ledger) | ✅ | ❌ |
| **Multi-asset support** (USDC, custom tokens) | ✅ | ❌ |
| **PWA with offline support** | ✅ | ❌ |
| **Classified error handling** (3 types, 300 contract variants) | ✅ | ❌ |
| **Production error boundaries** | ✅ | ❌ |
| **PostgreSQL + SQLite** (provider switching) | ✅ | ⚠️ |
| **Multisig approvals** (N-of-M signers) | ✅ | ❌ |
| **Spending limits + escalation tiers** | ✅ | ❌ |
| **RBAC** (Admin/Operator/Auditor roles) | ✅ | ❌ |
| **On-chain audit log** (immutable trail) | ✅ | ❌ |
| **Fee configuration** (per-operation bps) | ✅ | ❌ |
| **Timelocked admin actions** (24h delay) | ✅ | ❌ |
| **DAO governance** (propose→vote→execute) | ✅ | ❌ |
| **Structured refund system** (6 reason codes, analytics) | ✅ | ❌ |
| **On-chain notification hooks** (subscriber-indexed) | ✅ | ❌ |
| **Cross-contract orchestration** (atomic pause_all) | ✅ | ❌ |
| **Policy versioning** (immutable config history) | ✅ | ❌ |
| **Two-step admin rotation** (24h timelock) | ✅ | ❌ |

> All features above have dashboard UI pages. See [roadmap](#-roadmap) for details.

| **Full CI/CD + 970 tests (806 app + 67 contracts + 97 e2e)** | ✅ | ⚠️ |

---

## 🚀 Live Demo

<div align="center">

### 🔗 **[ophirpay.vercel.app](https://ophirpay.vercel.app)**

*Deployed on Vercel — automatic builds from `main` on every push. PostgreSQL (Neon), Soroban testnet contracts, and a live wallet flow are all wired in.*

### 🎥 Pitch Video (3 min)

<video src="https://raw.githubusercontent.com/OphirPay/OphirPay/main/public/demo.mp4" controls width="720" poster="https://raw.githubusercontent.com/OphirPay/OphirPay/main/public/ophirpay-banner.svg" style="max-width:100%;border-radius:12px;box-shadow:0 4px 24px rgba(0,0,0,0.15)">
  Your browser does not support embedded video.
  <a href="https://ophirpay.vercel.app/demo.mp4">Watch on Vercel →</a>
</video>

*11 scenes: Problem → Live Dashboard → Vercel Deployment → Soroban Contracts → Send Payment → Real-Time Events → GitHub README → CI Pipeline → Multisig Security → Open Source → Outro*

**▶️ Watch on [Loom](https://www.loom.com/share/0d59c50285c04224a4857720b3640018)** · [Watch on Vercel](https://ophirpay.vercel.app/demo.mp4)

</div>

---

## 🧭 System Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     OPHIRPAY PLATFORM                       │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌──────────┐   ┌──────────┐   ┌──────────┐   ┌─────────┐ │
│  │ Treasury │   │  Send    │   │ Batches  │   │Contracts│ │
│  │ Dashboard│   │ Payment  │   │  (multi) │   │  Page   │ │
│  └────┬─────┘   └────┬─────┘   └────┬─────┘   └────┬────┘ │
│       │              │              │              │       │
│  ┌────┴──────────────┴──────────────┴──────────────┴────┐  │
│  │              useWallet() / WalletProvider             │  │
│  │          Session persistence · Balance · Auth         │  │
│  └────────────────────────┬─────────────────────────────┘  │
│                           │                                │
│  ┌────────────────────────┼─────────────────────────────┐  │
│  │                  Stellar SDK Layer                     │  │
│  │  ┌──────────┐  ┌──────────┐  ┌────────────────────┐  │  │
│  │  │ Horizon  │  │ Soroban  │  │  TX Builder/Signer │  │  │
│  │  │ (balance)│  │   RPC    │  │  (buildInvokeTx)   │  │  │
│  │  └──────────┘  └──────────┘  └────────────────────┘  │  │
│  └────────────────────────┬─────────────────────────────┘  │
│                           │                                │
│  ┌────────────────────────┴─────────────────────────────┐  │
│  │                 Soroban Smart Contracts                │  │
│  │                                                       │  │
│  │  ┌──────────────────┐    native events   ┌─────────┐ │  │
│  │  │ OphirPayContract │    + cross-contract │ Emitter │ │  │
│  │  │  · record_payment│    pause/unpause    │ Contract│ │  │
│  │  │  · propose_payment│    orchestration    │· events │ │  │
│  │  │  · grant_role    │                      └────┬────┘ │  │
│  │  │  · set_fee_config│                           │      │  │
│  │  │  · 60+ functions │                           │      │  │
│  │  └──────────────────┘                          │      │  │
│  └────────────────────────────────────────────────┼──────┘  │
│                                                   │         │
│  ┌────────────────────────────────────────────────┴──────┐  │
│  │            SSE Event Stream (GET /api/events)          │  │
│  │       Polls emitter contract → streams to UI           │  │
│  └───────────────────────────────────────────────────────┘  │
│                                                             │
│  ┌──────────────────────────────────────────────────────┐   │
│  │                  Data Layer                           │   │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────────────┐   │   │
│  │  │  Prisma  │  │PostgreSQL│  │  API Routes      │   │   │
│  │  │  (ORM)   │  │ (Neon)   │  │  /api/batches    │   │   │
│  │  │          │  │SQLite dev│  │  /api/health     │   │   │
│  │  └──────────┘  └──────────┘  └──────────────────┘   │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

---

## ⚡ Hackathon Quickstart (60 seconds)

```bash
git clone https://github.com/OphirPay/OphirPay.git && cd OphirPay
npm install && npx prisma db push && npx prisma generate
cp .env.example .env && npm run dev
```

**That's it!** Open http://localhost:3000, connect Freighter, and you're live on Stellar Testnet.

Run the pre-demo smoke test to verify everything works:
```bash
bash scripts/demo-test.sh
```

---

## ⚡ Quick Start

> **New to Stellar?** Read our [Stellar 101 explainer](docs/STELLAR_101.md) for a concise primer on accounts, transactions, XLM, and Soroban — aimed at web developers new to blockchain.

### Prerequisites

| Tool | Version | Purpose |
|---|---|---|
| [Node.js](https://nodejs.org) | 18+ | Runtime |
| [Freighter Wallet](https://freighter.app) | Latest | Browser extension for Stellar |
| [Git](https://git-scm.com) | Any | Clone the repo |
| A funded Testnet account | — | Get free XLM from [Friendbot](https://laboratory.stellar.org/#account-creator?network=test) |

### 5-Minute Setup

```bash
# 1. Clone & enter
git clone https://github.com/OphirPay/OphirPay.git && cd OphirPay

# 2. Install everything
npm install

# 3. Initialize database
npx prisma db push && npx prisma generate

# 4. Copy environment template
cp .env.example .env

# 5. Launch!
npm run dev
```

Open **[http://localhost:3000](http://localhost:3000)** — connect your Freighter wallet and you're ready to send Testnet XLM.

<details>
<summary><strong>📋 Environment Variables Reference</strong></summary>

```env
# Database
DATABASE_URL="file:./dev.db"

# Stellar Network (swap TESTNET → PUBLIC for mainnet!)
NEXT_PUBLIC_STELLAR_NETWORK="TESTNET"
NEXT_PUBLIC_STELLAR_RPC_URL="https://soroban-testnet.stellar.org:443"
NEXT_PUBLIC_STELLAR_HORIZON_URL="https://horizon-testnet.stellar.org"
STELLAR_NETWORK_PASSPHRASE="Test SDF Network ; September 2015"

# Soroban Contracts (deployed on testnet — verified live)
NEXT_PUBLIC_CONTRACT_ID="CCQGGUJRRVXMHNEX2RYPODGJE2YRMYY4Y7A3KTJH3QP2LWZLTCOPRPET"
NEXT_PUBLIC_EMITTER_CONTRACT_ID="CDAVU2XJ7C2Y52GRJZKRG3HDI7AJ2K2FHAFH5FPDTSUQAV7XNBQNNVAN"

# App
NEXT_PUBLIC_APP_URL="http://localhost:3000"
```

> ⚡ **Mainnet migration**: Change `NEXT_PUBLIC_STELLAR_NETWORK="PUBLIC"` and update RPC/Horizon URLs. That's it.
</details>

---

## 🔐 Wallet Integration

OphirPay supports multiple Stellar wallets through a unified connector abstraction. Our `MultiWalletProvider` context wraps the entire application, providing:

| Feature | Implementation |
|---|---|
| **Multi-wallet** | Connector interface for Freighter, Albedo, xBull, Rabet, Lobstr, Ledger |
| **Connect** | Wallet selector modal → `connector.connect()` |
| **Disconnect** | Full state reset + connector-specific cleanup |
| **Session persistence** | Auto-detects existing connections on page load |
| **Missing wallet** | Graceful detection — "Not found" badge + actionable error |
| **Rejected connection** | Caught, displayed as inline error |
| **Balance refresh** | Manual refresh button + auto-refresh after send |
| **Loading states** | `balanceLoading` flag → skeleton shimmer |
| **Network badge** | Live indicator showing TESTNET/PUBLIC with status dot |

**Supported wallets:**

| Wallet | Type | Status |
|---|---|---|
| Freighter | Browser extension | ✅ Supported |
| xBull | Browser extension | ✅ Supported |
| Rabet | Browser extension | ✅ Supported |
| Albedo | Web-based (no extension) | ✅ Supported |
| Lobstr | Web-based (SEP-7) | ✅ Supported |
| Ledger | Hardware (WebUSB/HID) | ✅ Supported |

```tsx
// Consuming the wallet anywhere in your app
const { wallet, connect, disconnect, fetchBalance } = useWallet();

// wallet.connected      → boolean
// wallet.publicKey      → "GABCD..."
// wallet.balance        → "12500.50"
// wallet.network        → "TESTNET"
// wallet.activeWalletId → "freighter" | "albedo" | "xbull"

// Connect a specific wallet
connect("albedo");  // or "freighter", "xbull"
```

---

## 📡 Real-Time Events

OphirPay streams **live blockchain events** via Server-Sent Events (SSE). The endpoint polls the deployed `PaymentEventEmitter` contract every 10 seconds, detecting new payment events and pushing them to connected clients.

```
Browser ←──SSE stream─── GET /api/events ──polls──→ PaymentEventEmitter (Soroban)
                                                      ↓
                                                 get_event_count()
                                                 get_event(id)
```

**Events emitted:**

| Event | Trigger |
|---|---|
| `connected` | Stream established |
| `heartbeat` | Every 15 seconds (keep-alive) |
| `payment:created` | New payment event detected on-chain |

Visit **`/events`** in the app to see the live feed with connection status indicator, event type badges, timestamps, and auto-scroll.

---

## 🧪 Smart Contracts

OphirPay deploys **two Soroban contracts**. The main `OphirPayContract` handles all payment logic and publishes native on-chain events, while the `PaymentEventEmitter` stores payment-event records that the app's SSE stream queries — keeping payment logic and event emission separate for cleaner architecture and independent queryability. The contracts are also wired for cross-contract orchestration: `emergency_pause_all` / `emergency_unpause_all` atomically propagate the circuit breaker to the emitter.

### 🔗 Inter-Contract Flow

```
OphirPayContract.record_payment(payer, payee, amount, asset, tx_hash, metadata)
  │
  ├─ 1. Increments payment counter
  ├─ 2. Stores Payment struct in persistent storage
  └─ 3. Publishes native Soroban event
        env.events().publish(("payment", payer, payee), amount)

Browser ←── SSE stream (GET /api/events) ──polls──→ PaymentEventEmitter
        │                                             │
        └─ payment:created event                       └─ get_event_count() / get_event(id)

Emergency orchestration (cross-contract):
OphirPayContract.emergency_pause_all() / emergency_unpause_all()
  └─ env.invoke_contract(emitter, "pause"/"unpause")  →  PaymentEventEmitter
```

### 📦 Main Contract — `OphirPayContract`

| Detail | Value |
|---|---|
| **Contract ID** | `CCQGGUJRRVXMHNEX2RYPODGJE2YRMYY4Y7A3KTJH3QP2LWZLTCOPRPET` |
| **Network** | Stellar Testnet (verified live via Soroban RPC) |
| **WASM Hash** | Deployed: `2114b304...` · Hardened `31d9aa78...` proposed (24h timelock, security fixes) |
| **State** | Initialized, actively recording payments on-chain |
| **Explorer** | [View on Stellar Expert](https://stellar.expert/explorer/testnet/contract/CCQGGUJRRVXMHNEX2RYPODGJE2YRMYY4Y7A3KTJH3QP2LWZLTCOPRPET) |

| Function | Access | Description |
|---|---|---|
| `init(owner)` | Admin | Initialize contract with owner address |
| `record_payment(payer, payee, amount, asset, tx_hash, metadata)` | Public | Store payment + publish native Soroban event |
| `cancel_payment(id)` | Public | Cancel a recorded payment |
| `propose_payment(...)` | Multisig | Propose a multisig payment request |
| `approve_payment(id)` | Multisig | Approve a multisig payment request |
| `execute_approved_payment(id)` | Multisig | Execute an approved payment |
| `set_multisig_config(...)` | Admin | Configure N-of-M thresholds (versioned) |
| `set_fee_config(...)` | Admin | Configure per-operation fee basis points |
| `set_fee_collector(...)` | Admin | Designate fee recipient |
| `propose_timelocked_action(...)` | Admin | Propose admin action with mandatory delay |
| `execute_timelocked_action(id)` | Admin | Execute after delay expires |
| `cancel_timelocked_action(id)` | Admin | Cancel a pending action |
| `configure_governance(...)` | Admin | Set governance parameters |
| `create_proposal(...)` | Governance | Create DAO governance proposal (deposit required) |
| `vote_on_proposal(id, support)` | Governance | Vote YES/NO on a proposal (1 address = 1 vote) |
| `execute_proposal(id)` | Governance | Execute a passed proposal |
| `set_spending_limit(...)` | Admin | Set per-user spending limits |
| `check_spending(user, amount)` | Read | Check limit + escalation tiers |
| `atomic_spend(...)` | Operator | Spend with limit enforcement |
| `grant_role(grantee, role)` | Admin | Grant RBAC role (Admin/Operator/Auditor) |
| `revoke_role(grantee)` | Admin | Revoke a role |
| `set_emitter(emitter)` | Admin | Point to the event emitter contract |
| `emergency_pause_all()` | Admin | Atomic cross-contract pause |
| `emergency_unpause_all()` | Admin | Resume operations |
| `emergency_withdraw(...)` | Admin | Withdraw capped at `balance − LOCKED_BALANCE` |
| `propose_upgrade(...)` / `execute_upgrade()` | Admin | 24h-timelocked WASM upgrades |
| `transfer_ownership(...)` / `accept_ownership()` | Admin | Two-step ownership rotation (24h timelock) |
| `get_payment(id)` / `get_payments_range(...)` | Read | Retrieve payments |
| `get_payment_count()` | Read | Total payments recorded |
| `get_stats()` | Read | All contract counters (gas-optimized) |
| `get_fee_config()` / `get_fee_config_history()` | Read | Fee configuration + immutable history |
| `get_audit_log_count()` / `get_audit_entry(id)` | Read | Immutable on-chain audit trail |

### 📡 Emitter Contract — `PaymentEventEmitter`

| Detail | Value |
|---|---|
| **Contract ID** | `CDAVU2XJ7C2Y52GRJZKRG3HDI7AJ2K2FHAFH5FPDTSUQAV7XNBQNNVAN` |
| **WASM Hash** | Deployed: `6ff35169...` · Allow-list `6d02394b...` proposed (24h timelock) |
| **Purpose** | Stores payment-event records (queried by the SSE stream) + receives cross-contract pause/unpause |
| **Explorer** | [View on Stellar Expert](https://stellar.expert/explorer/testnet/contract/CDAVU2XJ7C2Y52GRJZKRG3HDI7AJ2K2FHAFH5FPDTSUQAV7XNBQNNVAN) |

| Function | Access | Description |
|---|---|---|
| `init(owner)` | Admin | Initialize emitter |
| `emit_payment(emitter, payer, payee, amount, tx_hash)` | Public | Store a PaymentEvent record |
| `get_event(event_id)` | Read | Retrieve event by ID |
| `get_event_count()` | Read | Total events emitted |
| `get_owner()` | Read | Query emitter owner |
| `pause()` / `unpause()` | Admin | Circuit breaker |
| `set_allowed_source(source)` | Admin | Allow-list the orchestrator contract that may emit events (MEDIUM-3 fix) |
| `get_allowed_source()` | Read | Query the allow-listed source (if set) |
| `propose_upgrade(...)` / `execute_upgrade()` | Admin | Timelocked upgrades |

### 🔨 Building & Deploying

<details>
<summary><strong>Build from source</strong></summary>

```bash
# Build both contracts to WASM
cd contracts/ophirpay && cargo build --target wasm32v1-none --release
cd contracts/emitter && cargo build --target wasm32v1-none --release
```
</details>

<details>
<summary><strong>Manual deployment (4 steps)</strong></summary>

```bash
# 1. Deploy emitter
stellar contract deploy \
  --wasm contracts/emitter/target/wasm32v1-none/release/ophirpay_emitter.wasm \
  --source-account <SECRET_KEY> \
  --rpc-url "https://soroban-testnet.stellar.org:443" \
  --network-passphrase "Test SDF Network ; September 2015"

# 2. Init emitter
stellar contract invoke --id <EMITTER_ID> --source-account <SECRET_KEY> \
  --rpc-url "https://soroban-testnet.stellar.org:443" \
  --network-passphrase "Test SDF Network ; September 2015" \
  -- init --owner <OWNER_PUBLIC_KEY>

# 3. Deploy main contract
stellar contract deploy \
  --wasm contracts/ophirpay/target/wasm32v1-none/release/ophirpay_contract.wasm \
  --source-account <SECRET_KEY> \
  --rpc-url "https://soroban-testnet.stellar.org:443" \
  --network-passphrase "Test SDF Network ; September 2015"

# 4. Init main contract + point at emitter
stellar contract invoke --id <OPHIRPAY_ID> --source-account <SECRET_KEY> \
  --rpc-url "https://soroban-testnet.stellar.org:443" \
  --network-passphrase "Test SDF Network ; September 2015" \
  -- init --owner <OWNER_PUBLIC_KEY>
stellar contract invoke --id <OPHIRPAY_ID> --source-account <SECRET_KEY> \
  --rpc-url "https://soroban-testnet.stellar.org:443" \
  --network-passphrase "Test SDF Network ; September 2015" \
  -- set_emitter --emitter <EMITTER_ID>
```
</details>

<details>
<summary><strong>⚡ One-command automated deploy</strong></summary>

```bash
./scripts/deploy-workflow.sh <SECRET_KEY> <OWNER_PUBLIC_KEY> <EMITTER_CONTRACT_ID>
```
Automatically builds WASM, uploads, deploys, initializes, and verifies both contracts.
</details>

---

## 🧪 Smart Contract Tests

Both Soroban contracts include comprehensive `#[cfg(test)]` unit test modules (67 tests total):

| Contract | Tests | Coverage |
|---|---|---|
| `OphirPayContract` | 60 tests | init, payments, escrows, streams, batches, multisig, RBAC, fee config, timelock, governance, refunds, pause, stats, invariants, refund validation, reentrancy lock release |
| `PaymentEventEmitter` | 7 tests | init, emit, get, count, pause/unpause, access control, allow-list |

```bash
# Run contract tests
cd contracts/ophirpay && cargo test
cd contracts/emitter && cargo test
```

---

## 📊 Testing & Quality

```bash
# All app tests (806 cases across 33 suites)
npm test

# Coverage report (87.6% overall — 87.0% statements / 82.3% branches / 92.1% functions / 89.1% lines)
npm run coverage

# E2E tests (97 cases across 7 Playwright specs)
npx playwright test

# Full CI pipeline
npm run ci   # typecheck → lint → test → build
```

### Unit Tests (Vitest) — 806 cases

All app tests live in `src/__tests__/` (33 files, 806 cases): auth & sessions, CSRF, API responses & branches, error codes, contract utilities & invocation, Stellar integration, transaction simulation, webhook URL guard & delivery, validation schemas, type guards, UI components, hooks, loading & error boundaries, and branch coverage suites.

### E2E Tests (Playwright) — 97 cases

| Spec | Focus |
|---|---|
| `critical-flows.spec.ts` | Core user journeys (connect → send → record) |
| `dashboard.spec.ts` | Dashboard rendering + wallet state |
| `api.spec.ts` | API route contracts & error shapes |
| `contracts.spec.ts` | Contract page + on-chain status |
| `error-codes.spec.ts` | Error catalog & classification |
| `multisig.spec.ts` | Multisig propose/approve flows |
| `governance.spec.ts` | Proposal lifecycle |

### Error Classification System

All contract failures route through a 3-tier classifier:

| Type | Icon | Examples |
|---|---|---|
| `NETWORK` | 🌐 | RPC timeout, DNS failure, `ECONNREFUSED` |
| `CONTRACT` | 📜 | HostError, panics, SCError, bad args |
| `USER_REJECTION` | 🚫 | User declined Freighter prompt |

Each type renders with distinct colors (yellow/red/orange) and actionable messaging in the UI — backed by a ~300-variant typed error catalog mirrored between the Rust contract and the TypeScript API layer.

---

## 🔄 CI/CD Pipeline

Every push to `main` triggers **22 jobs** across six tracks:

```
┌─ Frontend ─────────────────────────────────────────────────┐
│ Lint → TypeCheck → Unit Tests → Coverage → Build → Bundle   │
│ Size → A11y (axe-core) → E2E (Playwright) → Smoke (curl)    │
└─────────────────────────────────────────────────────────────┘
┌─ Backend ──────────────────────────────────────────────────┐
│ Contracts (WASM + Tests) → Clippy → rustfmt → Gas Report →  │
│ Prisma (Validate + DB) → npm Audit                          │
└─────────────────────────────────────────────────────────────┘
┌─ Infra · Docs · Security · Meta ───────────────────────────┐
│ Docker Build → K8s (kubeconform) → Helm Lint → OpenAPI      │
│ Validate → Spell Check (typos) → Secrets (Gitleaks) →       │
│ PR Labeler                                                  │
└─────────────────────────────────────────────────────────────┘
```

### Frontend (9 jobs)

| Job | Command | Purpose |
|---|---|---|
| Lint | `npx eslint . --max-warnings 20` | ESLint with zero-error tolerance |
| TypeCheck | `tsc --noEmit` | Full project strict type-checking |
| Unit Tests | `vitest run --reporter=verbose` | 806 app tests across 33 suites |
| Coverage | `vitest run --coverage` | v8 coverage report + thresholds |
| Build | `next build` | Production Next.js build verification |
| Bundle Size | bundle-size check | Regression guard on JS payloads |
| A11y | axe-core audit | WCAG accessibility scan |
| E2E | Playwright | 97 end-to-end scenarios |
| Smoke | curl (19 pages) | HTTP 200 check against live Vercel |

### Backend (6 jobs)

| Job | Command | Purpose |
|---|---|---|
| Contracts | `cargo build --target wasm32v1-none` | Both Soroban contracts to WASM |
| Clippy | `cargo clippy -- -D warnings` | Rust lint, zero warnings |
| Format | `cargo fmt --check` | rustfmt conformance |
| Gas Report | `cargo build` + estimate | Per-function gas report artifact |
| Prisma | `prisma validate` + `prisma db push` | Schema integrity + runtime DB test |
| Audit | `npm audit` | Dependency vulnerability scan |

### Infra, Docs, Security & Meta (7 jobs)

| Job | Purpose |
|---|---|
| Docker Build | Container image build + push |
| K8s | `kubeconform -strict` manifest validation |
| Helm | `helm lint --strict` chart validation |
| OpenAPI | API spec validation |
| Spell Check | `typos` docs check |
| Gitleaks | Secrets scanning on every push |
| PR Labeler | Auto-labels PRs by changed paths |

**→ [View latest CI run](https://github.com/OphirPay/OphirPay/actions/workflows/ci.yml)**

![CI/CD Pipeline](./public/screenshots/ci-pipeline.png)

---

## 📸 Screenshots

<div align="center">

### 🎥 [Watch the Pitch Video (3 min)](https://www.loom.com/share/0d59c50285c04224a4857720b3640018)

*11 scenes: Problem → Live Dashboard → Vercel Deployment → Soroban Contracts → Send Payment → Real-Time Events → GitHub README → CI Pipeline → Multisig Security → Open Source → Outro*

**▶️ [Watch on Loom](https://www.loom.com/share/0d59c50285c04224a4857720b3640018)** · [Download MP4](./public/demo.mp4)

> Screenshots below are captured live from the production deployment on Vercel, with a connected wallet.

| Dashboard | Send Payment |
|---|---|
| ![Dashboard](./public/screenshots/dashboard.png) | ![Send Payment](./public/screenshots/send-payment.png) |

| Payments | Contracts |
|---|---|
| ![Payments](./public/screenshots/payments.png) | ![Contracts](./public/screenshots/contracts.png) |

| Analytics | Multisig |
|---|---|
| ![Analytics](./public/screenshots/analytics.png) | ![Multisig](./public/screenshots/multisig.png) |

| Governance | Mobile Responsive |
|---|---|
| ![Governance](./public/screenshots/governance.png) | ![Mobile](./public/screenshots/mobile-responsive.png) |

</div>

---

## 🛠 Tech Stack

| Layer | Technology | Why |
|---|---|---|
| **Framework** | [Next.js 16](https://nextjs.org) | App Router, SSR, API routes, Vercel native |
| **Language** | [TypeScript](https://www.typescriptlang.org) | Strict mode, full type safety |
| **Styling** | [Tailwind CSS v4](https://tailwindcss.com) | Utility-first, dark mode, custom theme |
| **Blockchain** | [Stellar SDK v13](https://stellar.org) + [Soroban](https://soroban.stellar.org) | Horizon, Soroban RPC, TX building |
| **Contracts** | [Rust](https://www.rust-lang.org) + `soroban-sdk` 27 | WASM compilation, cross-contract invocation |
| **Wallet** | [Freighter](https://freighter.app) · [xBull](https://xbull.app) · [Rabet](https://rabet.io) · [Albedo](https://albedo.link) · [Lobstr](https://lobstr.co) · [Ledger](https://ledger.com) | 6-wallet connector abstraction |
| **Database** | [Prisma](https://prisma.io) + PostgreSQL (Neon) / SQLite | Type-safe ORM, provider switching |
| **Testing** | [Vitest](https://vitest.dev) + React Testing Library + [Playwright](https://playwright.dev) | Unit, integration & E2E coverage |
| **CI/CD** | [GitHub Actions](https://github.com/features/actions) | 22-job pipeline on push |
| **Hosting** | [Vercel](https://vercel.com) | Auto-deploy from `main`, edge network |

---

## 🤝 Contributing

We welcome contributions! Here's how to get started:

1. **Fork** the repository
2. **Create** a feature branch: `git checkout -b feat/amazing-feature`
3. **Commit** your changes: `git commit -m 'feat: add amazing feature'`
4. **Push** to your fork: `git push origin feat/amazing-feature`
5. **Open** a Pull Request against `main`

### Development Scripts

```bash
npm run dev          # Start dev server
npm run build        # Production build
npm run test         # Run all tests
npm run test:watch   # Watch mode
npm run lint         # ESLint
npm run typecheck    # tsc --noEmit
npm run ci           # Full pipeline
npm run db:studio    # Prisma Studio GUI
npx playwright test  # E2E suite
```

### Commit Convention

We follow [Conventional Commits](https://www.conventionalcommits.org):
- `feat:` — new feature
- `fix:` — bug fix
- `docs:` — documentation
- `test:` — tests
- `ci:` — CI/CD changes
- `chore:` — maintenance

---

## 🗺 Roadmap

| Milestone | Status |
|---|---|
| ✅ Wallet connect/disconnect + balance | **Done** |
| ✅ Send XLM with Freighter signing | **Done** |
| ✅ Batch payments (multi-recipient) | **Done** |
| ✅ Soroban contract deployed (Stellar Testnet) | **Done** |
| ✅ Cross-contract communication | **Done** |
| ✅ SSE event streaming from chain | **Done** |
| ✅ Mobile responsive UI | **Done** |
| ✅ CI/CD pipeline (22 jobs) + 806 app tests + 67 contract tests + 97 e2e | **Done** |
| ✅ Multi-wallet support (Freighter, Albedo, xBull, Rabet, Lobstr, Ledger) | **Done** |
| ✅ Stellar assets (USDC, custom tokens, trustline checks) | **Done** |
| ✅ Payment request links (shareable invoices, QR codes) | **Done** |
| ✅ Webhook delivery (HMAC signed, retries) | **Done** |
| ✅ PostgreSQL support (provider switching, migrations) | **Done** |
| ✅ PWA / mobile app (offline support, install prompt) | **Done** |
| ✅ Multisig approvals (N-of-M, propose/approve/execute, full UI) | **Done** |
| ✅ Spending limits + escalation tiers | **Done** |
| ✅ RBAC (Admin/Operator/Auditor) — full-stack + dashboard UI | **Done** |
| ✅ On-chain immutable audit log — full-stack + SSE streaming | **Done** |
| ✅ Recurring payment scheduler — contract + API + dashboard UI | **Done** |
| ✅ Fee configuration per operation — full-stack + version history | **Done** |
| ✅ Timelocked admin actions (24h delay) — full-stack | **Done** |
| ✅ DAO governance (propose→vote→execute) — full-stack | **Done** |
| ✅ Structured refund system (6 reason codes) — full-stack | **Done** |
| ✅ On-chain notification hooks — contract + relayer + UI | **Done** |
| ✅ Cross-contract orchestration (atomic pause_all) | **Done** |
| ✅ Policy versioning (immutable config history, capped at 100) | **Done** |
| ✅ Two-step admin rotation (24h timelock) | **Done** |
| ✅ soroban-sdk 27 upgrade — 58 contract unit tests green in CI | **Done** |
| ✅ Gas optimization (92% storage savings, avg 90K stroops) | **Done** |
| ✅ Testnet deployment (both contracts live, verified on-chain) | **Done** |
| ✅ Frontend/contract interface alignment (`record_payment` + Horizon verification) | **Done** |
| ✅ Pitch video — 3 min, AI voiceover, live Vercel + GitHub captures | **Done** |
| 🔜 Mainnet deployment | Planned |

---

## 🔬 Formal Verification

> ⚠️ **Honest status:** the Kani harnesses in `contracts/ophirpay/spec/` verify hand-written
> **models** — they share no code with the deployed `OphirPayContract`, are not run in CI, and
> several are tautological. The list below reflects *modeled intent*, **not** proof of the deployed
> contract. See [docs/AUDIT.md](docs/AUDIT.md) for details.

| # | Invariant | Status |
|---|-----------|--------|
| 1 | **LOCKED_BALANCE Protection** — `emergency_withdraw` cannot drain user funds | ⚠️ Model only — see HIGH-1 in audit |
| 2 | **One Address = One Vote** — no double-voting per proposal | ⚠️ Model only |
| 3 | **Reentrancy Lock Atomicity** — lock acquired before cross-contract calls | ⚠️ Model only — see MEDIUM-4 in audit |
| 4 | **Proposal Deposit Lifecycle** — deposit always refunded on execution | ⚠️ Model only |
| 5 | **Fee Cap (10% max)** — no fee config exceeds 1000 bps | ⚠️ Model only |
| 6 | **Multisig Threshold** — N-of-M enforcement before execution | ⚠️ Model only |
| 7 | **Timelock 24h Delay** — exactly 86400 seconds enforced | ⚠️ Model only — not wired to admin fns |
| 8 | **Spending Limit Expiry** — expired/inactive limits always reject | ⚠️ Model only — `check_spending` is a read-only check; expiry enforced in `atomic_spend` |

**Run the (model) proofs:**
```bash
cargo install kani-verifier && cargo kani setup
cd contracts/ophirpay/spec && cargo kani
```

See [docs/VERIFICATION.md](docs/VERIFICATION.md) for setup and the Certora/Komet roadmap.

---

## 🛡️ Security Audit

A **manual security review** of both Soroban contracts was completed on 2026-08-13. The full
report lives in **[docs/AUDIT.md](docs/AUDIT.md)**.

**Findings summary:**

| Severity | Count | Headline |
|---|---|---|
| Critical | 0 | — |
| High | 2 | ~~Refund path bypasses `LOCKED_BALANCE`~~ ✅ fixed (validation + owner-auth refunds); "10/10 formally verified" claim ~~not substantiated~~ ✅ removed, `docs/VERIFICATION.md` now documents model-only status |
| Medium | 6 | ~~Unauthenticated `check_spending` mutation · unbounded enumeration · unallowlisted emitter · incomplete reentrancy coverage · `emergency_pause_all` ignores cross-contract result · SSRF bypass via webhook redirects~~ ✅ **all fixed** in code (pending on-chain upgrade) |
| Low | 11 | Vesting overflow, missing pause guards on refunds, webhook HMAC body mismatch, plain SHA-256 API keys, error-code inflation, misc |
| Informational | 5 | Admin actions not timelocked on-chain, permissionless executors, untrusted on-chain records |

**Status:** ⚠️ **Not yet audited by a third party.** The codebase is *audit-ready*, but the
findings above should be remediated and an independent audit (Runtime Verification, Certora,
Trail of Bits, or OtterSec) commissioned before mainnet deployment.

---

## 🔒 Security

OphirPay is designed with defense-in-depth across the contract, API, and web layers. No private keys are ever stored server-side — all signing happens client-side via Freighter/xBull/Rabet/Albedo/Lobstr.

### Smart Contract Invariants

- **Fund-safety invariant** — `emergency_withdraw` is capped at `contract_balance − LOCKED_BALANCE`, so even the contract **owner cannot drain** funds locked in active escrows, streams, or governance deposits
- **Reentrancy guard** — `REENTRANCY_LOCK` blocks cross-contract reentrancy on **every** token-transfer path: escrow create/release/claim, stream create/claim/cancel, governance deposit/refund, refund processing, and the emergency pause/unpause/withdraw functions
- **Pause circuit breaker** — `require_not_paused()` guards every state-changing function
- **Timelocked upgrades & ownership** — 24h delay on WASM upgrades and two-step ownership transfer (other admin actions are *not* timelocked on-chain — see [docs/AUDIT.md](docs/AUDIT.md))
- **1 address = 1 vote** — governance votes are tracked per-address on-chain; double-voting returns `AlreadyVoted`
- **Spam-resistant governance** — proposals require a minimum deposit (locked in `LOCKED_BALANCE`, refunded on execution)
- **No panics** — contract functions return `Result<T, PaymentError>` (the enum defines ~300 variants, many reserved for unimplemented features — see [docs/AUDIT.md](docs/AUDIT.md))
- **TTL management** — every write calls `extend_ttl(5000, 50000)` so records can never be archived

### Web & API Hardening

- **CSRF protection** — double-submit cookie pattern (`__Host-csrf`, HttpOnly, SameSite=Strict) with timing-safe comparison; the client mints the token once and retries once on `CSRF_INVALID`
- **Session security** — HMAC-SHA256 signed session cookies with expiry, `HttpOnly; SameSite=Lax`, fail-closed on DB errors
- **API keys** — SHA-256 hashed at rest, indexed prefix lookup, expiry support, `lastUsed` tracking
- **SSRF guard for webhooks** — blocks loopback/link-local/private IPs and hostnames, with DNS-rebinding re-validation at delivery time
- **HMAC-signed webhook payloads** — receivers verify `X-OphirPay-Signature` (HMAC-SHA256)
- **Input validation** — Zod schemas on all mutation routes; Stellar address regex, amount bounds, memo length limits
- **Rate limiting** — per-IP sliding window (120 RPM default, Redis backend for multi-instance)
- **Security headers** — CSP with Stellar-only connect-src, HSTS, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, Referrer-Policy
- **Error boundaries** — React error boundaries prevent full-page crashes
- **Secrets scanning** — Gitleaks on every PR; dependency auditing via `npm audit` in CI

> ⚠️ **Production note**: OphirPay uses SQLite locally. The live deployment runs PostgreSQL (Neon) with `AUTH_SECRET`, rate limiting, and the documented CORS origins. See `docs/deployment-mainnet.md` for the full checklist.

---

## ⚡ Performance & Gas

OphirPay is engineered for predictable on-chain costs and fast reads:

- **Gas-report CI gate** — the `contract-gas-report` job compiles both contracts, enforces the 128 KB Soroban WASM protocol limit, estimates base inclusion fees, and uploads a per-function gas report as a build artifact (`docs/GAS.md` mirrors the cost model)
- **Cached on-chain reads** — read-only simulations are cached server-side (30–60 s TTL) with per-key granularity; governance/multisig/escrow listings hit the RPC once per window instead of per request
- **Bounded N+1 enumeration** — list endpoints cap per-record reads (e.g. 100 proposals), enumerate the *most recent* tail first, and return an explicit `truncated` flag instead of silently dropping data
- **Scoped cache invalidation** — mutations invalidate only the affected query keys, so an on-chain write never triggers a full re-enumeration of unrelated (expensive) lists
- **RPC failover** — the RPC layer retries across endpoints and falls back between public providers to stay available during provider outages

### Audit-Readiness

- **~300 typed contract error variants** — every failure path returns a machine-readable `PaymentError` (many variants reserved for unimplemented features), mirrored in the TypeScript error catalog and surfaced as clean HTTP/API errors
- **Invariant tests** — fund-safety (`LOCKED_BALANCE` cap), reentrancy, pause, timelock, and 1-vote-per-address are covered by Rust unit tests (60 in `ophirpay`, 7 in `emitter`) plus 806 app vitest cases
- **Zero failing tests** — the full suite is green in CI (`lint`, `typecheck`, `unit-tests`, `contract-wasm`, `next-build`, `e2e`, `secret-scan`)
- **Threat-modeled web layer** — CSRF, SSRF, HMAC sessions, hashed API keys, rate limiting, and CSP are documented in the Security section above and enforced in code
- **Manual security review completed** — a full review of both Soroban contracts and the web/API security layer is in [docs/AUDIT.md](docs/AUDIT.md) (2 High, 6 Medium findings); a third-party audit is still pending before mainnet

---

## 🌐 Community

| Channel | Link |
|---|---|
| **GitHub Discussions** | [github.com/OphirPay/OphirPay/discussions](https://github.com/OphirPay/OphirPay/discussions) |
| **Issue Tracker** | [github.com/OphirPay/OphirPay/issues](https://github.com/OphirPay/OphirPay/issues) |
| **Security Reports** | [SECURITY.md](SECURITY.md) — Bug bounty program available |
| **Stellar Ecosystem** | [stellar.org](https://stellar.org) · [Soroban Docs](https://soroban.stellar.org) |

## 📄 License & Credits

### License

Open source under the **[MIT License](LICENSE)** — free for personal, commercial, and educational use.

### Built With

- [Stellar](https://stellar.org) & [Soroban](https://soroban.stellar.org) — The blockchain that powers it all
- [Next.js](https://nextjs.org) — The React framework for production
- [Tailwind CSS](https://tailwindcss.com) — Rapidly build modern websites
- [Prisma](https://prisma.io) — Next-generation ORM for Node.js
- [Vitest](https://vitest.dev) · [Playwright](https://playwright.dev) — Unit & E2E test frameworks
- [Freighter](https://freighter.app) — Stellar wallet browser extension

### Acknowledgments

Special thanks to the **Stellar Development Foundation** for their excellent documentation, SDKs, and the Soroban smart contract platform that makes on-chain payment logic possible.

---

<div align="center">

**[🐛 Report a Bug](https://github.com/OphirPay/OphirPay/issues)** · **[💡 Request a Feature](https://github.com/OphirPay/OphirPay/issues)** · **[📖 Read the Docs](https://github.com/OphirPay/OphirPay#readme)**

<br />

<sub>Built with ❤️ for the Stellar ecosystem</sub>

</div>
