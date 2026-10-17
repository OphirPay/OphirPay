#![cfg(test)]

use ophirpay::{validate_multisig_config, PaymentError};
use soroban_sdk::{testutils::Address as _, Address, Env, Vec};

#[test]
fn test_multisig_rejects_zero_threshold_and_empty_signers() {
    let env = Env::default();
    let signer1 = Address::generate(&env);
    let signer2 = Address::generate(&env);

    let empty_signers: Vec<Address> = Vec::new(&env);
    assert_eq!(
        validate_multisig_config(1, &empty_signers),
        Err(PaymentError::EmptySignersList)
    );

    let mut two_signers: Vec<Address> = Vec::new(&env);
    two_signers.push_back(signer1);
    two_signers.push_back(signer2);

    assert_eq!(
        validate_multisig_config(0, &two_signers),
        Err(PaymentError::InvalidThreshold)
    );
    assert_eq!(
        validate_multisig_config(3, &two_signers),
        Err(PaymentError::InvalidThreshold)
    );
    assert_eq!(validate_multisig_config(2, &two_signers), Ok(()));
}
