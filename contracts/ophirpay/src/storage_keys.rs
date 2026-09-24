//! Storage key constants for the OphirPay contract.
//!
//! All storage keys are defined in a single place to avoid accidental
//! collisions and to make the key layout visible to developers.

pub const KEY_PAYMENTS: &[u8] = b"payments";
pub const KEY_ESCROWS: &[u8] = b"escrows";
pub const KEY_STREAMS: &[u8] = b"streams";
pub const KEY_RECURRING: &[u8] = b"recurring";
pub const KEY_REFUNDS: &[u8] = b"refunds";
pub const KEY_GOVERNANCE: &[u8] = b"governance";
pub const KEY_MULTISIG: &[u8] = b"multisig";
pub const KEY_HOOKS: &[u8] = b"hooks";
pub const KEY_BATCHES: &[u8] = b"batches";
pub const KEY_ADMIN: &[u8] = b"admin";
