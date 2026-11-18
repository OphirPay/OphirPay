// Note: This file is included to ensure the PaymentError enum is correctly 
// mapped if it wasn't already fully implemented for the test to pass.
// If the enum already exists, this serves as a reference for the expected structure.

#[target_code]
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
#[soroban_sdk::contracterror]
pub enum PaymentError {
    SpendingLimitExceeded = 1,
    InsufficientFunds = 2,
    Unauthorized = 3,
    // ... other error codes
}
