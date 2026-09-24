//! OphirPay contract entrypoint
//!
//! This file is intentionally lightweight and only re‑exports the public API
//! from the domain‑specific modules. The heavy lifting is performed in the
//! individual modules below. This keeps the contract surface small while
//! preserving the original ABI and behaviour.

pub mod errors;
pub mod storage_keys;
pub mod helpers;
pub mod payments;
pub mod escrows;
pub mod streams;
pub mod recurring;
pub mod refunds;
pub mod governance;
pub mod multisig;
pub mod hooks;
pub mod batches;
pub mod admin;

// Re‑export public items from each module
pub use errors::*;
pub use storage_keys::*;
pub use helpers::*;
pub use payments::*;
pub use escrows::*;
pub use streams::*;
pub use recurring::*;
pub use refunds::*;
pub use governance::*;
pub use multisig::*;
pub use hooks::*;
pub use batches::*;
pub use admin::*;
