    InvalidAmount = 3,
    BatchTooLarge = 4,
    BatchEmpty = 5,
    /// Batch total overflowed i128::MAX during accumulation.
    BatchTotalOverflow = 6,
}

/// Maximum number of recipients allowed in a single batch.
pub const MAX_BATCH_SIZE: u32 = 100;

pub fn validate_batch_amounts(amounts: &[i128]) -> Result<i128, OphirError> {
    if amounts.is_empty() {
        return Err(OphirError::BatchEmpty);
    }
    if amounts.len() > MAX_BATCH_SIZE as usize {
        return Err(OphirError::BatchTooLarge);
    }
    let mut total_amount: i128 = 0;
    for amount in amounts {
        if *amount <= 0 {
            return Err(OphirError::InvalidAmount);
        }
        total_amount = total_amount
            .checked_add(*amount)
            .ok_or(OphirError::BatchTotalOverflow)?;
    }
    Ok(total_amount)
}
