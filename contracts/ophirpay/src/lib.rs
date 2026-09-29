#![no_std]
#![allow(deprecated)]
#![allow(clippy::too_many_arguments)]

pub mod storage;
pub mod types;
pub mod errors;
pub mod events;
pub mod helpers;
pub mod contract;

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
