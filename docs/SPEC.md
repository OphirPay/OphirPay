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

**Code evidence:** `compute_vested()` evaluates `total_amount * elapsed` at
256-bit precision: `i128::checked_mul` on the fast path, and the quotient/
remainder decomposition `(a / d) * b + ((a % d) * b) / d` when the 128-bit
product would overflow. The result is therefore always the exact linear vesting
value and is bounded by `total_amount`.

Overflow MUST NOT collapse the vested amount to `0` (which silently under-vests
a large stream) and MUST NOT cap it at `total_amount` (which would over-vest a
stream that is only partially elapsed).

`claim_stream()` computes `claimable = vested.checked_sub(stream.claimed_amount)`,
returning `StreamInvariantViolated` (307) if the subtraction would be negative
and `StreamFullyClaimed` if `claimable == 0`.

**Test:** `test_create_and_claim_stream` — verifies partial claims at 50% and
that the full amount is claimable after end time. Overflow behaviour is covered
by `test_compute_vested_overflow_is_exact_and_not_zero`,
`test_compute_vested_overflow_is_bounded_and_monotonic`,
`test_compute_vested_overflow_fully_vests_at_end`,
`test_claim_stream_with_overflowing_vesting_pays_correct_balance` and the
end-to-end `test_stream_vesting_overflow_pays_correct_balance_end_to_end`.

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

### INV-7: Pause Blocks Mutations (Global Override + Scopes)

**Statement:** When the contract is globally paused (`PAUSED = true`), all
state-mutating functions MUST return `ContractPaused`; read-only functions
(getters) SHALL continue to work. Independently, a single feature scope can be
paused so only that subsystem's mutating entrypoints return `ContractPaused`.
The global pause always overrides the scope flags, so a scope can never
re-enable a write while the contract is globally paused.

**Scopes:** `PauseScope` enumerates eight feature domains exposed by numeric id:
`Payments = 0`, `Escrows = 1`, `Streams = 2`, `Recurring = 3`, `Refunds = 4`,
`Governance = 5`, `Hooks = 6`, `Batches = 7`.

**Code evidence:**
- `require_not_paused(env, scope)` starts every write function. It returns
  `ContractPaused` when the global `PAUSED` flag is set **or** when that
  operation's scope is paused; the global check runs first, so it overrides.
- `set_scope_paused(caller, scope, paused)` is owner-only, stores one instance
  flag per scope and records a `scope_paused` / `scope_resumed` audit entry.
  Unknown scope ids are rejected with `InvalidPauseScope`.
- `is_scope_paused(scope)` and `get_paused_scopes()` expose the scope flags to
  the read API without a signature.
- `emergency_pause_all` / `emergency_unpause_all` keep their atomic
  cross-contract propagation to the Emitter and only toggle the global flag, so
  scope flags are preserved across an emergency unpause.

**Test:**
- `test_pause_blocks_record_payment`, `test_pause_blocks_create_escrow` and
  `test_pause_blocks_create_stream` — a global pause rejects writes while
  getters keep returning data.
- `test_paused_contract_blocks_payments` (integration) — a globally paused
  contract rejects `record_payment` and accepts it again after unpause.
- `test_scoped_pause_blocks_only_that_scope` (integration) — pausing `Payments`
  blocks `record_payment` while escrows and getters keep working, and resuming
  the scope restores payments.
- `test_global_pause_overrides_scopes` (integration) — with no scope flag set,
  `emergency_pause_all` blocks both payments and escrows while getters still
  answer.
- `test_unknown_pause_scope_is_rejected` (integration) — `set_scope_paused(8, …)`
  and `is_scope_paused(8)` return `InvalidPauseScope`.

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

### INV-11: Enumeration is Bounded and Reports Truncation

**Statement:** Every read-only function that enumerates a stored collection
SHALL return at most `MAX_READER_ENTRIES` (100) entries and SHALL expose
whether the result was truncated. A reader MUST NOT walk an arbitrarily long
stored vector inside a single invocation.

The bounded readers are:

| Reader | Result type | Cap | Order | Truncation field |
|---|---|---|---|---|
| `get_audit_log_range(start_id, end_id)` | `Vec<AuditEntry>` | 100 | most recent first | *(inherent in the requested range)* |
| `get_payments_range(start_id, end_id)` | `Vec<Payment>` | 100 | most recent first | *(inherent in the requested range)* |
| `get_reason_code_analytics()` | `Vec<(u32, u64)>` | 100 most recent refunds | n/a | *(aggregate)* |
| `get_fee_config_history()` / `get_multisig_config_history()` | `Vec<…Version>` | 100 | most recent first | *(inherent in the requested range)* |
| `get_payments_by_batch(batch_id)` | `PaymentList` | 100 | most recent first | `truncated` |
| `get_subscriber_hooks(subscriber)` | `HookList` | 100 | most recent first | `truncated` |

`PaymentList` and `HookList` carry `items`, `total` (how many entries the
underlying collection actually holds) and `truncated` (true only when the
reader stopped before exhausting the collection). Callers MUST treat
`truncated == true` as partial data: page, or ask for a narrower query.

The upstream collections are **not** self-bounding. `register_hook` places no
limit on how many hooks a subscriber accumulates, and a batch record written
before the `BatchTooLarge` guard existed can hold more payment ids than
`create_batch` accepts today. The cap therefore lives in the reader, not in the
writer's current validation.

**Rationale:** docs/AUDIT.md MEDIUM-2 — unbounded enumeration makes an
endpoint unreliable (instruction-budget exhaustion) rather than returning a
clean error.

**Tests:** `test_get_subscriber_hooks_caps_and_flags_truncation`,
`test_get_subscriber_hooks_at_cap_is_not_truncated`,
`test_get_payments_by_batch_caps_and_flags_truncation`,
`test_get_payments_by_batch_within_cap_is_not_truncated`

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

Each invariant is verified by unit tests, property-based proptests, and integration harnesses:
- **Unit Tests**: `contracts/ophirpay/src/lib.rs` (lines ~3840+)
- **Proptest Suite**: `contracts/ophirpay/tests/proptest_token_moving.rs` (fuzzing token paths, reentrancy-shaped sequences, and `LOCKED_BALANCE` conservation)
- **Integration Tests**: `contracts/ophirpay/tests/integration/` (end-to-end multi-contract flows)

To run tests:
```bash
cd contracts/ophirpay && cargo test                             # unit tests & in-crate property tests
cd contracts/ophirpay && cargo test --test proptest_token_moving # dedicated proptest suite
cd contracts/emitter && cargo test                              # emitter unit tests
```

## Future Verification Work

- [x] Property testing with `proptest` for token-moving paths & reentrancy sequences (`LOCKED_BALANCE` conservation)
- [ ] Bounded model checking with `kani` for the 5 highest-risk invariants
- [ ] Formal verification of the `compute_vested()` function (overflow safety).
      The boundary branches are modelled in `contracts/ophirpay/spec/src/invariants.rs`,
      but the widened multiply path is not yet machine-checked — see the Kani
      findings in [AUDIT.md](./AUDIT.md).
- [ ] Third-party security audit before mainnet deployment
