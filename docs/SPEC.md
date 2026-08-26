# OphirPay — Contract Specification & Invariants

## Overview

This document defines the formal invariants that the OphirPay Soroban contract
MUST maintain across all operations. These invariants serve as the foundation
for testing, auditing, and formal verification.

---

## Core Invariants

### INV-1: No Reinitialization

**Statement:** The contract SHALL be initialized exactly once. Calling `init()`
after the first successful initialization MUST return `AlreadyInitialized`.

**Code evidence:** `init()` checks `env.storage().instance().has(&OWNER)` before
setting state. The `OWNER` key acts as a sentinel — its presence means the
contract is already initialized.

**Test:** `test_init_twice_fails` — verifies second `init()` call returns error.

---

### INV-2: Two-Step Ownership Transfer with Timelock

**Statement:** The contract owner CANNOT be changed without:
1. The current owner proposing a new owner (`transfer_ownership`)
2. A 24-hour timelock elapsing (86,400 ledger seconds)
3. The proposed new owner accepting (`accept_ownership`)

A pending transfer can be cancelled by the current owner at any time before
acceptance. After acceptance, the old owner has zero authority.

**Code evidence:**
- `transfer_ownership()` sets `PENDING_OWNER` and `OWNER_PROPOSED_AT` (timestamp)
- `accept_ownership()` checks `caller == pending_owner` AND
  `now - proposed_at >= 86400`
- `cancel_ownership_transfer()` clears both keys (current owner only)

**Test:** `test_two_step_ownership` — verifies:
- Non-owner cannot propose
- New owner cannot accept before 24h
- New owner can accept after 24h
- Old owner loses access after transfer

---

### INV-3: Locked-Funds Protection (emergency_withdraw)

**Statement:** The `emergency_withdraw()` function MUST NOT allow the owner to
withdraw tokens that are locked in active escrows or streams. The invariant is:

```
withdraw_amount <= token_balance - locked_balance
```

where `locked_balance` is the sum of all funds deposited via `create_escrow`
and `create_stream`, minus funds released via `release_escrow`, `claim_escrow`,
`claim_stream`, and `cancel_stream`.

**Code evidence:**
- `add_locked(env, amount)` is called after each `token_client.transfer()` that
  deposits funds into the contract (escrow creation, stream creation)
- `add_locked(env, -amount)` is called before each `token_client.transfer()`
  that withdraws funds (escrow release/claim, stream claim/cancel)
- `emergency_withdraw()` reads `LOCKED_BALANCE` and compares:
  `if amount > unlocked { return Err(NoTokensToWithdraw); }`

**Test:** `test_emergency_withdraw_locked_funds` — verifies:
- Owner CAN withdraw accidentally-sent (unlocked) funds
- Owner CANNOT withdraw funds locked in an active escrow
- After escrow released, locked balance decreases accordingly

---

### INV-4: Escrow Single-Release

**Statement:** An escrow's funds SHALL be released at most once. After
`released = true`, any subsequent call to `release_escrow()`, `claim_escrow()`,
or `arbiter_release_escrow()` MUST return an error (`EscrowAlreadyReleased` or
`EscrowAlreadyReleased`).

**Code evidence:**
- `release_escrow()`: checks `escrow.released` before transferring
- `claim_escrow()`: checks `escrow.released` before transferring
- `arbiter_release_escrow()`: checks `escrow.released` before transferring
- Each sets `escrow.released = true` after the token transfer

**Test:** `test_escrow_single_release` and `test_escrow_cannot_double_claim`

---

### INV-5: Stream Claim ≤ Vested Amount

**Statement:** A stream recipient SHALL never claim more than the linearly
vested amount at any given time. The claimable amount is:

```
claimable = min(total_amount, (now - start) / (end - start) * total_amount) - claimed_amount
```

After the stream end time, the full remaining amount is claimable.

**Code evidence:** `compute_vested()` uses checked multiplication with overflow
protection. `claim_stream()` computes `claimable = vested - stream.claimed_amount`
and returns `StreamFullyClaimed` if `claimable == 0`.

**Test:** `test_stream_vesting_math` — verifies partial claims at 25%, 50%, 75%
and that full amount is claimable after end time.

---

### INV-6: Multisig Threshold Enforcement

**Statement:** A multisig payment proposal SHALL NOT be executed unless the
number of unique approvals meets or exceeds the configured threshold.
Duplicate approvals from the same signer MUST be rejected.

**Code evidence:**
- `approve_payment()` checks `request.approvals.iter().any(|a| a == signer)`
  for duplicates, returning `AlreadyApproved`
- `execute_approved_payment()` checks `request.approvals.len() >= config.threshold`,
  returning `ThresholdNotMet`

**Test:** `test_multisig_threshold_enforcement` — verifies:
- Below threshold → `ThresholdNotMet`
- At threshold → executes successfully
- Duplicate approval → `AlreadyApproved`

---

### INV-7: Pause Blocks All Mutations

**Statement:** When the contract is paused (`PAUSED = true`), all
state-mutating functions MUST return `ContractPaused`. Read-only functions
(getters) SHALL continue to work.

**Code evidence:** `require_not_paused()` is called at the beginning of every
write function. It reads the `PAUSED` instance key and returns
`ContractPaused` if true.

**Test:** `test_pause_blocks_writes` — verifies all mutating functions reject
when paused, and all getters still return data.

---

### INV-8: Payment Immutability (After Recording)

**Statement:** Once a payment is recorded, its core fields (payer, payee,
amount, asset, tx_hash) SHALL NOT be modified. The only allowed mutation is
`cancelled: false → true` via `cancel_payment()`.

**Code evidence:** Payments are stored as persistent entries keyed by ID.
There is no `update_payment()` function. `cancel_payment()` sets
`payment.cancelled = true` and returns `PaymentAlreadyCancelled` if already
cancelled.

**Test:** `test_cancel_payment_idempotent`

---

### INV-9: Fee Calculation is Pure (Zero Side Effects)

**Statement:** `calculate_fee()` SHALL be a pure function — it reads no
storage, writes no storage, and emits no events. Calling it with the same
arguments always returns the same result.

**Code evidence:** `calculate_fee(amount: i128, fee_bps: u32) -> i128` has
no `env` parameter and contains only arithmetic operations.

**Test:** `test_calculate_fee_pure` — verifies same inputs produce same output
and no state is modified.

---

### INV-10: Version History is Append-Only (Capped at 100)

**Statement:** Fee configuration and multisig configuration version histories
SHALL grow monotonically (never shrink or be deleted) and SHALL be capped at
100 entries in query results to prevent unbounded gas consumption.

**Code evidence:**
- `set_fee_config()` creates a new `FeeConfigVersion` with `ver_count += 1`
- `set_multisig_config()` creates a new `MultisigVersion` similarly
- `get_fee_config_history()` and `get_multisig_config_history()` compute
  `start = if total > 100 { total - 99 } else { 1 }` and return at most 100

**Test:** `test_version_history_capped` — verifies that after 150 config
changes, only the latest 100 are returned.

---

## State Transition Diagram

```
                    ┌──────────┐
                    │   init   │ (once)
                    └────┬─────┘
                         │
                    ┌────▼─────┐
          ┌────────│  Active  │◄─────────┐
          │        └────┬─────┘          │
          │             │                 │
     pause_all     ┌────┼────┐     unpause_all
          │        │    │    │           │
          ▼        │    │    │           │
     ┌────────┐    │    │    │    ┌──────────┐
     │ Paused │    │    │    │    │ Upgraded │
     └────────┘    │    │    │    └──────────┘
                   │    │    │          ▲
    create_escrow──┘    │    └──execute_upgrade
    create_stream       │
    record_payment      │
    create_batch────────┘
```

---

## Testing Strategy

Each invariant is verified by at least one unit test in the contract's
`#[test]` module. See `contracts/ophirpay/src/lib.rs` (lines ~2960+).

To run tests (soroban-sdk 27 — the env-host conflict from v22.1.3 is fixed):
```bash
cd contracts/ophirpay && cargo test   # unit tests, native host
cd contracts/emitter && cargo test    # unit tests, native host
```

## Future Verification Work

- [ ] Fuzz testing with `proptest` for edge cases (zero amounts, max values)
- [ ] Bounded model checking with `kani` for the 5 highest-risk invariants
- [ ] Formal verification of the `compute_vested()` function (overflow safety)
- [ ] Third-party security audit before mainnet deployment
