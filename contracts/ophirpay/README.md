# `ophirpay-contract`

The Soroban smart contract behind OphirPay: payments, batch disbursements,
escrows, vesting streams, recurring schedules, refunds, multisig approvals,
RBAC, governance/timelocks, spending limits and notification hooks.

- Package: `ophirpay-contract` (Rust, edition 2021, `soroban-sdk = "=27.0.5"`)
- Toolchain: pinned to 1.91.0 by [`../rust-toolchain.toml`](../rust-toolchain.toml)
- Artifact: `cdylib` + `rlib`, built for the Soroban `wasm32v1-none` target

## Layout

| File                    | Contents                                                 |
| ----------------------- | -------------------------------------------------------- |
| `src/lib.rs`            | Module wiring and re-exports — the public crate surface  |
| `src/contract.rs`       | `#[contractimpl]` entry points                           |
| `src/types.rs`          | `#[contracttype]` structs, enums and protocol constants  |
| `src/errors.rs`         | `PaymentError` enum (the on-chain error discriminants)   |
| `src/storage.rs`        | Storage keys, TTL bump policy, locked-balance accounting |
| `src/events.rs`         | Emitted events                                           |
| `src/helpers.rs`        | Auth, pause, reentrancy and validation helpers           |
| `src/spending_limit.rs` | Daily/monthly spending-window logic                      |
| `src/test.rs`           | Unit tests that need crate internals                     |
| `tests/`                | Public-API integration, regression and property tests    |
| `spec/`                 | Contract spec used for client generation                 |

## Build and test

There is no Cargo workspace at the repository root, so target this crate's
manifest:

```bash
# Test suite (unit + integration + proptests)
cargo test --manifest-path contracts/ophirpay/Cargo.toml

# Single test
cargo test --manifest-path contracts/ophirpay/Cargo.toml escrow_release_moves_tokens

# Property-based (proptest) suites
cargo test --manifest-path contracts/ophirpay/Cargo.toml --test proptest_token_moving
cargo test --manifest-path contracts/ophirpay/Cargo.toml --test proptest_payment_amounts
# The amount suite honours PROPTEST_CASES (default 64):
PROPTEST_CASES=1000 cargo test --manifest-path contracts/ophirpay/Cargo.toml \
  --test proptest_payment_amounts

# Soroban WASM build
cd contracts/ophirpay && cargo build --release --target wasm32v1-none
```

Writing a new test? Start with
[docs/TESTING.md](../../docs/TESTING.md) — it walks through
`Env::default()`, `mock_all_auths()`, deploying a Stellar asset contract,
asserting token balances and asserting exact `PaymentError` values.

## Related documentation

- [Contract error catalog](../../docs/ERRORS.md) — every `PaymentError`, its
  cause and the recommended action.
- [Contract architecture](../../docs/CONTRACT_ARCHITECTURE.md) and
  [function reference](../../docs/CONTRACT_FUNCTION_REFERENCE.md).
- [Contract SSE reference](../../docs/CONTRACT_SSE_REFERENCE.md) — how contract
  events reach the live stream.
- [Contract regression checks](../../.github/workflows/contract-regression.yml) —
  the CI job that runs this crate's tests and verifies the WASM hash.
