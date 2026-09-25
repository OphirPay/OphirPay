# OphirPay Unit Tests

All unit tests for the `ophirpay` contract should live in this directory.  
They exercise the contract's internal logic and may use `#[cfg(test)]` re‑exports to access private helpers.

The convention is:

- **Unit tests** – `tests/unit_tests.rs` (or split into logical files).  
- **Integration tests** – `tests/integration_tests.rs`.  
- **Property tests** – separate files such as `proptest_payment_amounts.rs`.

This mirrors the structure used by the `emitter` contract.
