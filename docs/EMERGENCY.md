# 🚨 Emergency Operations Runbook

> Audience: the contract owner and the on-call engineer. This is the
> step-by-step procedure for pausing OphirPay, queuing or cancelling
> timelocked admin actions, rolling back an upgrade, and rotating ownership
> during an incident. Every panic button in `contracts/ophirpay` and
> `contracts/emitter` is covered here.
>
> **Read §1 before you need it.** During an incident you will not have time to
> learn the CLI. Rehearse the pause path on testnet first.

- [0. Before you begin](#0-before-you-begin)
- [1. Panic button: pause everything](#1-panic-button-pause-everything)
- [2. Resume operations](#2-resume-operations)
- [3. Pause one subsystem (scope pause)](#3-pause-one-subsystem-scope-pause)
- [4. Timelocked admin actions](#4-timelocked-admin-actions)
- [5. Contract upgrades and rollback](#5-contract-upgrades-and-rollback)
- [6. Ownership rotation](#6-ownership-rotation)
- [7. Emergency withdraw (unlocked funds only)](#7-emergency-withdraw-unlocked-funds-only)
- [8. After the incident](#8-after-the-incident)
- [Appendix: error codes you will see](#appendix-error-codes-you-will-see)

---

## 0. Before you begin

### Who can act

Every state-changing control below is **owner-only** on the contract:
`caller.require_auth()` followed by `require_owner`. The "owner" is the address
stored by `init(owner)` and readable with `get_owner()`.

The contract sees the owner as a single Stellar `Address`. N-of-M approval
("multisig signers") is therefore enforced **at the Stellar account level**:
make the owner address a multisig account (`set_options` with a medium
threshold of N-of-M) and every contract invocation must collect N signatures
before the protocol will accept it. Recommended production posture:

| Control                  | Where it is enforced                              | Notes                                                                                |
| ------------------------ | ------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Owner authentication     | Stellar account thresholds                        | Use a 2-of-3 or 3-of-5 Stellar multisig account as the owner; never a single hot key |
| Sensitive config changes | 24h contract timelock (`TMLOCK_DELAY = 86_400` s) | Fee config, multisig config, RBAC grants, governance config, spending limits         |
| Emergency pause          | Immediate, owner-only                             | Deliberately **not** timelocked — minutes matter                                     |
| Upgrades                 | 24h timelock, cancellable by owner                | `propose_upgrade` → wait → `execute_upgrade`                                         |
| Ownership transfer       | 24h timelock + acceptance by the new owner        | Two-step, cannot be completed by the current owner alone                             |

### One invariant that makes or breaks the pause

`emergency_pause_all` pauses OphirPay **and** calls `pause` on the linked
emitter contract, atomically. The emitter only accepts `pause` from **its own
owner** (or the allow-listed source). Consequences:

- The main contract's owner and the emitter's owner **must be the same
  account**, and `ALLOWED_SOURCE` on the emitter must be set to the main
  contract (or left unset).
- If the emitter call fails — wrong owner, unset `ALLOWED_SOURCE`, emitter not
  initialised — the **whole transaction reverts**, including the main pause.
  There is no partial pause to clean up; fix the emitter ownership/allow-list
  and retry.
- `scripts/verify-deployment.sh` checks this alignment. Run it after every
  deploy; an unaligned emitter is a pause button that does not work.

### Prerequisites

- [Stellar CLI](https://developers.stellar.org/docs/tools/cli) installed
  (`scripts/setup-soroban-env.sh` checks it).
- The owner key available to the CLI — a key name (`stellar keys ls`) or a
  hardware signer. With a multisig owner, collect the required signatures.
- Contract IDs from the deployment registry (`docs/MAINNET_RUNBOOK.md`,
  §Phase 4) or `.env`:

  ```bash
  export OPHIRPAY=CCQGGUJRRVXMHNEX2RYPODGJE2YRMYY4Y7A3KTJH3QP2LWZLTCOPRPET  # testnet
  export EMITTER=CDAVU2XJ7C2Y52GRJZKRG3HDI7AJ2K2FHAFH5FPDTSUQAV7XNBQNNVAN  # testnet
  export OWNER=<stellar-key-name-or-G-address>
  export NET=testnet   # or: public
  ```

- Read-only sanity check before any write — you should see the same address
  for both owners and the emitter linked to OphirPay:

  ```bash
  stellar contract invoke --id "$OPHIRPAY" --network "$NET" -- get_owner
  stellar contract invoke --id "$EMITTER"  --network "$NET" -- get_owner
  stellar contract invoke --id "$OPHIRPAY" --network "$NET" -- get_emitter

  stellar contract invoke --id "$OPHIRPAY" --network "$NET" -- is_paused
  stellar contract invoke --id "$EMITTER"  --network "$NET" -- is_paused
  ```

> ⚠️ Test every command below on **testnet** in a rehearsal before an incident.
> Mainnet commands are identical with `NET=public` and the mainnet contract IDs.

---

## 1. Panic button: pause everything

**Use when:** funds are at risk, an exploit is in progress, or a faulty
deployment is moving value. This is the fastest containment action.

1. **Tell the incident channel you are pausing** (see [SECURITY.md](../SECURITY.md)
   for the reporting/escalation path). Pausing stops payment recording,
   escrow/stream state changes, batches, refunds and governance execution.
2. **Pause both contracts atomically as the owner** (use the owner key/M-of-N
   signers):

   ```bash
   stellar contract invoke \
     --id "$OPHIRPAY" \
     --source-account "$OWNER" \
     --network "$NET" \
     -- emergency_pause_all --caller "$OWNER"
   ```

   The call pauses OphirPay (`is_paused() == true`, `PAUSE_ALL` capability) and
   cross-invokes `pause(caller)` on the emitter. Reads are unaffected;
   state-changing entrypoints fail with `ContractPaused` (`18`).

3. **Verify immediately** (both must be `true`):

   ```bash
   stellar contract invoke --id "$OPHIRPAY" --network "$NET" -- is_paused
   stellar contract invoke --id "$EMITTER"  --network "$NET" -- is_paused
   ```

4. **Check the audit trail:** the pause writes `emergency_pause_all` to the
   on-chain audit log:

   ```bash
   stellar contract invoke --id "$OPHIRPAY" --network "$NET" -- get_audit_log_count
   stellar contract invoke --id "$OPHIRPAY" --network "$NET" \
     -- get_audit_entry --entry_id <COUNT_MINUS_1>
   ```

If the transaction reverts, the cause is almost always the emitter ownership
invariant in §0. Do **not** retry blindly: check both `get_owner()` values and
the emitter's `get_allowed_source()`, fix the misalignment, then retry. If the
emitter cannot be paused by the same owner, pause the emitter separately with
its own owner and then retry the main pause.

---

## 2. Resume operations

**Use only after** the root cause is understood, a fix (or config change) is
deployed, and monitoring is watching the affected metric. Unpausing into an
active exploit repeats the incident.

```bash
stellar contract invoke \
  --id "$OPHIRPAY" \
  --source-account "$OWNER" \
  --network "$NET" \
  -- emergency_unpause_all --caller "$OWNER"

# Verify both contracts
stellar contract invoke --id "$OPHIRPAY" --network "$NET" -- is_paused   # false
stellar contract invoke --id "$EMITTER"  --network "$NET" -- is_paused   # false
```

If only one subsystem was faulty, prefer the narrower **scope pause** (§3):
a global pause blocks everything, including incident-response payments.

---

## 3. Pause one subsystem (scope pause)

The contract has eight independently pausable scopes. A scope pause keeps the
rest of the protocol live; the global emergency pause still overrides every
scope, so a scope flag can never re-enable writes while the whole contract is
paused.

| Scope id | Subsystem          |
| -------- | ------------------ |
| `0`      | Payments           |
| `1`      | Escrows            |
| `2`      | Streams            |
| `3`      | Recurring payments |
| `4`      | Refunds            |
| `5`      | Governance         |
| `6`      | Notification hooks |
| `7`      | Batches            |

```bash
# Pause escrow creation/release only
stellar contract invoke \
  --id "$OPHIRPAY" --source-account "$OWNER" --network "$NET" \
  -- set_scope_paused --caller "$OWNER" --scope 1 --paused true

# Inspect
stellar contract invoke --id "$OPHIRPAY" --network "$NET" -- is_scope_paused --scope 1
stellar contract invoke --id "$OPHIRPAY" --network "$NET" -- get_paused_scopes

# Resume that scope
stellar contract invoke \
  --id "$OPHIRPAY" --source-account "$OWNER" --network "$NET" \
  -- set_scope_paused --caller "$OWNER" --scope 1 --paused false
```

Unknown scope ids fail with `InvalidPauseScope` (`308`) instead of silently
doing nothing. Prefer scope ids from the table — do not guess.

---

## 4. Timelocked admin actions

Sensitive setters do not take effect immediately. While
`is_timelock_enabled()` is `true` (the default), calling one of the setters
**queues** the change and starts a mandatory **24-hour** delay
(`TMLOCK_DELAY = 86_400` seconds). The change only lands when someone executes
it after the window.

### 4.1 Which calls are timelocked

| Setter                      | Queued action             |
| --------------------------- | ------------------------- |
| `set_fee_config(...)`       | Fee configuration         |
| `set_multisig_config(...)`  | N-of-M payment thresholds |
| `grant_role(grantee, role)` | RBAC grant                |
| `configure_governance(...)` | Governance parameters     |
| `set_spending_limit(...)`   | Per-user spending limits  |

`revoke_role`, the pause controls (§1, §3), `set_emitter`, and
`emergency_withdraw` are **not** timelocked — defensive actions must be
instant.

> **Legacy caveat:** `propose_timelocked_action(caller, action_type, target,
data)` still exists for off-chain review only. It records a string-only
> action with **no typed payload to dispatch**; executing it marks it done
> without changing any contract state. Use the typed setters above for real
> changes. Treat a legacy proposal as documentation, not as a change request.

### 4.2 Queue → inspect → execute

```bash
# 1. Queue (example: change fee config — arguments per the setter's signature)
stellar contract invoke \
  --id "$OPHIRPAY" --source-account "$OWNER" --network "$NET" \
  -- set_fee_config --caller "$OWNER" ...

# 2. Find the queued id (the newest action is the latest count - 1)
stellar contract invoke --id "$OPHIRPAY" --network "$NET" -- get_timelock_count
stellar contract invoke --id "$OPHIRPAY" --network "$NET" \
  -- get_timelocked_action --action_id <ID>
```

The queued record carries `proposed_by`, `proposed_at`, `unlocks_at`,
`executed`, and the typed payload. **Review `unlocks_at` and the payload
before executing.** An unexpected pending action is itself an incident signal:
an attacker with the owner key can only queue changes, not apply them — the
24-hour window exists so you can catch and cancel them.

```bash
# 3. Execute after unlocks_at (anyone may trigger; auth is already bound)
stellar contract invoke \
  --id "$OPHIRPAY" --source-account "$OWNER" --network "$NET" \
  -- execute_timelocked_action --action_id <ID>

# or cancel while still in the window (owner only)
stellar contract invoke \
  --id "$OPHIRPAY" --source-account "$OWNER" --network "$NET" \
  -- cancel_timelocked_action --caller "$OWNER" --action_id <ID>
```

`execute_timelocked_action` is permissionless by design: any account can
submit it once the delay has elapsed, and the contract enforces the rest.
Monitor pending actions — that is the whole point of the window.

### 4.3 Disabling the timelock (dangerous)

```bash
# Inspect (read-only)
stellar contract invoke --id "$OPHIRPAY" --network "$NET" -- is_timelock_enabled

# Disable — owner-only, takes effect immediately
stellar contract invoke \
  --id "$OPHIRPAY" --source-account "$OWNER" --network "$NET" \
  -- set_timelock_enabled --caller "$OWNER" --enabled false
```

Disabling applies sensitive setters immediately and is meant only for a
migration window. The change is recorded in the audit log
(`timelock_toggled`). Re-enable it as soon as the migration is done, and treat
an unexpected `false` as a compromised-owner indicator.

---

## 5. Contract upgrades and rollback

Upgrades are two-phase with a 24-hour delay. The deployed WASM can be
replaced only through this path; there is no instant upgrade.

```bash
# 1. Propose (owner). new_wasm_hash is the uploaded 32-byte hash (hex)
stellar contract invoke \
  --id "$OPHIRPAY" --source-account "$OWNER" --network "$NET" \
  -- propose_upgrade --caller "$OWNER" --new_wasm_hash <WASM_HASH>

# 2. The 24h window starts now. Verify the hash you proposed is the one you
#    built (reproducibility hashes: scripts/verify-wasm-reproducibility.sh).
#    During the window the owner can cancel:
stellar contract invoke \
  --id "$OPHIRPAY" --source-account "$OWNER" --network "$NET" \
  -- cancel_upgrade --caller "$OWNER"

# 3. After the window, execute (permissionless; contract enforces the delay)
stellar contract invoke --id "$OPHIRPAY" --network "$NET" -- execute_upgrade
```

- `propose_upgrade` overwrites any previously proposed hash and restarts the
  window. `cancel_upgrade` clears the pending hash and timer.
- `execute_upgrade` fails with `UpgradeTimelockActive` (`21`) before the
  window, and `UpgradeNotProposed` when nothing is queued.
- **Rollback = the same flow with the previous WASM hash.** The 24-hour delay
  applies to rollbacks too; this is the only time-bounded contract rollback.
  For app-layer rollbacks see `docs/MAINNET_RUNBOOK.md` §5.
- The emitter has its own independent `propose_upgrade` / `execute_upgrade`
  timelock and must be upgraded separately under the same procedure.

---

## 6. Ownership rotation

Ownership moves in two steps, each involving a different actor. The current
owner cannot complete the transfer alone, and the new owner cannot take the
contract early.

```bash
# 1. Current owner proposes the new owner (starts/restarts the 24h timer)
stellar contract invoke \
  --id "$OPHIRPAY" --source-account "$OWNER" --network "$NET" \
  -- transfer_ownership --caller "$OWNER" --new_owner <NEW_OWNER_ADDRESS>

# 2. After 24 hours, the NEW owner accepts (signed by the new key)
stellar contract invoke \
  --id "$OPHIRPAY" --source-account "$NEW_OWNER" --network "$NET" \
  -- accept_ownership --caller "$NEW_OWNER"

# Read back
stellar contract invoke --id "$OPHIRPAY" --network "$NET" -- get_owner
```

- `accept_ownership` before the delay fails with `UpgradeTimelockActive`
  (`21`); with no pending transfer it fails with `NoPendingOwner` /
  `OwnershipTransferNotProposed` (`305`).
- There is **no dedicated cancel function**. To abort, have the current owner
  re-propose the current owner address (this overwrites the pending owner and
  restarts the timer), or simply let the transfer expire unconsumed.
- The emitter's owner must be updated to the same new address **before** you
  rely on the pause button again, or `emergency_pause_all` will revert (§0).
  The emitter's ownership rotation is its own two-step flow.

---

## 7. Emergency withdraw (unlocked funds only)

`emergency_withdraw` rescues tokens accidentally sent directly to the contract
address. It **cannot** touch user funds locked in escrows, streams, or
governance deposits.

```bash
# asset is the token contract address (XLM: the native asset contract id)
stellar contract invoke \
  --id "$OPHIRPAY" --source-account "$OWNER" --network "$NET" \
  -- emergency_withdraw --caller "$OWNER" --asset <TOKEN_CONTRACT_ID> --amount <AMOUNT>
```

The invariant is `amount ≤ contract_balance − locked_balance` for that asset.
Requests above the unlocked balance fail with `NoTokensToWithdraw` (`19`) — if
that happens, the funds are user-owned (escrows/streams) and withdrawal is not
the right tool. Investigate the escrow/stream state instead.

---

## 8. After the incident

- [ ] Confirm the offending entrypoints are contained (global or scoped pause
      verified with `is_paused` / `get_paused_scopes`).
- [ ] Export the audit log for the incident window (`get_audit_log_count`,
      `get_audit_entry`) and archive the events/monitoring around it.
- [ ] Review **all pending timelock actions** (`get_timelock_count`,
      `get_timelocked_action`); cancel anything you cannot explain.
- [ ] Rotate the owner if key compromise is suspected (§6), on both contracts,
      and re-run `scripts/verify-deployment.sh`.
- [ ] Re-enable the timelock if it was disabled (§4.3).
- [ ] Resume scopes/global pause only with the fix verified (§2).
- [ ] Publish a GitHub security advisory once a fix ships; follow
      [SECURITY.md](../SECURITY.md) for the disclosure timeline and credit.
- [ ] File a post-incident review with timeline, blast radius, and follow-up
      issues (add regression tests where possible).

---

## Appendix: error codes you will see

Contract errors are numbered; the full catalog is in
[CONTRACT_FUNCTION_REFERENCE.md](CONTRACT_FUNCTION_REFERENCE.md#paymenterror-codes)
and [ERRORS.md](ERRORS.md).

| Code  | Name                      | Typical cause during incident response                         |
| ----- | ------------------------- | -------------------------------------------------------------- |
| `1`   | `NotInitialized`          | Contract not initialised, or owner missing (`get_owner` fails) |
| `4`   | `Unauthorized`            | Caller is not the owner, or wrong signature set                |
| `18`  | `ContractPaused`          | A state-changing call was attempted while paused               |
| `19`  | `NoTokensToWithdraw`      | Withdraw exceeds the unlocked balance                          |
| `21`  | `UpgradeTimelockActive`   | Upgrade/ownership delay not elapsed                            |
| `36`  | `TimelockNotFound`        | Wrong action id                                                |
| `37`  | `TimelockNotDue`          | Executing before `unlocks_at`                                  |
| `38`  | `TimelockAlreadyExecuted` | Action already executed or cancelled                           |
| `305` | `NoPendingOwner`          | `accept_ownership` with no pending transfer                    |
| `308` | `InvalidPauseScope`       | Scope id outside `0..7`                                        |

**Related docs:** [Contract function reference](CONTRACT_FUNCTION_REFERENCE.md) ·
[Mainnet runbook](MAINNET_RUNBOOK.md) ·
[Disaster recovery](DISASTER_RECOVERY.md) ·
[Security policy](../SECURITY.md)
