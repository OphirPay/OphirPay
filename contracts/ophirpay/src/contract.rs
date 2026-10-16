// Add constant at the top
pub const MIN_DISPUTE_PERIOD: u64 = 86400; // 24 hours in seconds

// In raise_dispute function:
pub fn raise_dispute(env: Env, caller: Address, escrow_id: u64) -> Result<(), PaymentError> {
    let mut escrow = get_escrow(escrow_id)?;
    require_auth_either(&env, &[escrow.depositor.clone(), escrow.beneficiary.clone()])?;
    
    // Initialize dispute with current timestamp and clear approvals
    escrow.dispute_initiated_at = Some(env.ledger().timestamp());
    escrow.dispute_approvals = Vec::new();
    save_escrow(escrow_id, &escrow)?;
    // ... existing event emission
}

// Add approve_resolution function
pub fn approve_resolution(env: Env, caller: Address, escrow_id: u64) -> Result<(), PaymentError> {
    let mut escrow = get_escrow(escrow_id)?;
    require_dispute_active(&escrow)?;
    
    if caller != escrow.depositor && caller != escrow.beneficiary {
        return Err(PaymentError::Unauthorized);
    }
    
    if !escrow.dispute_approvals.contains(&caller) {
        escrow.dispute_approvals.push(caller);
        save_escrow(escrow_id, &escrow)?;
    }
    Ok(())
}

// Modified resolve_dispute function
pub fn resolve_dispute(
    env: Env,
    arbiter: Address,
    escrow_id: u64,
    // ... other parameters
) -> Result<(), PaymentError> {
    arbiter.require_auth();
    let mut escrow = get_escrow(escrow_id)?;
    require_dispute_active(&escrow)?;

    if let Some(initiated_at) = escrow.dispute_initiated_at {
        let earliest_resolution = initiated_at + MIN_DISPUTE_PERIOD;
        if env.ledger().timestamp() < earliest_resolution {
            // Check for mutual approval
            if !(escrow.dispute_approvals.contains(&escrow.depositor) && 
                 escrow.dispute_approvals.contains(&escrow.beneficiary)) {
                return Err(PaymentError::DisputeCoolingOffActive);
            }
        }
    }
    // ... existing resolution logic
}

// Helper function
fn require_dispute_active(escrow: &Escrow) -> Result<(), PaymentError> {
    if escrow.dispute_initiated_at.is_none() {
        return Err(PaymentError::DisputeNotFound);
    }
    Ok(())
}
