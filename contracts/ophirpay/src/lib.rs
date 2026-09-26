//! OphirPay Soroban smart contract.
//!
//! Modular architecture:
//! - `admin`: Initialization, ownership, pause, fees, upgrades, and RBAC
//! - `batches`: Batch payment processing and atomic multi-payment recording
//! - `errors`: Contract error taxonomy and code allocation
//! - `escrows`: Escrow creation, release, arbiter settlement, and claims
//! - `events`: Native Soroban event emission
//! - `governance`: DAO proposals, voting, execution, and timelocked actions
//! - `helpers`: State mutation counters, fee calculations, and reentrancy guards
//! - `hooks`: On-chain notification webhook subscriptions
//! - `multisig`: M-of-N threshold signing for elevated value transfers
//! - `payments`: Direct payment recording and queries
//! - `recurring`: Scheduled and periodic subscription execution
//! - `refunds`: Structured refund requests, approval, and reason analytics
//! - `storage_keys`: Instance and persistent storage symbols and constants
//! - `streams`: Linear payment streaming and vesting
//! - `types`: Contract data records and enumerations

#![no_std]
#![allow(deprecated)]
#![allow(clippy::too_many_arguments)]

use soroban_sdk::contract;

pub mod admin;
pub mod batches;
pub mod errors;
pub mod escrows;
pub mod events;
pub mod governance;
pub mod helpers;
pub mod hooks;
pub mod multisig;
pub mod payments;
pub mod recurring;
pub mod refunds;
pub mod storage_keys;
pub mod streams;
pub mod types;

pub use errors::*;
pub use events::*;
pub use helpers::*;
pub use storage_keys::*;
pub use types::*;

#[contract]
pub struct OphirPayContract;

#[cfg(test)]
mod tests;
