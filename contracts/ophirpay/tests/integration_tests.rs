#[test]
fn test_dispute_timeline_enforcement() {
    let fix = TestFixture::new();
    // Setup escrow with arbiter
    let depositor = Address::generate(&fix.env);
    let beneficiary = Address::generate(&fix.env);
    let arbiter = Address::generate(&fix.env);
    let escrow_id = fix.client.create_escrow(
        &depositor,
        &beneficiary,
        &Some(arbiter.clone()),
        1_000_000,
        &fix.token_id,
        fix.env.ledger().timestamp() + 1000,
        String::default(),
    );

    // Raise dispute
    fix.client.raise_dispute(&depositor, &escrow_id);
    let escrow = fix.client.get_escrow(&escrow_id);
    let dispute_start = escrow.dispute_initiated_at.unwrap();

    // Test premature resolution
    assert!(
        fix.client.try_resolve_dispute(&arbiter, &escrow_id, false, String::default())
            .is_err(),
        "Should block during cooling-off"
    );

    // Test mutual approval bypass
    fix.client.approve_resolution(&depositor, &escrow_id);
    fix.client.approve_resolution(&beneficiary, &escrow_id);
    assert!(
        fix.client.resolve_dispute(&arbiter, &escrow_id, false, String::default()).is_ok(),
        "Mutual approval should bypass timeout"
    );

    // Test timeout expiration
    fix.env.ledger().set_timestamp(dispute_start + MIN_DISPUTE_PERIOD + 1);
    fix.client.raise_dispute(&depositor, &escrow_id); // Re-raise to reset approvals
    assert!(
        fix.client.resolve_dispute(&arbiter, &escrow_id, false, String::default()).is_ok(),
        "Should allow after timeout"
    );
}
