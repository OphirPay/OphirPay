# Writing and running Soroban contract tests

A practical walkthrough for testing the OphirPay contract with
`soroban-sdk::testutils`. It is aimed at someone adding a contract feature and
needing a test that actually exercises the token movement, auth and ledger time
involved — not at re-reading the SDK docs.

- Runtime: Rust **1.91.0** (pinned by
  [`contracts/rust-toolchain.toml`](../contracts/rust-toolchain.toml)).
- SDK: `soroban-sdk = "=27.0.5"`, with the `testutils` feature enabled in
  `[dev-dependencies]` (already configured).
- Crate under test: `ophirpay-contract`, package directory
  `contracts/ophirpay`.

## Where tests live

Both harnesses run under `cargo test`, and the split is deliberate
(see [CONTRIBUTING.md](../CONTRIBUTING.md#soroban-contract-tests)):

| Location | Use it for | Visibility |
|---|---|---|
| `contracts/ophirpay/src/test.rs` | Unit tests that need private helpers, storage keys, or internal functions | Inside the crate (`#[cfg(test)] mod tests`) |
| `contracts/ophirpay/tests/*.rs` | Public-API tests: integration flows, property tests, one-issue reproductions | External crate — only what `lib.rs` re-exports |

`tests/integration_tests.rs` contains a `TestFixture` that wires an
initialised contract, a Stellar asset contract (SAC) and an emitter. Reuse it
instead of duplicating setup when your test fits that shape.

## Running the suite

There is no Cargo workspace at the repository root, so run `cargo` against the
crate's manifest:

```bash
# Everything in the contract crate (unit + integration + proptests)
cargo test --manifest-path contracts/ophirpay/Cargo.toml

# Same thing from inside the crate
cd contracts/ophirpay && cargo test

# One test by name
cargo test --manifest-path contracts/ophirpay/Cargo.toml escrow_release_moves_tokens

# Show contract panics / captured output
cargo test --manifest-path contracts/ophirpay/Cargo.toml -- --nocapture

# The sibling emitter crate
cargo test --manifest-path contracts/emitter/Cargo.toml
```

> The package is named **`ophirpay-contract`**, not `ophirpay`. Inside the crate
> directory `cargo test --package ophirpay-contract` is equivalent to plain
> `cargo test`.

Native `cargo test` is the fast loop. A WASM build is a separate check:

```bash
cd contracts/ophirpay
cargo build --release --target wasm32v1-none
```

`wasm32v1-none` is the Soroban target for protocol 25+; the legacy
`wasm32-unknown-unknown` target is rejected by soroban-sdk 27.

## The test environment

Every test starts from `Env::default()`, which is an in-memory ledger plus host
with **no network, no real signatures and no fees**. Three knobs matter:

```rust
let env = Env::default();
env.mock_all_auths();                        // accept any require_auth()
env.ledger().set_timestamp(1_000_000);       // deterministic "now" (seconds)
```

- `mock_all_auths()` is what lets a test call an entry point that calls
  `address.require_auth()`. To test the *failure* path, drop it and use
  `env.mock_auths(&[...])` or `try_*` methods.
- `env.ledger().set_timestamp(..)` controls escrow deadlines, stream vesting and
  timelocks. Without it, `ledger().timestamp()` is 0, so a deadline of
  "now + 1 day" is 86 400.
- `Address::generate(&env)` creates funded-out-of-thin-air test addresses.

## A minimal test that moves tokens

Add this to `contracts/ophirpay/tests/quickstart.rs` (the integration harness),
or inside `mod tests` in `src/test.rs` if it needs internals. It deploys the
contract, creates a Stellar asset, deposits into an escrow and asserts the
actual token balances after release:

```rust
#![cfg(test)]

use ophirpay_contract::{OphirPayContract, OphirPayContractClient};
use soroban_sdk::testutils::{Address as _, Ledger as _};
use soroban_sdk::{token, Address, Env, String};

#[test]
fn escrow_release_moves_tokens_to_beneficiary() {
    // 1. Test environment: in-memory ledger, auth mocked, fixed clock.
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_timestamp(1_000_000);

    // 2. Actors.
    let owner = Address::generate(&env);
    let depositor = Address::generate(&env);
    let beneficiary = Address::generate(&env);

    // 3. A Stellar Asset Contract (SAC) to move value with.
    let asset = env.register_stellar_asset_contract_v2(owner.clone()).address();
    let token = token::Client::new(&env, &asset);
    let asset_admin = token::StellarAssetClient::new(&env, &asset);
    asset_admin.mint(&depositor, &10_000);

    // 4. Register the contract under test and initialise it.
    let contract_id = env.register(OphirPayContract, ());
    let client = OphirPayContractClient::new(&env, &contract_id);
    client.init(&owner);
    client.set_timelock_enabled(&owner, &false);

    // 5. Exercise a value-moving flow.
    let escrow_id = client.create_escrow(
        &depositor,
        &beneficiary,
        &Option::<Address>::None,     // no arbiter
        &1_000,
        &asset,
        &(env.ledger().timestamp() + 86_400),
        &String::from_str(&env, "quickstart"),
    );

    assert_eq!(escrow_id, 1);
    assert_eq!(token.balance(&depositor), 9_000);
    assert_eq!(token.balance(&contract_id), 1_000);

    // 6. Release as the contract owner and assert the transfer landed.
    client.release_escrow(&owner, &escrow_id);

    assert_eq!(token.balance(&contract_id), 0);
    assert_eq!(token.balance(&beneficiary), 1_000);
    assert!(client.get_escrow(&escrow_id).released);
}
```

Run it:

```bash
cargo test --manifest-path contracts/ophirpay/Cargo.toml escrow_release_moves_tokens
```

Why each part is there:

| Step | Why it matters |
|---|---|
| `env.register(OphirPayContract, ())` | Deploys the contract into the test host and returns its `Address`. `()` is the constructor argument tuple — OphirPay is initialised via `init`, not a constructor. |
| `OphirPayContractClient::new(&env, &contract_id)` | The generated typed client. Calling methods on it is a real cross-contract call; errors surface as `Result`. |
| `register_stellar_asset_contract_v2(admin)` | Deploys a SAC so token transfers are real and returns a handle whose `.address()` is the asset contract. Without a SAC, any flow that transfers value panics on an unknown contract. |
| `StellarAssetClient::mint` | Mints test balance. The SAC admin must be the minter (`admin` above). |
| `client.init(&owner)` then `set_timelock_enabled(&owner, &false)` | Initialises ownership. Disabling the timelock keeps governance-side tests short; leave it on when the test is *about* the timelock. |
| Asserting token balances | The point of the test. Asserting only the escrow struct would pass even if no tokens moved. |

## Asserting contract errors

Use the client's `try_*` variants to assert the exact `PaymentError`. The
generated `try_` methods return `Result<Result<T, PaymentError>, InvokeError>`,
so a contract error is `Err(Ok(PaymentError::…))`:

```rust
use ophirpay_contract::PaymentError;

let env = Env::default();
env.mock_all_auths();
let contract_id = env.register(OphirPayContract, ());
let client = OphirPayContractClient::new(&env, &contract_id);
let owner = Address::generate(&env);
client.init(&owner);

assert_eq!(
    client.try_init(&owner),
    Err(Ok(PaymentError::AlreadyInitialized))
);
```

Every code is documented in [ERRORS.md](./ERRORS.md), which also lists which
variants the current build can return.

## Time-dependent behaviour

Ledger time only moves when you move it:

```rust
let now = env.ledger().timestamp();
let _ = client.create_escrow(
    &depositor, &beneficiary, &None::<Address>, &500, &asset,
    &(now + 100), &String::from_str(&env, "deadline"),
);

// Too early: claim_escrow would fail with EscrowNotDue.
env.ledger().set_timestamp(now + 200);
client.claim_escrow(&beneficiary, &1);
```

The same pattern drives streams (`claim_stream` respects the vesting schedule)
and timelocks (`execute_timelocked_action` after the 24 h delay). Use
`env.ledger().with_mut(|li| li.sequence_number += 1)` when a test needs a new
ledger sequence rather than a new timestamp.

## Common failure modes

| Symptom | Cause | Fix |
|---|---|---|
| `Error(Auth, InvalidAction)` / `require_auth` panic | The test did not mock the right auth | Call `env.mock_all_auths()`, or mock the specific address with `env.mock_auths` when testing the rejection path |
| Host panic on an unknown contract | A token transfer used an address that is not a deployed SAC | Deploy one with `env.register_stellar_asset_contract_v2(admin).address()` |
| `InsufficientBalance`-style SAC panic | The payer was never minted | `StellarAssetClient::mint(&payer, &amount)` |
| Every call returns `NotInitialized` | `init` was never called | Call `client.init(&owner)` first |
| Timelock surprises | Default timelock is enabled | `set_timelock_enabled(&owner, &false)` unless the test is about timelocks |
| Deadline/stream tests behave as if time froze | Ledger timestamp was never advanced | `env.ledger().set_timestamp(..)` |
| `no_std` / `std` import errors | Test code added to `lib.rs` outside `#[cfg(test)]` | Keep tests in `src/test.rs` or `tests/`, and import std-only helpers there |

## Before you open the PR

```bash
cargo test --manifest-path contracts/ophirpay/Cargo.toml
cargo test --manifest-path contracts/emitter/Cargo.toml
cd contracts/ophirpay && cargo build --release --target wasm32v1-none
```

If you added or renumbered a `PaymentError` variant, also run
`npm run generate-errors` (see [ERRORS.md](./ERRORS.md)) — the TypeScript
catalogs are checked against the Rust enum in `npm run typecheck`.
