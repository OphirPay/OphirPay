# Formal Verification

This repository contains a set of Kani harnesses that exercise the **real** OphirPay contract
and prove the following invariants:

| Invariant | Description | Proven |
|-----------|-------------|--------|
| Locked balance non‑negative | The `locked_balance` value can never become negative and is always consistent with the sum of escrowed and streamed amounts. | ✅ |
| Refund limit | A refund request cannot exceed the original payment amount or the asset balance. | ✅ |
| Escrow single‑release | An escrowed payment can be released only once; subsequent releases are rejected. | ✅ |
| Stream claim vested | A stream claim cannot exceed the amount vested at the time of the claim. | ✅ |
| Pause guard | When the contract is paused, all mutating entrypoints are blocked and return a `Paused` error. | ✅ |

The harnesses are located in `contracts/ophirpay/spec/src/invariants.rs` and are executed
by the `kani.yml` workflow in CI.  They use the Soroban test environment to drive the
contract and assert the invariants against the actual contract code.

> **Note**: The previous model‑based proofs were removed because they did not exercise
> the real contract logic.  The current harnesses provide the same guarantees
> directly against the production code.

