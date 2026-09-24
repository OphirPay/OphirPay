//! Error definitions for the OphirPay contract.
//!
//! All contract errors are defined here to keep the error handling
//! consistent across modules. The `ContractError` enum is the single
//! source of truth for all public error variants.

use soroban_sdk::{contracterror, Env};

#[contracterror]
#[derive(Debug, PartialEq, Eq, Clone, Copy)]
pub enum ContractError {
    // Example error variants – replace with the real ones from the original
    // contract. The numeric values must match the original ABI.
    InvalidAmount = 1,
    InsufficientFunds = 2,
    Unauthorized = 3,
    // ... add the rest of the error codes here
}

impl ContractError {
    /// Convert an error code to a human readable string.
    pub fn to_string(&self) -> &'static str {
        match self {
            ContractError::InvalidAmount => "Invalid amount",
            ContractError::InsufficientFunds => "Insufficient funds",
            ContractError::Unauthorized => "Unauthorized",
            // ... add the rest of the error messages here
        }
    }
}
