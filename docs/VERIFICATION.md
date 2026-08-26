# OphirPay Formal Verification

> ⚠️ **Honest status (2026-08-14):** the Kani harnesses in `contracts/ophirpay/spec/`
> verify **hand-written models** that share no code with the deployed `OphirPayContract`.
> They are not run in CI, and several are tautological. The table below documents
> *modeled intent* — it is **not** proof of the deployed contract, and OphirPay must
> **not** be presented as "formally verified" until real harnesses against the contract
> (or an independent audit) exist. See [docs/AUDIT.md](AUDIT.md) HIGH-2.

This document describes how to run the Kani harnesses and the roadmap toward real
formal verification of the OphirPay smart contracts using
[Kani Rust Verifier](https://model-checking.github.io/kani/).

## Modeled Invariants (not proofs of the deployed contract)

| # | Invariant | Modeled Property |
|---|-----------|----------|
| **1** | **LOCKED_BALANCE Protection** | `emergency_withdraw(amount)` succeeds iff `amount ≤ contract_balance - LOCKED_BALANCE`. Prevents owner from draining user-deposited funds (escrows, streams, proposal deposits) even with a compromised owner key. |
| **2** | **One Address = One Vote** | Each address can vote at most once per governance proposal. Prevents the self-reported-weight attack. |
| **3** | **Reentrancy Lock Atomicity** | The `REENTRANCY_LOCK` prevents re-entering the contract during cross-contract calls (`emergency_pause_all`, `emergency_unpause_all`, `emergency_withdraw`). |
| **4** | **Proposal Deposit Lifecycle** | Deposit is always refunded on `execute_proposal()` (pass or fail). `LOCKED_BALANCE += deposit` on create, `LOCKED_BALANCE -= deposit` on execute. Net change = 0 after full cycle. |
| **5** | **Fee Cap (10% max)** | No fee config field (`payment_fee_bps`, `escrow_fee_bps`, `stream_fee_bps`) can exceed 1000 bps (10%). Enforced in `set_fee_config()`. |
| **6** | **Multisig Threshold** | `execute_approved_payment(request_id)` succeeds iff `approvals.len() >= config.threshold`. N-of-M enforcement. |
| **7** | **Timelock 24h Delay** | `execute_timelocked_action()` succeeds iff `now >= proposed_at + 86400`. Exact 24-hour enforcement. |
| **8** | **Spending Limit Expiry** | `atomic_spend()` rejects if limit is inactive, expired (`now >= expires_at`), or daily/monthly caps are exceeded. |
| **9** | **Composite: LOCKED_BALANCE + Deposit** | Cross-invariant proof that invariants 1 and 4 are consistent: proposal deposit is locked and refunded correctly. |
| **10** | **compute_vested No Overflow** | Linear vesting uses `checked_mul` — overflow returns 0 (safe default). Vested amount never exceeds total. |

## Quickstart

### 1. Install Prerequisites

```bash
# Rust toolchain (use the project's pinned toolchain)
rustup install $(cat contracts/rust-toolchain.toml | grep channel | cut -d'"' -f2)
rustup target add wasm32-unknown-unknown
rustup component add rust-src

# Kani Rust Verifier
cargo install kani-verifier
cargo kani setup
```

### 2. Run All Proofs

```bash
cd contracts/ophirpay
cargo kani --harness all
```

Expected output:
```
VERIFICATION:- SUCCESSFUL
  - locked_balance_invariant
  - one_vote_per_address_invariant
  - reentrancy_lock_invariant
  - proposal_deposit_lifecycle
  - fee_cap_invariant
  - multisig_threshold_invariant
  - timelock_delay_invariant
  - spending_limit_expiry_invariant
  - composite_locked_balance_and_deposit
  - compute_vested_no_overflow
```

### 3. Run Individual Invariants

```bash
# Verify only the LOCKED_BALANCE invariant (fast, ~2s)
cargo kani --harness locked_balance_invariant

# Verify only the fee cap invariant
cargo kani --harness fee_cap_invariant

# Verify only the multisig threshold invariant
cargo kani --harness multisig_threshold_invariant

# Verify only the spending limit expiry
cargo kani --harness spending_limit_expiry_invariant
```

### 4. Generate Coverage Report

```bash
cargo kani --coverage --harness all
```

## Adding New Invariants

To add a new invariant:

1. Identify the property you want to prove (e.g., "escrow can never be released twice")
2. Model the relevant contract functions as pure Rust functions
3. Write a `#[kani::proof]` harness using `kani::any()` for symbolic inputs
4. Use `kani::assume()` to constrain inputs to valid ranges
5. Add `assert!()` statements for the properties you want to prove

Example template:

```rust
#[kani::proof]
fn my_new_invariant() {
    let input: u64 = kani::any();
    kani::assume(input > 0);
    kani::assume(input < 10_000);

    let result = my_model_function(input);

    // Property: result is always non-negative
    assert!(result >= 0);

    // Property: result never exceeds input * 2
    assert!(result <= input * 2);
}
```

## Certora Sunbeam (Alternative)

If you prefer Certora (produces auditor-friendly web reports), the same invariants
can be expressed in Certora Verification Language (CVL). Contact Certora for the
Soroban prover and use these CVL specs:

```cvl
rule lockedBalanceInvariant(method f) {
    env e;
    uint256 amount;
    uint256 lockedBefore = lockedBalance(e);
    uint256 contractBalBefore = tokenBalance(e, asset);

    // Call emergency_withdraw
    f(e, amount);

    uint256 lockedAfter = lockedBalance(e);
    uint256 contractBalAfter = tokenBalance(e, asset);

    // INVARIANT: locked balance is unchanged by emergency_withdraw
    // (only unlocked funds can be withdrawn)
    assert lockedAfter == lockedBefore,
        "LOCKED_BALANCE must not decrease during emergency_withdraw";
}
```

## Komet (Runtime Verification)

```bash
# Install
kup install komet

# Run fuzzing
komet test --contract contracts/ophirpay

# Run symbolic execution
komet prove run --contract contracts/ophirpay \
    --invariant locked_balance_invariant \
    --invariant one_vote_per_address_invariant
```

## Running in CI

Add to `.github/workflows/ci.yml`:

```yaml
formal-verification:
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v4
    - uses: actions-rust-lang/setup-rust-toolchain@v1
    - name: Install Kani
      run: |
        cargo install kani-verifier
        cargo kani setup
    - name: Run formal verification
      run: cd contracts/ophirpay && cargo kani --harness all
    - name: Upload verification report
      uses: actions/upload-artifact@v4
      with:
        name: formal-verification-report
        path: contracts/ophirpay/target/kani/
```

## Interpreting Results

| Kani Output | Meaning |
|---|---|
| `VERIFICATION:- SUCCESSFUL` | ✅ Property proved for ALL possible inputs |
| `VERIFICATION:- FAILED` | ❌ Counterexample found — Kani will show the exact inputs that violate the invariant |
| `VERIFICATION:- UNDETERMINED` | ⚠️ Kani ran out of resources — try increasing `--unwind` or simplifying the property |

### When a proof FAILS

```bash
# Kani will output a concrete counterexample like:
# Check 3: locked_balance_invariant.assertion.1
#   - Status: FAILURE
#   - Description: "locked balance must never go negative"
#   - Location: invariants.rs:85:5
#   - Failure: contract_balance = 100, locked_balance = 200, withdraw_amount = 50
```

This means the invariant is broken. Fix the contract code, then re-run Kani.

## Timeline

| Phase | Duration | Description |
|---|---|---|
| Setup | 1 day | Install Kani, configure Rust toolchain |
| Existing invariants | 1 day | Run all 10 harnesses, fix any failures |
| New invariants | 1-3 weeks | Add proofs for escrow, streams, batches, hooks, RBAC |
| Certora/Komet | 1-2 weeks | Port to Certora for web reports (optional) |
| CI integration | 1 day | Add to GitHub Actions pipeline |
