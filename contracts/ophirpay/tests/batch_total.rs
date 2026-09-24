use ophirpay::{validate_batch_amounts, OphirError};

#[test]
fn rejects_sum_that_exceeds_i128_max() {
    let half = i128::MAX / 2;
    let amounts = vec![half; 100];
    assert!(matches!(
        validate_batch_amounts(&amounts),
        Err(OphirError::BatchTotalOverflow)
    ));
}

#[test]
fn rejects_max_plus_one() {
    assert!(matches!(
        validate_batch_amounts(&[i128::MAX, 1]),
        Err(OphirError::BatchTotalOverflow)
    ));
}

#[test]
fn accepts_exact_i128_max() {
    assert_eq!(validate_batch_amounts(&[i128::MAX]).unwrap(), i128::MAX);
    assert_eq!(
        validate_batch_amounts(&[i128::MAX - 1, 1]).unwrap(),
        i128::MAX
    );
}

#[test]
fn accepts_small_positive_sum() {
    assert_eq!(validate_batch_amounts(&[1, 2, 3]).unwrap(), 6);
}
