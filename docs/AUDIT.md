# OphirPay Smart Contract Security Audit

> **Status:** Manual security review (completed) · **Not** a substitute for a paid third-party audit
>
> **Auditor:** Codebuff (AI-assisted manual code review)
> **Date:** 2026-08-13
> **Scope:** `contracts/ophirpay/src/lib.rs` (OphirPayContract), `contracts/emitter/src/lib.rs` (PaymentEventEmitter), `contracts/ophirpay/spec/` (Kani proofs), the web/API security layer (`src/lib/csrf.ts`, `auth-session.ts`, `challenge.ts`, `api-auth.ts`, `webhook-url-guard.ts`, `webhook-deliver.ts`, `rate-limit.ts`, `src/app/api/auth/session/route.ts`), and the security-related documentation claims.

---

## 1. Executive Summary

OphirPay is a well-structured Soroban codebase with clear separation of concerns, consistent
storage namespacing, pervasive `require_auth` on privileged entrypoints, and a solid
`LOCKED_BALANCE` accounting pattern for escrows, streams, and governance deposits.

The review found **no single point of direct, unauthenticated fund theft**. However, it found:

- **1 High** fund-safety issue: the refund lifecycle bypasses the `LOCKED_BALANCE` protection,
  allowing the owner (or an attacker who compromises the owner key) to drain user-deposited funds
  through the refund path, which the documented invariant explicitly claims to prevent.
- **1 High** trust/claim issue: the advertised "10/10 Kani formal verification" does **not**
  verify the deployed contract. The proofs verify hand-written *models* that share no code with
  the contract, are partially tautological, are not run in CI, and reference a harness that does
  not exist. The repository is **not** formally verified.
- **Six Medium** issues: unauthenticated state mutation in `check_spending`, unbounded
  enumeration (DoS), an unallowlisted emitter, incomplete reentrancy coverage, a cross-contract
  pause that discards errors, and an SSRF bypass via HTTP redirects in the webhook delivery path.
- **Numerous Low** issues around validation, error-code hygiene, the webhook HMAC scheme, and
  documentation accuracy.

**Bottom line:** do **not** present OphirPay as "audited" or "formally verified" until the
findings below are addressed and an independent third-party audit (e.g. Runtime Verification,
Certora, Trail of Bits, OtterSec) is commissioned.

---

## 2. Methodology & ScopeThis review is a **line-by-line manual security review** of the two Soroban contracts (≈5,600 lines
total) and the web/API authentication/SSRF/rate-limit layer, plus an assessment of the
formal-verification harnesses and the security claims in `README.md`, `docs/VERIFICATION.md`,
`ROADMAP.md`, `docs/SPEC.md`, and `SECURITY.md`.

What this review **is**:

- Static analysis of access control, arithmetic, storage layout, TTL handling, reentrancy,
  cross-contract calls, pause/circuit-breaker logic, and token-flow accounting.

What this review is **not**:

- A formal/mathematical verification of the contract (no Kani/Certora run was performed against
  the actual contract bytecode or source).
- A dynamic/fuzz test, gas audit, or full test-suite audit.

### Severity classification

| Level | Meaning |
|---|---|
| **Critical** | Direct loss of user funds or permanent loss of contract control without preconditions |
| **High** | Loss of funds or control under plausible preconditions (e.g. compromised/coerced owner) |
| **Medium** | Availability, integrity, or defense-in-depth weakness that is exploitable under some conditions |
| **Low** | Code-quality or validation gap with limited practical impact |
| **Informational** | Documentation/consistency observations |

---

## 3. Findings

### HIGH-1 — Refund path bypasses the `LOCKED_BALANCE` fund-safety invariant

> ✅ **Status: FIXED (2026-08-14).** `request_refund` now validates that the requester is the
> payment's payer or payee, that `amount <= payment.amount`, and that `asset == payment.asset`.
> `approve_refund`, `reject_refund`, and `process_refund` now enforce `require_not_paused`,
> and `process_refund` requires owner authorization (`caller.require_auth()` + `require_owner`).
> An owner can no longer request a refund of the contract's entire balance for an unrelated
> payment, and the refund transfer cannot be triggered permissionlessly. Covered by the new
> `test_refund_rejects_unauthorized_requester` unit test.

**File:** `contracts/ophirpay/src/lib.rs` (`request_refund` L3230, `process_refund` L3368)

The contract's headline security invariant is:

> *`emergency_withdraw` enforces `withdraw_amount ≤ contract_balance − LOCKED_BALANCE`*, so even a
> compromised owner cannot drain funds locked in escrows, streams, or proposal deposits.

The refund lifecycle provides a second, **uncapped** withdrawal path that is not subject to this
invariant:

1. `request_refund` (L3230) requires only `requester.require_auth()`. It does **not** verify that
   the requester is the payer or payee of `payment_id`, that `amount ≤ payment.amount`, that
   `asset == payment.asset`, or that the contract actually holds `amount` of `asset`.
2. `approve_refund` (owner-only) moves the refund to `Approved`.
3. `process_refund` (L3368) then calls `token::Client::transfer(contract → requester, amount)`
   with **no `require_auth`, no pause check, and no `add_locked` accounting**.

Consequence: the owner can trivially drain the entire token balance of the contract:

```
owner.request_refund(owner, any_payment_id, amount = contract_balance, asset, ...)
owner.approve_refund(id)
process_refund(id)   // no auth — anyone triggers; funds flow to owner
```

`LOCKED_BALANCE` is never decremented, and the transferred funds come straight out of the pool
backing active escrows/streams. This defeats the invariant the README and `docs/VERIFICATION.md`
list as proven.

**Recommendation:**

- Require `process_refund` to be owner-authorized, or better, escrow the refund amount from the
  owner at `approve_refund` time.
- Validate in `request_refund`: `requester == payment.payee` (or payer), `amount ≤ payment.amount`,
  `asset == payment.asset`, and `amount ≤ contract balance of asset`.
- Account for refunded amounts against `LOCKED_BALANCE` / a dedicated refund reserve, or refuse
  refunds for payments that were never deposited on-chain (e.g. `record_payment`-only payments).

---

### HIGH-2 — The "formal verification" does not verify the deployed contract

**Files:** `contracts/ophirpay/spec/src/invariants.rs`, `contracts/ophirpay/spec/Cargo.toml`,
`docs/VERIFICATION.md`, `README.md`

The README and `docs/VERIFICATION.md` claim **"10/10 Kani invariants formally verified"** and a CI
badge reads "verified-Kani". The reality:

1. **The proofs are decoupled from the contract.** `spec/Cargo.toml` has **no dependency** on the
   `ophirpay-contract` crate and explicitly notes *"The model functions are pure Rust — no Soroban
   SDK dependency needed."* Each proof re-implements the logic in a hand-written `model_*`
   function and proves properties of *that model*, not of `lib.rs`.
2. **Several "invariants" are tautological.** E.g. `model_vote(already_voted) = !already_voted`,
   and the proof asserts `!model_vote(true)` — trivially true by definition and unlinked to
   `vote_on_proposal`.
3. **The documented harness does not exist.** `docs/VERIFICATION.md` lists a
   `compute_vested_no_overflow` harness; the source defines `compute_vested_boundary_at_end`,
   `compute_vested_boundary_at_start`, and `compute_vested_zero_duration` instead.
4. **Not run in CI.** No job in `.github/workflows/ci.yml` installs or runs Kani; the "green"
   badge is decorative.
5. **The docs contradict each other.** `docs/SPEC.md` still lists Kani as an *unchecked TODO*
   (`- [ ] Bounded model checking with kani …`), while `ROADMAP.md` marks it *done* ("10/10 Kani
   proofs passing"). The proof file header says "8 critical invariants"; the README says 10.

Additionally, at least one modeled invariant does **not** hold in the actual code: invariant 8
(spending-limit expiry) is modeled correctly, but the real `check_spending` (L1867) never checks
`expires_at` — only `atomic_spend` does.

**Recommendation:**

- Either (a) remove the "formally verified" claims and badge, or (b) write real Kani/Certora
  harnesses that exercise the actual `OphirPayContract` via the Soroban test environment and run
  them in CI, with a published artifact/report.
- Do not describe these model proofs as "formal verification of the contract."

---

### MEDIUM-1 — `check_spending` is an unauthenticated, state-mutating "view"

> ✅ **Status: FIXED (2026-08-14).** `check_spending` is now a pure read-only simulation: it no
> longer writes to persistent storage. The daily/monthly counters are only updated by
> `atomic_spend`, the sole authorized write path. Repeated calls can no longer burn a user's
> allowance (griefing vector closed).

**File:** `contracts/ophirpay/src/lib.rs` L1867

`check_spending(env, user, amount)` has **no `require_auth`**, yet it **writes** to persistent
storage: it resets and then increments `current_daily_spend` / `current_monthly_spend` for `user`.
Any address can call it repeatedly to burn an arbitrary user's daily/monthly allowance (a
griefing/DoS vector), and the name implies it is a pure check. It also ignores `expires_at`.

**Recommendation:** make it a read-only simulation (no writes), or require `user.require_auth()`
and a `require_not_paused` guard.

---

### MEDIUM-2 — Unbounded enumeration (resource exhaustion)

**File:** `contracts/ophirpay/src/lib.rs`

Several readers iterate without any cap, contradicting the README's "Bounded N+1 enumeration"
claim:

- `get_reason_code_analytics` (L3423) iterates `1..=total` over **all** refunds.
- `get_payments_range` (L2494) iterates the full `start_id..=end_id` range.
- `get_payments_by_batch` and `get_subscriber_hooks` also iterate their full inputs.

On Soroban, large inputs can exceed the per-call instruction budget, making these endpoints
unreliable or DoS-able. (`get_audit_log_range`, `get_fee_config_history`, and
`get_multisig_config_history` are correctly capped at 100 — apply the same pattern.)

**Recommendation:** cap results and return a `truncated` flag, as done elsewhere.

---

### MEDIUM-3 — Emitter accepts events from any caller (no allow-list)

> ✅ **Status: FIXED (2026-08-14).** The emitter now supports an allow-list: `set_allowed_source`
> (owner-only) stores the trusted orchestrator address in `ALLOWED_SOURCE`, and `emit_payment`
> rejects callers that are neither the allow-listed source nor the owner. Covered by the new
> `test_allow_list_blocks_unauthorized_emitters` unit test. **Deploy note:** the allow-list must
> be populated via `set_allowed_source` after the hardened WASM is deployed for the check to
> take effect.

**File:** `contracts/emitter/src/lib.rs` L76

`emit_payment` requires only `caller.require_auth()` and does **not** verify that `caller` is the
linked OphirPay contract (there is no allow-list at all). Any account can emit fabricated
`PaymentEvent`s with arbitrary payer/payee/amount/tx_hash. Because the SSE stream
(`/api/events`, `/api/audit-log/sse`) and the webhook relayer (`scripts/relayer.ts`) consume these
events, this is a data-integrity problem: fake payments would surface in dashboards and be
delivered to webhook subscribers.

**Recommendation:** store an allow-listed source address (the OphirPay contract) and require it in
`emit_payment`, or require a valid signature from the main contract.

---

### MEDIUM-4 — Reentrancy guard does not cover token-moving functions

> ✅ **Status: FIXED (2026-08-14).** `REENTRANCY_LOCK` now wraps every token-transfer path:
> `create_escrow`, `release_escrow`, `claim_escrow`, `create_stream`, `claim_stream`,
> `cancel_stream`, `create_proposal` deposit, `execute_proposal` refund, and `process_refund` —
> in addition to the pre-existing `emergency_pause_all`/`emergency_unpause_all`/`emergency_withdraw`.
> Each acquire is paired with a release on every path (including error returns), and the new
> `test_reentrancy_lock_released_after_guarded_ops` regression test asserts the lock is always
> released after guarded operations.

**File:** `contracts/ophirpay/src/lib.rs`

The README states the `REENTRANCY_LOCK` protects cross-contract calls, but only
`emergency_pause_all`, `emergency_unpause_all`, and `emergency_withdraw` acquire it. The
escrow/stream/governance/refund functions (`create_escrow` L2549, `release_escrow` L2615,
`create_stream` L2797, `claim_stream` L2871, `execute_proposal`, `process_refund`) all perform
`token::Client` transfers (cross-contract calls) **without** the lock. With a custom (malicious)
`asset` contract, these paths are not protected against re-entrancy.

**Recommendation:** apply the lock consistently around all cross-contract token transfers, and use
checks-effects-interactions ordering.

---

### MEDIUM-5 — `emergency_pause_all` ignores cross-contract result

> ✅ **Status: FIXED (2026-08-14).** `emergency_pause_all` / `emergency_unpause_all` now capture
> the `invoke_contract` result and convert a failure to `PaymentError::CrossContractCallFailed`,
> reverting the operation instead of silently leaving the emitter running.

**File:** `contracts/ophirpay/src/lib.rs` L2137

The cross-contract `pause` call is invoked as `let _: () = env.invoke_contract(&emitter, …)`,
discarding the result. The emitter's `pause` (L256) requires `caller == EMITTER_OWNER`; if the
emitter's owner differs from the OphirPay owner, the call reverts and `emergency_pause_all` fails
entirely — meaning the documented "atomic pause_all" is fragile and can silently break the
emergency circuit breaker.

**Recommendation:** propagate the cross-contract result, or align emitter ownership with the
orchestrator and add a test for the mismatch case.

---

### MEDIUM-6 — SSRF bypass via HTTP redirects in webhook delivery

> ✅ **Status: FIXED (2026-08-14).** `deliverWebhook` now passes `redirect: "manual"` to `fetch`,
> so 3xx hops are never followed to internal addresses (e.g. `http://169.254.169.254/`); a 3xx
> response is treated as a delivery failure. The HMAC canonicalization was also corrected so a
> receiver verifying `X-OphirPay-Signature` over the received body always matches (see LOW-9).
> Covered by the new `src/__tests__/webhook-deliver.test.ts` suite.

**File:** `src/lib/webhook-deliver.ts`, `src/lib/webhook-url-guard.ts`

`deliverWebhook` validates the *initial* URL with `isSafeWebhookUrlAtDelivery` but then calls
`fetch(url, …)` **without** `redirect: "manual"` / `"error"`, so the default behavior follows
redirects. A user-supplied webhook URL that resolves to a public address can `302`/`307` redirect
to `http://169.254.169.254/`, `http://localhost:…`, or another internal endpoint, bypassing the
SSRF guard. The guard also does not restrict ports (e.g. `https://public-host:22`).

**Recommendation:** set `redirect: "manual"` (and manually re-validate each hop) or `"error"`,
and re-run the IP/hostname check against the final resolved address after following redirects.

---

### LOW — Validation and hygiene

1. **`compute_vested` returns `0` on multiplication overflow** (`lib.rs` L884): a silent
   under-vest instead of capping at `total_amount`. `claim_stream` also uses non-saturating
   `vested - claimed_amount`.
2. **`approve_refund` / `reject_refund` / `process_refund` lack `require_not_paused`** — refunds
   can settle during an emergency pause.
3. **`request_refund` does not tie `asset`/`amount` to the payment** (see HIGH-1).
4. **`propose_upgrade` uses plain `+ 86400`** (L2257, emitter L144) instead of `saturating_add`,
   inconsistent with the rest of the codebase.
5. **Error-code reuse/typos:** `unregister_hook` returns `AuditEntryNotFound`; `accept_ownership`
   returns `UpgradeNotProposed`; `cancel_payment` has stray whitespace in its signature.
6. **Error-code catalog is inflated:** the `PaymentError` enum defines 300 variants (through
   `SystemFatalError = 300`) for many features that are **not implemented** (staking, bridge,
   insurance, KYC, routing, gas, oracle, dispute resolution). The large reserved catalog exists
   to keep the TS error catalog and the contract enum in lockstep, but the unused variants add
   code size and a false sense of coverage.
7. **`set_multisig_config`** does not deduplicate signers or enforce the documented
   `MaxSignersExceeded` (error 91) / `MaxSignersExceeded` caps.
8. **`create_batch`** uses unchecked `total_amount += amount` (potential `i128` overflow with 100
   near-max entries).
9. **Webhook HMAC signs the wrong body** — ✅ **FIXED (2026-08-14).** `buildSignedPayload` now
   canonicalizes the HMAC over `JSON.stringify({...payload, signature: ""})` and transmits the
   body with the real signature populated; a receiver empties the `signature` field and
   re-serializes to recompute an identical HMAC. Covered by `src/__tests__/webhook-deliver.test.ts`.
10. **API keys hashed with plain SHA-256** (`src/lib/api-auth.ts`): fine for high-entropy random
    keys, but there is no enforcement that keys are long/random. Prefer a slow KDF (bcrypt/scrypt/
    argon2) or enforce 32+ byte CSPRNG keys at creation.
11. **Test-count drift (resolved)**: the README previously advertised "13 suites / 187 app tests /
    251 total"; it now correctly reports 806 app tests across 33 suites, 67 contract tests, and 97
    Playwright e2e cases.

---

### INFORMATIONAL

- **Admin functions are not timelocked on-chain.** `set_fee_config`, `set_multisig_config`,
  `grant_role`, `configure_governance`, `configure_escalation`, `set_spending_limit`,
  `set_fee_collector`, and `set_emitter` are immediate owner-only actions. The
  `propose_timelocked_action` / `execute_timelocked_action` mechanism (L1360/L1413) stores a
  string and flips an `executed` flag but **never dispatches** to any state-changing function —
  it is disconnected from the functions the README claims it protects. (Two-step ownership
  transfer and WASM upgrade *are* correctly timelocked.)
- `execute_timelocked_action`, `execute_upgrade`, and `process_refund` are permissionless
  executors (acceptable *only* when the payload is owner-approved and the action is
  content-bound, which is true for upgrade but **not** for refund).
- `record_payment` and the emitter's `emit_payment` are permissionless recorders; ensure
  downstream consumers treat on-chain records as *untrusted* for fund movement.
- `src/lib/auth-session.ts` still describes proof-of-ownership as a *future* hardening step, but
  the issuing route (`src/app/api/auth/session/route.ts`) already enforces the challenge +
  Ed25519-signature flow. Stale comment only — the protection is present.
- `get_payments_range`/`get_payments_by_batch` return `Vec` without truncation flags.

---

## 4. What *is* in place (positive findings)

- `require_auth` on essentially all privileged/state-changing entrypoints.
- Two-step, timelocked ownership transfer in both contracts.
- Timelocked WASM upgrade (owner proposes, anyone executes after 24h).
- Consistent `(PREFIX, id)` namespacing for persistent records (fixes the earlier
  counter-collision overwrite bug).
- `saturating_*` arithmetic used in most counter/locked-balance paths.
- `extend_ttl` called on every persistent write.
- Pause circuit breaker present on most write paths (gap noted above for refunds).
- 67 Rust contract unit tests (60 ophirpay + 7 emitter) + a large vitest app suite (806 cases), wired into CI.
- Web layer verified as matching the README's claims: CSRF (double-submit, timing-safe),
  HMAC-signed sessions with proof-of-ownership, SHA-256-hashed API keys (indexed, fail-closed),
  DNS-rebinding re-validation on webhooks, and pluggable rate limiting.

---

## 5. Remediation priority

| Priority | Finding | Effort |
|---|---|---|
| Priority | Finding | Status (2026-08-14) | Effort |
|---|---|---|---|
| P0 | HIGH-1 refund path bypasses LOCKED_BALANCE | ✅ Fixed | Medium |
| P0 | HIGH-2 correct or remove "formally verified" claims | ✅ Fixed (README honesty note + badge removed; VERIFICATION.md retitled to "Modeled Invariants" with an explicit caveat) | Low |
| P1 | MEDIUM-1 `check_spending` unauthenticated mutation | ✅ Fixed | Low |
| P1 | MEDIUM-2 bound all enumeration | ✅ Fixed (`get_payments_range` + `get_reason_code_analytics` capped at 100, most-recent-first) | Low |
| P1 | MEDIUM-3 emitter allow-list | ✅ Fixed (deploy + `set_allowed_source` pending) | Low |
| P1 | MEDIUM-6 webhook SSRF redirect bypass | ✅ Fixed | Low |
| P2 | MEDIUM-4 reentrancy on token-moving fns | ✅ Fixed (`REENTRANCY_LOCK` now wraps all token-transfer paths: escrow release/claim, stream claim/cancel, proposal deposit/refund, refund processing, emergency ops) | Medium |
| P2 | MEDIUM-5 cross-contract pause result | ✅ Fixed | Low |
| P2 | LOW validation/hygiene items | Partially fixed (LOW-9 HMAC, LOW-11 counts) | Low |

> **MEDIUM-2 note:** `get_payments_range` now iterates the most-recent tail first and stops at
> 100 entries (matching `get_audit_log_range`), and `get_reason_code_analytics` scans only the
> most recent 100 refunds. `get_payments_by_batch` and `get_subscriber_hooks` iterate their
> inherently-bounded inputs (batch payment IDs / subscriber hook IDs) and need no cap.

---

## 6. Disclaimer

This is an AI-assisted manual review performed on the source as of the referenced date. It is not
a formal verification, not a security guarantee, and not a replacement for a professional audit by
a qualified firm with dynamic analysis, fuzzing, and economic review. No funds should be deployed
to mainnet solely on the basis of this report.
