# Smart Contract Testing Convention

This document defines the testing architecture and conventions for all Soroban smart contracts in OphirPay (`contracts/ophirpay` and `contracts/emitter`).

---

## 1. Overview & Test Hierarchy

Contract tests are partitioned into three distinct tiers based on scope and visibility requirements:

| Test Tier | Location | Scope & Purpose | Access Level |
|---|---|---|---|
| **Unit Tests** | `src/tests/` (or inline next to code) | Unit-level verification of contract logic, error variants, storage keys, internal state machines, and private helper functions (e.g. `compute_vested`). | Crate-internal (`super::*`, `pub(crate)`). |
| **Integration Tests** | `tests/integration_tests.rs` (and `tests/*.rs`) | End-to-end client flows, multi-contract interactions, cross-contract calls, event publishing verification, and pagination. | Public API via generated Soroban client (`*Client`). |
| **Property Tests** | `tests/proptest_*.rs` | Fuzzing and generative property-based tests verifying conservation laws, arithmetic boundaries, and invariant preservation under arbitrary sequences. | Public API + test utilities. |

Both `contracts/ophirpay` and `contracts/emitter` strictly adhere to this convention.

---

## 2. Directory Layout

### `contracts/ophirpay`

```
contracts/ophirpay/
├── Cargo.toml
├── src/
│   ├── lib.rs                                  # Contract implementation & public exports
│   └── tests/                                  # Unit test suite (modularized by domain)
│       ├── mod.rs                              # Submodule declarations & shared test helpers
│       ├── admin_tests.rs                      # Contract initialization & ownership
│       ├── batch_tests.rs                      # Batch payments & validation
│       ├── escrow_tests.rs                     # Escrow locking, releasing & claiming
│       ├── governance_tests.rs                 # Proposals, voting, thresholds & timelocks
│       ├── hook_and_orchestration_tests.rs     # Webhook registration & emergency pause
│       ├── lifecycle_and_reentrancy_tests.rs   # Reentrancy lock & balance conservation
│       ├── multisig_tests.rs                   # Multi-signature configuration & proposals
│       ├── pause_tests.rs                      # Pause state enforcement across entrypoints
│       ├── payment_tests.rs                    # Payment recording & cancellation
│       ├── rbac_and_audit_tests.rs             # Role-based access control & audit trails
│       ├── recurring_tests.rs                  # Scheduled payment execution
│       ├── refund_tests.rs                     # Refund requests, approvals & reason codes
│       ├── spending_tests.rs                   # Daily spending limits & escalations
│       ├── storage_tests.rs                    # TTL bump policies & bounded readers
│       ├── stream_tests.rs                     # Payment streaming & linear vesting
│       └── versioning_and_ownership_tests.rs   # Config version history & 2-step transfer
└── tests/                                      # External integration & property test suite
    ├── error_uniqueness.rs                     # Error discriminant verification
    ├── fee_report.rs                           # Fee calculation invariants
    ├── integration_tests.rs                    # End-to-end client flows
    ├── issue692.rs                             # Timelock timestamp saturation regressions
    ├── issue693.rs                             # Missing hook & owner error regressions
    ├── issue695.rs                             # Batch math overflow regressions
    ├── proptest_payment_amounts.rs             # Property tests for payment amounts
    └── proptest_token_moving.rs                # Property tests for balance conservation
```

### `contracts/emitter`

```
contracts/emitter/
├── Cargo.toml
├── src/
│   └── lib.rs                                  # Emitter contract logic & event definitions
└── tests/
    └── integration_tests.rs                    # Client integration tests & event queries
```

---

## 3. Rules & Guidelines for Contributors

### Rule 1: Where to Place New Tests

1. **Adding a test for private logic, internal keys, or helper functions:**
   - Place in `src/tests/<domain>_tests.rs` (in `contracts/ophirpay`) or inline/unit tests in `src/` (in `contracts/emitter`).
   - If a private helper needs unit testing outside its immediate file, mark it `pub(crate)` (e.g. `pub(crate) fn compute_vested(...)`).

2. **Adding an end-to-end client test:**
   - Place in `tests/integration_tests.rs` using the generated Soroban client (`OphirPayContractClient` or `PaymentEventEmitterClient`).
   - Integration tests treat the contract as an external dependency, validating public behavior and error codes.

3. **Adding generative or fuzzing property tests:**
   - Place in `tests/proptest_<feature>.rs` using `proptest`.
   - Focus on financial conservation invariants (e.g., total locked balance must equal sum of active escrow + unvested stream amounts).

### Rule 2: Access to Private Items

- Do not make contract storage keys or sensitive internal state public just for tests.
- When unit tests require private constants or functions, place the test in `src/tests/` which inherits access via `super::*` and `pub(crate)`.

---

## 4. Running Contract Tests

```bash
# Run all tests for ophirpay contract
cargo test --manifest-path contracts/ophirpay/Cargo.toml

# Run only unit tests
cargo test --manifest-path contracts/ophirpay/Cargo.toml --lib

# Run a specific unit test module
cargo test --manifest-path contracts/ophirpay/Cargo.toml --lib tests::stream_tests

# Run integration tests
cargo test --manifest-path contracts/ophirpay/Cargo.toml --test integration_tests

# Run property tests
cargo test --manifest-path contracts/ophirpay/Cargo.toml --test proptest_token_moving

# Run emitter tests
cargo test --manifest-path contracts/emitter/Cargo.toml
```
