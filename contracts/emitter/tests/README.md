# Emitter Unit Tests

The `emitter` contract follows the same test convention as `ophirpay`:

- Unit tests are placed in `tests/unit_tests.rs`.  
- Integration tests are in `tests/integration_tests.rs`.  
- Property tests are in dedicated files.

All tests should be able to access private helpers via `#[cfg(test)]` re‑exports in the crate root.
