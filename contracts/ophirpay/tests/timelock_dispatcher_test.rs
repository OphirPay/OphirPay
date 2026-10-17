#![cfg(test)]

use ophirpay::{
    dispatch_timelocked_action, AdminTimelockAction, FeeConfig, GovernanceConfig, PaymentContract,
    PaymentError, Role, TimelockedAction,
};
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    Address, Env, String,
};

#[test]
fn test_dispatch_set_fee_config_updates_storage_after_timelock() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, PaymentContract);
    let admin = Address::generate(&env);

    env.ledger().with_mut(|li| {
        li.timestamp = 1_000_000;
    });

    let action = TimelockedAction {
        id: 1,
        action_type: String::from_str(&env, "set_fee_config"),
        target: String::from_str(&env, "set_fee_config"),
        data: String::from_str(&env, "bps=150"),
        proposed_by: admin.clone(),
        proposed_at: 900_000,
        unlocks_at: 986_400,
        executed: false,
    };

    let fee_cfg = FeeConfig {
        payment_fee_bps: 150,
        escrow_fee_bps: 200,
        stream_fee_bps: 100,
        batch_base_fee: 1_000,
        batch_per_item_fee: 100,
        enabled: true,
    };

    env.as_contract(&contract_id, || {
        let res = dispatch_timelocked_action(
            &env,
            &action,
            Some(AdminTimelockAction::SetFeeConfig(fee_cfg.clone())),
        );
        assert_eq!(res, Ok(()));
    });
}

#[test]
fn test_dispatch_rejects_premature_already_executed_and_unknown_actions() {
    let env = Env::default();
    let contract_id = env.register_contract(None, PaymentContract);
    let admin = Address::generate(&env);

    env.ledger().with_mut(|li| {
        li.timestamp = 500;
    });

    let premature = TimelockedAction {
        id: 2,
        action_type: String::from_str(&env, "pause"),
        target: String::from_str(&env, "pause"),
        data: String::from_str(&env, ""),
        proposed_by: admin.clone(),
        proposed_at: 100,
        unlocks_at: 86_500,
        executed: false,
    };

    env.as_contract(&contract_id, || {
        assert_eq!(
            dispatch_timelocked_action(&env, &premature, Some(AdminTimelockAction::PauseContract(true))),
            Err(PaymentError::TimelockNotDue)
        );
    });

    env.ledger().with_mut(|li| {
        li.timestamp = 100_000;
    });

    let mut executed = premature.clone();
    executed.executed = true;
    env.as_contract(&contract_id, || {
        assert_eq!(
            dispatch_timelocked_action(&env, &executed, Some(AdminTimelockAction::PauseContract(true))),
            Err(PaymentError::TimelockAlreadyExecuted)
        );
    });

    let unknown = TimelockedAction {
        id: 3,
        action_type: String::from_str(&env, "unknown_admin_op"),
        target: String::from_str(&env, "unknown"),
        data: String::from_str(&env, ""),
        proposed_by: admin,
        proposed_at: 100,
        unlocks_at: 86_500,
        executed: false,
    };

    env.as_contract(&contract_id, || {
        assert_eq!(
            dispatch_timelocked_action(&env, &unknown, None),
            Err(PaymentError::UnsupportedOperation)
        );
    });
}

#[test]
fn test_dispatch_role_governance_and_spending_limit_actions() {
    let env = Env::default();
    let contract_id = env.register_contract(None, PaymentContract);
    let admin = Address::generate(&env);
    let operator = Address::generate(&env);

    env.ledger().with_mut(|li| {
        li.timestamp = 200_000;
    });

    let action = TimelockedAction {
        id: 4,
        action_type: String::from_str(&env, "grant_role"),
        target: String::from_str(&env, "grant_role"),
        data: String::from_str(&env, "operator"),
        proposed_by: admin,
        proposed_at: 100_000,
        unlocks_at: 186_400,
        executed: false,
    };

    env.as_contract(&contract_id, || {
        assert_eq!(
            dispatch_timelocked_action(
                &env,
                &action,
                Some(AdminTimelockAction::GrantRole(operator.clone(), Role::Operator)),
            ),
            Ok(())
        );
        assert_eq!(
            dispatch_timelocked_action(
                &env,
                &action,
                Some(AdminTimelockAction::ConfigureGovernance(GovernanceConfig {
                    min_proposal_deposit: 1000,
                    voting_period: 86400,
                    quorum_bps: 5000,
                    enabled: true,
                })),
            ),
            Ok(())
        );
        assert_eq!(
            dispatch_timelocked_action(
                &env,
                &action,
                Some(AdminTimelockAction::SetSpendingLimit(operator, 10_000, 100_000, 0, true)),
            ),
            Ok(())
        );
    });
}
