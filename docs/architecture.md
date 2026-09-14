# OphirPay Architecture

## System Overview

OphirPay is a payment orchestration layer built on the Stellar blockchain. It consists of four layers:

```
┌──────────────────────────────────────────────────────────────────────┐
│                        CLIENT LAYER                                   │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌────────────────────┐  │
│  │ Next.js  │  │  React   │  │ Tailwind │  │  6 Wallet          │  │
│  │ App Router│  │ Query v5 │  │  CSS v4  │  │  Connectors        │  │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └─────────┬──────────┘  │
│       │              │              │                  │             │
├───────┼──────────────┼──────────────┼──────────────────┼─────────────┤
│       │         DATA FETCHING       │                  │             │
│  ┌────┴────────────────────────────┴──────────────────┴──────────┐  │
│  │                    useApiQuery / useApiMutation                │  │
│  │          30s stale · 5min GC · 2 retries · auto-invalidate    │  │
│  └────────────────────────────────┬──────────────────────────────┘  │
│                                   │                                  │
├───────────────────────────────────┼──────────────────────────────────┤
│                           API LAYER                                  │
│  ┌──────────┐  ┌──────────┐  ┌────┴─────┐  ┌────────────────────┐  │
│  │ Zod      │  │ CSRF     │  │ 39 API   │  │ In-Memory          │  │
│  │ Schemas  │  │ Tokens   │  │  Routes  │  │ TTL Cache          │  │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └─────────┬──────────┘  │
│       │              │             │                   │            │
│  ┌────┴──────────────┴─────────────┴───────────────────┴────────┐   │
│  │              Middleware Pipeline (per-route)                  │   │
│  │  proxy (rateLimit + X-Request-Id) → handler calls           │   │
│  │  verifyCsrf (session cookie auth only; API keys bypass) →    │   │
│  │  validate → handler (withRequestLogging: id · method · path  │   │
│  │  · status · durationMs) → 200                               │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                                                                      │
├──────────────────────────────────────────────────────────────────────┤
│                       CONTRACT LAYER (Soroban)                       │
│                                                                      │
│  ┌─────────────────────────────────┐    ┌──────────────────────────┐│
│  │       OphirPayContract          │    │     PaymentEventEmitter  ││
│  │  ─────────────────────────────  │    │  ─────────────────────── ││
│  │  Payments · Escrows · Streams   │    │  emit_payment()          ││
│  │  Batches · Recurring · Refunds  │◄───│  pause() / unpause()     ││
│  │  Multisig (N-of-M) · RBAC       │ cc │  get_event() / count()   ││
│  │  Governance · Timelocks         │    │                          ││
│  │  Fee Config · Hooks · Audit     │    │  14 error codes          ││
│  │  300 error codes · 58 tests    │    │  6 tests                 ││
│  └───────────────┬─────────────────┘    └──────────────────────────┘│
│                  │                                                    │
│  ┌───────────────┴────────────────────────────────────────────────┐  │
│  │                    Storage Architecture                         │  │
│  │  Instance: counters · config · owner · paused · fee_config      │  │
│  │  Persistent: payments · escrows · streams · batches · audit    │  │
│  │  Namespaced keys: Payment_0xN · Escrow_0xN · Stream_0xN        │  │
│  │  TTL: 50,000 ledgers with auto-extend_ttl on every write       │  │
│  └────────────────────────────────────────────────────────────────┘  │
│                                                                      │
├──────────────────────────────────────────────────────────────────────┤
│                       INFRASTRUCTURE                                  │
│                                                                      │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌────────────────────┐  │
│  │ Vercel   │  │ Docker   │  │ K8s +    │  │ GitHub Actions     │  │
│  │ Deploy   │  │ distroless│  │ Helm     │  │ 21 Jobs            │  │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └─────────┬──────────┘  │
│       │              │             │                   │            │
│  ┌────┴──────────────┴─────────────┴───────────────────┴────────┐   │
│  │                    Monitoring & Observability                 │   │
│  │  Prometheus metrics · Grafana dashboard · Sentry errors       │   │
│  │  Structured request logs (request id · method · path · status │   │
│  │  · duration) · SSE event stream · Webhook delivery · Audit    │   │
│  └──────────────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────────┘
```

## Component Diagram

### 1. Smart Contracts

| Contract                | Purpose            | Key Functions                                                                                                                                     |
| ----------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| **OphirPayContract**    | Core payment logic | `record_payment`, `create_escrow`, `create_stream`, `create_batch`, `request_refund`, `propose_payment`, `create_proposal`, `emergency_pause_all` |
| **PaymentEventEmitter** | Event broadcasting | `emit_payment`, `pause`, `unpause`                                                                                                                |

**Cross-contract communication**: OphirPayContract calls `env.invoke_contract()` on Emitter for `emergency_pause_all`/`emergency_unpause_all`, pausing both contracts atomically. For a deep-dive of the invocation pattern — the typed argument passing, error propagation, and how to extend it to new contracts — see [CONTRACT_ARCHITECTURE.md](CONTRACT_ARCHITECTURE.md).

### 2. Data Flow

```
User Action → Freighter Signing → Soroban TX → OphirPayContract
                                                    │
                                          ┌─────────┴─────────┐
                                          │   Native Events    │
                                          │ env.events().publish│
                                          └─────────┬─────────┘
                                                    │
                                          ┌─────────┴─────────┐
                                          │   SSE Stream       │
                                          │ /api/events → UI   │
                                          └───────────────────┘
```

### 3. Storage Architecture

| Type               | Location          | TTL                      | Purpose                                            |
| ------------------ | ----------------- | ------------------------ | -------------------------------------------------- |
| Instance storage   | Contract instance | 50,000 ledgers           | Counters, config, owner, paused flag               |
| Persistent storage | Contract ledger   | 50,000 ledgers per entry | Payments, escrows, streams, batches, audit entries |

All writes call `extend_ttl(5000, 50000)` to prevent archival.

### 4. Security Model

| Layer                      | Mechanism                                                  |
| -------------------------- | ---------------------------------------------------------- |
| **Pause circuit breaker**  | `require_not_paused()` on every state-changing function    |
| **Two-step upgrades**      | 24h timelock via `propose_upgrade` → `execute_upgrade`     |
| **Two-step ownership**     | 24h timelock via `transfer_ownership` → `accept_ownership` |
| **Atomic check-and-spend** | `atomic_spend()` validates limits THEN records payment     |
| **RBAC**                   | Admin/Operator/Auditor roles with `require_role()`         |
| **Timelocked actions**     | 24h delay on sensitive admin operations                    |
| **Emergency withdraw**     | Owner-only rescue of misdirected tokens                    |

### 5. Error Handling

300 typed error variants from `NotInitialized=1` to `SystemOverloaded=300` (many reserved for unimplemented features). Contract functions return `Result<T, PaymentError>` — no panics in production code.

## Directory Structure

```
ophirpay/
├── contracts/              # Soroban smart contracts (Rust)
│   ├── ophirpay/           # Core payment contract (4800+ lines, 300 error variants)
│   └── emitter/            # Event emission contract
├── src/
│   ├── app/                # Next.js App Router pages (15 routes)
│   │   ├── api/            # API routes (20+ endpoints)
│   │   └── [page]/         # Page components
│   ├── components/         # Shared UI components
│   │   └── ui/             # Design system (Button, Card, Modal, etc.)
│   ├── hooks/              # React hooks (16 hooks)
│   ├── lib/                # Business logic (100+ modules)
│   └── types/              # TypeScript type definitions
├── prisma/                 # Database schema + seed
├── k8s/                    # Kubernetes manifests
├── helm/                   # Helm chart
├── scripts/                # Deployment, demo, relayer, seeding
├── e2e/                    # Playwright E2E tests
├── tests/visual/           # Playwright visual regression tests + baselines
├── monitoring/             # Grafana dashboard JSON
└── docs/                   # Documentation
```

## Fiat Display & Price Oracle Architecture

The client provides a toggle between native **XLM** and fiat **USD** displays across payment views:

```
┌─────────────────┐       ┌─────────────────┐       ┌─────────────────┐
│  CoinGecko API  │ ──┬──►│  In-Memory TTL  │ ──┬──►│   useXlmPrice   │ ──► CurrencyToggle /
│   (Primary)     │   │   │  Cache (60s)    │   │   │      Hook       │     Payments Table
└─────────────────┘   │   └─────────────────┘   │   └─────────────────┘
                      │                         │
┌─────────────────┐   │                         │
│  Coinbase API   │ ──┘                         │
│   (Fallback)    │                             │
└─────────────────┘                             ▼
                                    ┌───────────────────────┐
                                    │ Graceful 'Unavailable'│
                                    │ Fallback (XLM Only)   │
                                    └───────────────────────┘
```

### Rounding & Precision Rules

| Currency / Range                 | Format Rule                                    | Example              |
| -------------------------------- | ---------------------------------------------- | -------------------- |
| **USD Standard ($\ge \$0.01$)**  | Half-up rounding to 2 decimal places           | `$12.35` (`~$12.35`) |
| **USD Micro ($0 < x < \$0.01$)** | `<$0.01` (prevents false zero display)         | `<$0.01`             |
| **USD Zero ($0.00$)**            | `$0.00`                                        | `$0.00`              |
| **XLM On-Chain**                 | 2 to 7 decimal places (1 XLM = $10^7$ stroops) | `12.50 XLM`          |
| **Unavailable Price**            | Fallback to XLM with `(USD unavailable)` badge | `10.00 XLM`          |

Preferences are persisted in `localStorage` under `ophirpay-currency-display` (`STORAGE_KEYS.CURRENCY_DISPLAY`).

## Tech Stack

| Layer         | Technology                                                   |
| ------------- | ------------------------------------------------------------ |
| Blockchain    | Stellar / Soroban SDK 27.0.5                                 |
| Contracts     | Rust, `#![no_std]`, soroban-sdk 27.0.5, wasm32v1-none target |
| Frontend      | Next.js 16, React 19, Tailwind CSS 4                         |
| Database      | PostgreSQL via Prisma ORM                                    |
| Wallet        | Freighter (Albedo, xBull, Ledger supported)                  |
| Testing       | Vitest (834), Rust `#[test]` (64), Playwright (97 E2E+API)   |
| CI/CD         | GitHub Actions (21 jobs)                                     |
| Orchestration | Kubernetes + Helm                                            |
| Monitoring    | Prometheus + Grafana                                         |
