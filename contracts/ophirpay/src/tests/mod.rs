use super::*;
use soroban_sdk::testutils::{Address as _, Ledger as _};
use soroban_sdk::{vec, String, Vec};

pub(crate) fn create_token_contract(e: &Env, admin: &Address) -> Address {
    e.register_stellar_asset_contract(admin.clone())
}

mod admin_tests;
mod batch_tests;
mod escrow_tests;
mod governance_tests;
mod hook_and_orchestration_tests;
mod lifecycle_and_reentrancy_tests;
mod multisig_tests;
mod pause_tests;
mod payment_tests;
mod rbac_and_audit_tests;
mod recurring_tests;
mod refund_tests;
mod spending_tests;
mod storage_tests;
mod stream_tests;
mod versioning_and_ownership_tests;
