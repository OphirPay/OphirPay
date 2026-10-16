// SPDX-License-Identifier: MIT
#![cfg(test)]
// Tests for issue #1347: token decimal precision validation in record_payment.
use ophirpay_contract::{OphirPayContract, OphirPayContractClient, PaymentError};
use soroban_sdk::testutils::{Address as _, Ledger as _};
use soroban_sdk::{token, Address, Env, String};

pub struct DecimalTestFixture<'a> {
    pub env: Env,
    pub contract_id: Address,
    pub client: OphirPayContractClient<'a>,
    pub owner: Address,
    pub token_admin: Address,
    pub token_id: Address,
    pub token_client: token::Client<'a>,
    pub token_admin_client: token::StellarAssetClient<'a>,
}

impl<'a> DecimalTestFixture<'a> {
    pub fn new() -> Self {
        let env = Env::default();
        env.mock_all_auths();
        env.ledger().set_timestamp(1_000_000);

        let owner = Address::generate(&env);
        let token_admin = Address::generate(&env);
        let token_id = env.register_stellar_asset_contract(token_admin.clone());
        let token_client = token::Client::new(&env, &token_id);
        let token_admin_client = token::StellarAssetClient::new(&env, &token_id);

        let contract_id = env.register(OphirPayContract, ());
        let client = OphirPayContractClient::new(&env, &contract_id);
        client.init(&owner);

        DecimalTestFixture {
            env,
            contract_id,
            client,
            owner,
            token_admin,
            token_id,
            token_client,
            token_admin_client,
        }
    }

    pub fn mint(&self, to: &Address, amount: i128) {
        self.token_admin_client.mint(to, &amount);
    }
}

#[test]
fn test_payment_with_7_decimals_succeeds() {
    let fix = DecimalTestFixture::new();
    let payer = Address::generate(&fix.env);
    let payee = Address::generate(&fix.env);

    fix.mint(&payer, 10_000_000);

    let tx_hash = String::from_str(&fix.env, "0xabc123");
    let meta = String::from_str(&fix.env, "test");
    let id = fix.client.record_payment(
        &payer,
        &payee,
        &15_000_000i128,
        &fix.token_id,
        &tx_hash,
        &meta,
    );
    assert_eq!(id, 1);
    assert_eq!(fix.client.get_payment_count(), 1);
}

#[test]
fn test_payment_with_7_decimals_fractional_stroop_succeeds() {
    let fix = DecimalTestFixture::new();
    let payer = Address::generate(&fix.env);
    let payee = Address::generate(&fix.env);

    fix.mint(&payer, 10_000_000);

    let tx_hash = String::from_str(&fix.env, "0xabc124");
    let meta = String::from_str(&fix.env, "test");
    let id = fix.client.record_payment(
        &payer,
        &payee,
        &1i128,
        &fix.token_id,
        &tx_hash,
        &meta,
    );
    assert_eq!(id, 1);
}

#[test]
fn test_payment_zero_amount_rejected() {
    let fix = DecimalTestFixture::new();
    let payer = Address::generate(&fix.env);
    let payee = Address::generate(&fix.env);

    fix.mint(&payer, 10_000_000);

    let tx_hash = String::from_str(&fix.env, "0xabc126");
    let meta = String::from_str(&fix.env, "test");
    let result = fix.client.try_record_payment(
        &payer,
        &payee,
        &0i128,
        &fix.token_id,
        &tx_hash,
        &meta,
    );
    assert_eq!(result, Err(Ok(PaymentError::InvalidAmount)));
}

#[test]
fn test_payment_negative_amount_rejected() {
    let fix = DecimalTestFixture::new();
    let payer = Address::generate(&fix.env);
    let payee = Address::generate(&fix.env);

    fix.mint(&payer, 10_000_000);

    let tx_hash = String::from_str(&fix.env, "0xabc127");
    let meta = String::from_str(&fix.env, "test");
    let result = fix.client.try_record_payment(
        &payer,
        &payee,
        &-100i128,
        &fix.token_id,
        &tx_hash,
        &meta,
    );
    assert_eq!(result, Err(Ok(PaymentError::InvalidAmount)));
}
