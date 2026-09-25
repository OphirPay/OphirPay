use super::*;
use soroban_sdk::testutils::{Address as _, Ledger as _};
use soroban_sdk::{vec, String, Vec};

// ── Stream Tests ───────────────────────────────────────

#[test]
fn test_create_and_claim_stream() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(OphirPayContract, ());
    let client = OphirPayContractClient::new(&env, &contract_id);

    let owner = Address::generate(&env);
    let creator = Address::generate(&env);
    let recipient = Address::generate(&env);
    let sac = create_token_contract(&env, &owner);
    let sac_client = token::StellarAssetClient::new(&env, &sac);
    sac_client.mint(&creator, &10_000i128);

    let now = env.ledger().timestamp();
    let _ = client.init(&owner);

    let stream_id = client.create_stream(
        &creator,
        &recipient,
        &1000i128,
        &sac,
        &now,
        &(now + 1000),
        &String::from_str(&env, "salary"),
    );
    assert_eq!(stream_id, 1);
    assert_eq!(client.get_stream_count(), 1);

    let stream = client.get_stream(&1);
    assert_eq!(stream.total_amount, 1000);
    assert_eq!(stream.claimed_amount, 0);
    assert!(!stream.cancelled);

    env.ledger().set_timestamp(now + 500);
    let claimed = client.claim_stream(&recipient, &1);
    assert_eq!(claimed, 500);

    env.ledger().set_timestamp(now + 2000);
    let claimed2 = client.claim_stream(&recipient, &1);
    assert_eq!(claimed2, 500);

    let stream_final = client.get_stream(&1);
    assert_eq!(stream_final.claimed_amount, 1000);
}

#[test]
fn test_cancel_stream_returns_unvested() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(OphirPayContract, ());
    let client = OphirPayContractClient::new(&env, &contract_id);

    let owner = Address::generate(&env);
    let creator = Address::generate(&env);
    let recipient = Address::generate(&env);
    let sac = create_token_contract(&env, &owner);
    let sac_client = token::StellarAssetClient::new(&env, &sac);
    sac_client.mint(&creator, &10_000i128);

    let now = env.ledger().timestamp();
    let _ = client.init(&owner);
    let _ = client.create_stream(
        &creator,
        &recipient,
        &1000i128,
        &sac,
        &now,
        &(now + 1000),
        &String::from_str(&env, "cancel test"),
    );

    env.ledger().set_timestamp(now + 200);
    let returned = client.cancel_stream(&creator, &1);
    assert_eq!(returned, 800);

    let stream = client.get_stream(&1);
    assert!(stream.cancelled);
}

// ── Vesting Overflow (AUDIT LOW-1 / issue #691) ─────────

/// `i128::MAX * 2` overflows. The old code returned `0` here, silently
/// under-vesting a stream that is 50% through its schedule.
#[test]
fn test_compute_vested_overflow_is_exact_and_not_zero() {
    let total = i128::MAX;
    let start = 1_000u64;
    let end = start + 4; // duration 4 seconds
    let now = start + 2; // elapsed 2 seconds → exactly 50%

    let vested = compute_vested(total, start, end, now);

    assert!(vested > 0, "overflow must not collapse vesting to zero");
    assert_eq!(vested, total / 2, "exact half of the stream must vest");
    assert!(vested <= total, "vested amount must never exceed the total");
}

/// The widened multiply stays exact for quotients that are not a clean
/// fraction, and never exceeds the stream total (INV-5).
#[test]
fn test_compute_vested_overflow_is_bounded_and_monotonic() {
    let total = i128::MAX;
    let start = 0u64;
    let end = 9u64;

    assert_eq!(compute_vested(total, start, end, 3), total / 3);

    let mut previous = 0i128;
    for now in 1..=end {
        let vested = compute_vested(total, start, end, now);
        assert!(vested <= total, "vesting exceeded the stream total");
        assert!(vested >= previous, "vesting must be non-decreasing");
        previous = vested;
    }
    assert_eq!(previous, total);
}

/// `now >= end_time` short-circuits to the full amount even though the
/// multiply for a fully elapsed stream would overflow.
#[test]
fn test_compute_vested_overflow_fully_vests_at_end() {
    let total = i128::MAX;
    assert_eq!(compute_vested(total, 10, 20, 20), total);
    assert_eq!(compute_vested(total, 10, 20, 1_000), total);
}

/// End-to-end: a stream whose vesting multiply overflows must still pay the
/// recipient the correct remaining balance at every step.
#[test]
fn test_claim_stream_with_overflowing_vesting_pays_correct_balance() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(OphirPayContract, ());
    let client = OphirPayContractClient::new(&env, &contract_id);

    let owner = Address::generate(&env);
    let creator = Address::generate(&env);
    let recipient = Address::generate(&env);
    let sac = create_token_contract(&env, &owner);
    let sac_client = token::StellarAssetClient::new(&env, &sac);
    sac_client.mint(&creator, &i128::MAX);

    let now = env.ledger().timestamp();
    let _ = client.init(&owner);

    let stream_id = client.create_stream(
        &creator,
        &recipient,
        &i128::MAX,
        &sac,
        &now,
        &(now + 4),
        &String::from_str(&env, "overflow"),
    );
    assert_eq!(stream_id, 1);

    // 50% through: the multiply (`MAX * 2`) overflows i128.
    env.ledger().set_timestamp(now + 2);
    let first = client.claim_stream(&recipient, &1);
    assert_eq!(first, i128::MAX / 2, "half of the stream must be claimable");
    assert!(first > 0, "claim must not silently pay nothing");

    // Fully vested: the remainder is exactly what has not been claimed.
    env.ledger().set_timestamp(now + 10);
    let second = client.claim_stream(&recipient, &1);
    assert_eq!(second, i128::MAX - (i128::MAX / 2));

    assert_eq!(client.get_stream(&1).claimed_amount, i128::MAX);
    let token_client = token::Client::new(&env, &sac);
    assert_eq!(token_client.balance(&recipient), i128::MAX);

    // Nothing is left to claim and the stream is not over-paid.
    let third = client.try_claim_stream(&recipient, &1);
    assert!(third.is_err(), "a fully claimed stream must reject further claims");
}

