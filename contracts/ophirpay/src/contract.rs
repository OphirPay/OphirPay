use std::num::NonZeroU64;

pub struct Token {
    pub decimals: u8,
}

impl Token {
    pub fn validate_amount(&self, amount: u64) -> Result<(), String> {
        let precision = 10u64.pow(self.decimals.into());
        if amount % precision != 0 {
            return Err(format!("Amount {} does not adhere to the token's decimal precision of {}.", amount, self.decimals));
        }
        Ok(())
    }
}

pub fn record_payment(token: &Token, amount: u64) -> Result<(), String> {
    if amount == 0 {
        return Err("Amount must be greater than zero".to_string());
    }

    // Validate against token's decimal precision
    token.validate_amount(amount)?;

    // Additional bounds checks can be added here

    // Proceed with recording the payment
    Ok(())
}