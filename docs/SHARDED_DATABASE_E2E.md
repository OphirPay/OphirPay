# Sharded Database E2E Testing Strategy & Integration Runbook

## Overview

This runbook documents the reusable E2E harness for validating a horizontally sharded OphirPay deployment. The harness keeps shard routing and storage in memory, so it can exercise partitioning, cross-shard coordination, and cleanup deterministically without production database credentials.

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
                    │       (FNV-1a hash ring)        │
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
- Uses **FNV-1a** 32-bit consistent hashing with 50 virtual nodes per shard instance by default.
- Avoids hot-spotting and guarantees deterministic routing based on partition keys (e.g. `senderAddress` or `merchantId`).

### 2. Cross-Shard Batch Transactions
- Simulated by the test fixture with a 2-phase coordination model:
  - **Phase 1 (Prepare):** Partition calculation and pre-allocation across target shards.
  - **Phase 2 (Commit):** Atomic persistence with cross-shard query reconciliation.

---

## Test Scenarios Covered in E2E Suite (`e2e/sharded-database.spec.ts`)

| Test Scenario | Purpose & Verification Criteria | Status |
|---|---|---|
| **Router Initialization** | Verifies all registered shards are active with clean metrics and correct weights. | Verified |
| **Deterministic Routing** | Asserts partition keys map consistently to expected shards without drift. | Verified |
| **Data Isolation** | Ensures records in Shard A cannot bleed into Shard B storage scopes. | Verified |
| **Cross-Shard Batches** | Validates multi-account batch coordination spanning distinct database shards. | Verified |
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
