# Sharded Database E2E Testing Strategy & Integration Runbook

## Overview

OphirPay employs a horizontally sharded database architecture for enterprise high-throughput payment settlement and multi-tenant ledger management. This runbook documents the E2E testing framework, consistent hashing routing mechanics, cross-shard transaction assertions, and test isolation lifecycle.

---

## Architecture & Routing Mechanics

```
                ┌─────────────────────────────────────────┐
                │   OphirPay Client / API Gateway / Tests  │
                └────────────────────┬────────────────────┘
                                     │
                                     ▼
                    ┌─────────────────────────────────┐
                    │     Sharded Database Router     │
                    │   (Consistent Hash Ring: MD5)   │
                    └────┬───────────┼───────────┬────┘
                         │           │           │
           ┌─────────────┘           │           └─────────────┐
           ▼                         ▼                         ▼
  ┌─────────────────┐       ┌─────────────────┐       ┌─────────────────┐
  │  Shard US-East  │       │  Shard EU-West  │       │ Shard AP-South  │
  │  (Tenant A-H)   │       │  (Tenant I-P)   │       │  (Tenant Q-Z)   │
  └─────────────────┘       └─────────────────┘       └─────────────────┘
```

### 1. Consistent Hash Ring
- Uses **FNV-1a / Murmur3-compatible** 32-bit consistent hashing with 50 virtual nodes per shard instance.
- Avoids hot-spotting and guarantees deterministic routing based on partition keys (e.g. `senderAddress` or `merchantId`).

### 2. Cross-Shard Batch Transactions
- Coordinated via 2-phase test fixtures:
  - **Phase 1 (Prepare):** Partition calculation and pre-allocation across target shards.
  - **Phase 2 (Commit):** Atomic persistence with cross-shard query reconciliation.

---

## Test Scenarios Covered in E2E Suite (`e2e/sharded-database.spec.ts`)

| Test Scenario | Purpose & Verification Criteria | Status |
|---|---|---|
| **Router Initialization** | Verifies all registered shards are active with clean metrics and correct weights. | Verified |
| **Deterministic Routing** | Asserts partition keys map consistently to expected shards without drift. | Verified |
| **Data Isolation** | Ensures records in Shard A cannot bleed into Shard B storage scopes. | Verified |
| **Cross-Shard Batches** | Validates multi-account batch executions spanning distinct database shards. | Verified |
| **Load Distribution** | Simulates multi-tenant transaction spikes to ensure no shard starvation occurs. | Verified |
| **Teardown & Cleanup** | Verifies strict zero-state teardown between test suites preventing test pollution. | Verified |

---

## Running the Sharded Database E2E Suite

### Locally with Playwright
```bash
# Run sharded database tests
pnpm exec playwright test e2e/sharded-database.spec.ts

# Run with chromium and trace enabled
pnpm exec playwright test e2e/sharded-database.spec.ts --project=chromium --trace on
```

### In GitHub Actions CI
The suite is integrated into `.github/workflows/ci.yml` under the E2E matrix job.
