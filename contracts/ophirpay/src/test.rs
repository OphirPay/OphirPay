#[cfg(test)]
mod test {
    use crate::{OphirPay, OphirPayClient, PaymentError};
    use soroban_sdk::{testutils::Address as _, Address, Env};

    #[test]
    fn test_spending_limit_exceeded() {
        // 1. Setup the Soroban environment
        let env = Env::default();
        env.mock_all_auths();

        // 2. Register the contract and create a client
        let contract_id = env.register_contract(None, OphirPay);
        let client = OphirPayClient::new(&env, &contract_id);

        // 3. Define test variables
        let user = Address::generate(&env);
        let spending_limit = 1_000i128;
        let first_payment = 600i128;
        let second_payment = 500i128;

        // 4. Configure 1,000 stroop spending limit
        // Note: Assuming set_spending_limit is the administrative function to set limits
        client.set_spending_limit(&user, &spending_limit);

        // 5. Execute first payment of 600 stroops (Should succeed)
        client.pay(&user, &first_payment);

        // 6. Execute second payment of 500 stroops (Should fail)
        // We use try_pay to capture the Result and assert the specific error
        let result = client.try_pay(&user, &second_payment);

        // 7. Assert that the second payment fails with SpendingLimitExceeded
        assert_eq!(
            result,
            Err(Ok(PaymentError::SpendingLimitExceeded))
        );
    }
}
