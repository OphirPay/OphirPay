# OphirPay Contract Verification & Formal Invariants

> **Status (Updated):** Invariant verification harnesses execute directly against the
> deployed `OphirPayContract` inside Soroban's native test environment (`soroban_sdk::Env`).
> These harnesses prove critical fund-safety, escrow single-release, bounded stream vesting,
> refund authorization, and pause isolation directly on contract bytecode.
> Verification runs in CI on every pull request, and a structured verification report is published
> as a build artifact. Pure Rust reference models in `contracts/ophirpay/spec/` provide supplementary
> arithmetic and state-machine proofs. See [docs/AUDIT.md](AUDIT.md) HIGH-2.

---

## 1. What is Proven vs. Modeled

| Property | Level of Proof | Target | Verification Method |
|---|---|---|---|
| **LOCKED_BALANCE Fund Safety** | **Contract Code** | `contracts/ophirpay/src/lib.rs` | `tests/contract_invariants.rs::invariant_locked_balance_fund_safety_conservation` |
| **Escrow Single-Release** | **Contract Code** | `contracts/ophirpay/src/lib.rs` | `tests/contract_invariants.rs::invariant_escrow_single_release` |
| **Stream Bounded Linear Vesting** | **Contract Code** | `contracts/ophirpay/src/lib.rs` | `tests/contract_invariants.rs::invariant_stream_claim_bounded_by_vested_amount` |
| **Refund Path Bounds & Authorization** | **Contract Code** | `contracts/ophirpay/src/lib.rs` | `tests/contract_invariants.rs::invariant_refund_paths_bounded_and_authorized` |
| **Pause Guard Isolation** | **Contract Code** | `contracts/ophirpay/src/lib.rs` | `tests/contract_invariants.rs::invariant_pause_guard_blocks_all_mutating_entrypoints` |
| **One Address = One Vote** | **Contract Code** | `contracts/ophirpay/src/lib.rs` | `tests/contract_invariants.rs::invariant_governance_single_vote_per_address` |
| **Spending Limit Expiry & Resets** | **Reference Model & Contract** | `spec/src/invariants.rs` & `src/lib.rs` | `tests/contract_invariants.rs::invariant_pause_guard_blocks_all_mutating_entrypoints` & `spec::spending_limit_expiry_invariant` |
| **Reentrancy Lock State Machine** | **Reference Model & Contract** | `spec/src/invariants.rs` & `tests/proptest_token_moving.rs` | `tests/proptest_token_moving.rs::test_reentrancy_lock_*` & `spec::reentrancy_lock_invariant` |
| **Fee Cap (<= 1000 bps)** | **Reference Model & Contract** | `spec/src/invariants.rs` & `src/lib.rs` | `tests/fee_report.rs` & `spec::fee_cap_invariant` |
| **Timelock Delay (24h Monotonicity)** | **Reference Model** | `spec/src/invariants.rs` | `spec::timelock_delay_invariant` |

---

## 2. Real Contract Invariants (Soroban Test Environment)

The contract invariant suite in `contracts/ophirpay/tests/contract_invariants.rs` drives the real `OphirPayContract` via `OphirPayContractClient` inside `soroban_sdk::Env`:

### Invariant 1: LOCKED_BALANCE Fund Safety & Conservation
- **Invariant Statement:** `LOCKED_BALANCE >= 0` at all times, and `emergency_withdraw(amount)` fails with `PaymentError::NoTokensToWithdraw` whenever `amount > contract_balance - LOCKED_BALANCE`.
- **Guarantee:** Contract owner can **never** extract user-deposited funds (escrows, streams, governance deposits), even if owner private keys are fully compromised.
- **Conservation:** Over full lifecycle (create escrow/stream/proposal -> resolve/refund), `LOCKED_BALANCE` increments and decrements by exact stroop amounts, returning to 0 with zero leakage.

### Invariant 2: Refund Path Integrity & Authorization
- **Invariant Statement:** `request_refund` rejects any caller other than `payment.payer` or `payment.payee` with `PaymentError::Unauthorized`.
- **Bounds:** Refund request amounts exceeding `payment.amount` are rejected with `PaymentError::InvalidAmount`. Asset addresses mismatching `payment.asset` are rejected with `PaymentError::AssetNotSupported`.
- **Single-Execution:** Approved refunds can only be processed once; subsequent `process_refund` calls fail with `PaymentError::RefundAlreadyProcessed`.

### Invariant 3: Escrow Single-Release
- **Invariant Statement:** An escrow can result in at most one token disbursement across its entire lifecycle.
- **Guarantee:** 
  - If released by owner, subsequent release attempts by owner or arbiter fail with `PaymentError::EscrowAlreadyReleased`.
  - Beneficiary claims after release fail with `PaymentError::EscrowAlreadyReleased`.
  - Beneficiary claims after deadline cannot be double-claimed or subsequently released.

### Invariant 4: Stream Bounded Linear Vesting
- **Invariant Statement:** Claims before `stream.start_time` fail with `PaymentError::StreamNotStarted`.
- **Vesting Guarantee:** At any timestamp `t`, cumulative claimed tokens cannot exceed `compute_vested(total_amount, start_time, end_time, t)`.
- **Lifetime Cap:** Total claimed tokens across all partial claims can never exceed `stream.total_amount`. Claims after 100% vesting fail with `PaymentError::StreamFullyClaimed`.
- **Cancellation Conservation:** When creator cancels an active stream, unvested tokens are returned to creator and vested tokens remain with recipient; `claimed + refunded == total_amount` holds with exact precision.

### Invariant 5: Pause Guard Isolation
- **Invariant Statement:** When emergency pause is active (`emergency_pause_all`), all 15 mutating entrypoints (`record_payment`, `create_escrow`, `release_escrow`, `claim_escrow`, `create_stream`, `claim_stream`, `cancel_stream`, `create_batch`, `request_refund`, `approve_refund`, `reject_refund`, `process_refund`, `atomic_spend`, `create_proposal`, `vote_on_proposal`) strictly revert with `PaymentError::ContractPaused`.
- **Read Availability:** Read-only getters (`get_owner`, `get_payment_count`, `get_locked_balance`, `is_paused`) remain functional. Unpausing restores mutations safely.

### Invariant 6: One Address = One Vote
- **Invariant Statement:** Each address votes at most once per governance proposal.
- **Guarantee:** Calling `vote_on_proposal` a second time with the same voter address (regardless of vote direction) strictly reverts with `PaymentError::AlreadyVoted`.

---

## 3. Why Symbolic Model Checking (Kani) is Model-Only for Soroban Host

Kani uses CBMC (C Bounded Model Checker) to translate Rust MIR into bitvector satisfiability formulas. The Soroban SDK environment (`soroban_sdk::Env`) instantiates a full Soroban host runtime, including host memory objects, reference-counted containers, and host FFI bindings.

Attempting to run CBMC symbolic unwinding directly across the Soroban host runtime causes state-space exhaustion (out-of-memory or unbounded loop unrolling). Therefore:
- The actual contract logic is verified using Soroban's test host environment harnesses (`tests/contract_invariants.rs` and `tests/proptest_token_moving.rs`).
- Pure mathematical reference models in `contracts/ophirpay/spec/` check pure arithmetic properties and state machines without host dependencies.
- Tautological models (such as `model_vote(voted) = !voted`) are explicitly documented as reference-only and replaced by real storage verification in the contract test harness.

---

## 4. Running Verification Locally

### Real Contract Verification Harness
```bash
# Run via npm script
npm run verify:contracts

# Or directly with Cargo
cd contracts/ophirpay
cargo test --test contract_invariants -- --nocapture
```

### Reference Models (`spec/`)
```bash
# Run unit checks on reference models
cargo test --manifest-path contracts/ophirpay/spec/Cargo.toml

# Or run with Kani (if kani-verifier is installed)
cargo kani --manifest-path contracts/ophirpay/spec/Cargo.toml --harness all
```

---

## 5. CI Pipeline & Published Artifacts

In `.github/workflows/ci.yml` (under the `contract-wasm` job):
1. `cargo test` executes the complete test suite including all 6 contract invariant verification harnesses.
2. `node scripts/run-contract-verification.mjs` executes both real contract harnesses and reference models.
3. Verification results are saved to:
   - `formal-verification-report.json` (machine-readable)
   - `formal-verification-report.md` (human-readable, appended to `$GITHUB_STEP_SUMMARY`)
4. The reports are uploaded as a GitHub Actions artifact named `formal-verification-report`.
