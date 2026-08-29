// SPDX-License-Identifier: MIT
#![cfg(test)]

//! Per-entrypoint gas/fee regression guard (OphirPay #212).
//!
//! Public entrypoints that do real work are invoked once in a clean fixture,
//! and the Soroban host's cost metering ([Env::cost_estimate]) is read
//! immediately after the call. We assert the measured resources stay under
//! recorded ceilings and print a summary so CI reviews can see the absolute
//! numbers.
//!
//! Caveat (mirrors soroban-sdk testutils docs): the contract is registered
//! natively (Rust), not from the compiled Wasm, so VM instantiation/execution
//! costs are NOT included. What IS metered with high fidelity: storage
//! read/write entries, contract events, auth, address operations and all
//! host-function CPU/memory work. The complementary Wasm-code-size guard
//! (`contracts/gas-diff/check-wasm-sizes.sh` + `contracts/gas-diff/wasm-baseline.json`)
//! covers the code-size/rent half. Together they provide the regression floor
//! required by the bounty.
//!
//! Ceilings captured 2026-08-29 from a clean run of this same test
//! (soroban-sdk =27.0.5). Margins: >= 1.5x on every metric. If an intentional
//! change grows a metric past these, update the ceiling — never delete a
//! ceiling silently.

use ophirpay_contract::{OphirPayContract, OphirPayContractClient};
use soroban_sdk::testutils::{Address as _, Ledger as _};
use soroban_sdk::{Address, Env, String, Vec};

// ════════════════════════════════════════════════════════════════
// Measured ceilings — captured 2026-08-29 (see module docs)
// ════════════════════════════════════════════════════════════════
#[derive(Clone)]
struct Ceiling {
    instructions: i64,
    mem_bytes: i64,
    fee_stroops: i64,
}

// Real numbers from clean native runs (soroban-sdk 27.0.5, 2026-08-29):
//   init                     36,673 insns    4,715 mem    59,904,379 fee
//   set_multisig_config     112,469 insns   19,400 mem     2,696,480 fee
//   propose_payment          145,508 insns   28,605 mem     2,621,811 fee
//   approve_payment           97,209 insns   16,455 mem     2,225,446 fee
//   execute_approved_payment 205,638 insns   39,947 mem     2,641,941 fee
//   set_fee_config           187,583 insns   38,831 mem     2,735,438 fee
// Ceilings below = measured x ~1.5 (insns/mem) / x1.5 (fee). The init fee is
// dominated by the SDK's deliberately conservative storage-rent estimate for
// the TTL extension init performs; it is stable run-to-run.
const CEIL_INIT: Ceiling = Ceiling {
    instructions: 80_000,
    mem_bytes: 12_000,
    fee_stroops: 90_000_000,
};
const CEIL_MULTISIG: Ceiling = Ceiling {
    instructions: 200_000,
    mem_bytes: 60_000,
    fee_stroops: 6_000_000,
};
const CEIL_PROPOSE: Ceiling = Ceiling {
    instructions: 250_000,
    mem_bytes: 96_000,
    fee_stroops: 5_000_000,
};
const CEIL_APPROVE: Ceiling = Ceiling {
    instructions: 180_000,
    mem_bytes: 60_000,
    fee_stroops: 4_000_000,
};
const CEIL_EXECUTE: Ceiling = Ceiling {
    instructions: 350_000,
    mem_bytes: 120_000,
    fee_stroops: 5_000_000,
};
const CEIL_FEE_CFG: Ceiling = Ceiling {
    instructions: 300_000,
    mem_bytes: 80_000,
    fee_stroops: 5_000_000,
};

// ── Fixture (no emitter — not needed for core-path gas) ──
struct GasFixture<'a> {
    env: Env,
    client: OphirPayContractClient<'a>,
    owner: Address,
    signer1: Address,
    signer2: Address,
    payee: Address,
    token_id: Address,
}

impl<'a> GasFixture<'a> {
    fn new() -> Self {
        let env = Env::default();
        env.mock_all_auths();
        env.ledger().set_timestamp(1_000_000);

        let owner = Address::generate(&env);
        let signer1 = Address::generate(&env);
        let signer2 = Address::generate(&env);
        let payee = Address::generate(&env);
        let token_admin = Address::generate(&env);
        let token_id = env.register_stellar_asset_contract(token_admin.clone());

        let contract_id = env.register(OphirPayContract, ());
        let client = OphirPayContractClient::new(&env, &contract_id);
        client.init(&owner);

        GasFixture {
            env,
            client,
            owner,
            signer1,
            signer2,
            payee,
            token_id,
        }
    }

    fn setup_multisig(&self, threshold: u32) {
        let signers: Vec<Address> =
            Vec::from_array(&self.env, [self.signer1.clone(), self.signer2.clone()]);
        self.client
            .set_multisig_config(&self.owner, &threshold, &signers, &true);
    }
}

// ── Measurement helper ─────────────────────────────────────────
#[derive(Clone)]
struct Measured {
    entrypoint: &'static str,
    instructions: i64,
    mem_bytes: i64,
    fee_stroops: i64,
}

fn snapshot(env: &Env, name: &'static str) -> Measured {
    let r = env.cost_estimate().resources();
    let f = env.cost_estimate().fee();
    Measured {
        entrypoint: name,
        instructions: r.instructions,
        mem_bytes: r.mem_bytes,
        fee_stroops: f.total,
    }
}

fn print_summary(rows: &[Measured]) {
    println!("\n── OphirPay per-entrypoint gas report (soroban-sdk 27.0.5) ──");
    println!(
        "{:<28} {:>14} {:>12} {:>14}",
        "entrypoint", "cpu_insns", "mem_bytes", "fee_stroops"
    );
    for r in rows {
        println!(
            "{:<28} {:>14} {:>12} {:>14}",
            r.entrypoint, r.instructions, r.mem_bytes, r.fee_stroops
        );
    }
    println!("── end report ──\n");
}

fn assert_within(m: &Measured, ceil: &Ceiling) {
    assert!(
        m.instructions <= ceil.instructions,
        "{}: {} insns > ceiling {}",
        m.entrypoint,
        m.instructions,
        ceil.instructions
    );
    assert!(
        m.mem_bytes <= ceil.mem_bytes,
        "{}: {} mem > ceiling {}",
        m.entrypoint,
        m.mem_bytes,
        ceil.mem_bytes
    );
    assert!(
        m.fee_stroops <= ceil.fee_stroops,
        "{}: {} fee > ceiling {}",
        m.entrypoint,
        m.fee_stroops,
        ceil.fee_stroops
    );
}

// ════════════════════════════════════════════════════════════════
// Tests
// ════════════════════════════════════════════════════════════════

// init is measured in a fresh env (no prior calls to pollute metering).
#[test]
fn gas_init() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_timestamp(1_000_000);
    let owner = Address::generate(&env);
    let contract_id = env.register(OphirPayContract, ());
    let client = OphirPayContractClient::new(&env, &contract_id);
    client.init(&owner);

    let m = snapshot(&env, "init");
    print_summary(&[m.clone()]);
    assert_within(&m, &CEIL_INIT);
}

// Multisig configuration + full payment lifecycle, threshold = 1 (single signer
// can drive propose -> approve -> execute). Mirrors integration_tests::new.
#[test]
fn gas_multisig_and_payment_lifecycle() {
    let mut f = GasFixture::new();
    f.setup_multisig(1);

    let m_msig = snapshot(&f.env, "set_multisig_config");

    // propose
    f.client.propose_payment(
        &f.signer1,
        &f.payee,
        &100_000_000,
        &f.token_id,
        &String::from_str(&f.env, "0xabc123"),
    );
    let m_propose = snapshot(&f.env, "propose_payment");

    // approve (threshold 1 -> met)
    f.client.approve_payment(&f.signer1, &1);
    let m_approve = snapshot(&f.env, "approve_payment");

    // execute
    f.client.execute_approved_payment(&f.signer1, &1);
    let m_execute = snapshot(&f.env, "execute_approved_payment");

    // fee config update
    f.client
        .set_fee_config(&f.owner, &25, &10, &5, &10, &1, &true);
    let m_fee = snapshot(&f.env, "set_fee_config");

    print_summary(&[
        m_msig.clone(),
        m_propose.clone(),
        m_approve.clone(),
        m_execute.clone(),
        m_fee.clone(),
    ]);

    assert_within(&m_msig, &CEIL_MULTISIG);
    assert_within(&m_propose, &CEIL_PROPOSE);
    assert_within(&m_approve, &CEIL_APPROVE);
    assert_within(&m_execute, &CEIL_EXECUTE);
    assert_within(&m_fee, &CEIL_FEE_CFG);
}
