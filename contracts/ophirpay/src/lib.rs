//! OphirPay Smart Contract on Soroban (Stellar)
//!
//! Production-grade open-source payment platform for Stellar & Soroban, featuring:
//! - Direct & off-chain payment records with idempotency deduplication
//! - Batch payments with atomic quota checks and partial failure handling
//! - Linear payment streaming with monotonic vesting and locked balance invariants
//! - Time-locked escrow with dispute arbitration
//! - Multi-signature transaction approval workflows
//! - On-chain governance with proposal creation, voting, and timelocked execution
//! - Daily/monthly calendar-aligned spending limits with atomic debits
//!
//! # Core Contract Interface
//!
//! See [`OphirPayContract`] for all public entrypoints, including:
//! - [`OphirPayContract::init`]: Contract initialization and ownership setup
//! - [`OphirPayContract::record_payment`]: Off-chain payment recording with deduplication
//! - [`OphirPayContract::create_batch`]: Multi-recipient batch payments
//! - [`OphirPayContract::create_stream`]: Linear payment vesting stream creation
//!
//! All errors returned by contract methods are enumerated in [`PaymentError`].

#![no_std]
#![allow(deprecated)]
#![allow(clippy::too_many_arguments)]

pub mod storage;
pub mod types;
pub mod errors;
pub mod events;
pub mod helpers;
pub mod contract;
mod spending_limit;

#[cfg(test)]
mod test;

// The module split moved every item out of this file, so re-export them all at
// the crate root. This preserves both the pre-split public paths
// (`ophirpay_contract::PaymentError`, `ophirpay_contract::BatchCreateResult`, …)
// that `tests/*.rs` rely on and the `use crate::*;` glob that `test.rs` uses.
pub use contract::*;
pub use errors::*;
pub use events::*;
pub use helpers::*;
pub use storage::*;
pub use types::*;

// `test.rs` resolves `Env`/`Address`/`token` through `use crate::*;`, which used
// to work because the single-file lib.rs imported soroban_sdk at the root.
#[cfg(test)]
#[allow(unused_imports)]
use soroban_sdk::{symbol_short, token, Address, Env, String, Symbol, Vec};
