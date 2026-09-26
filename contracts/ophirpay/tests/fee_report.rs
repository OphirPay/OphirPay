// SPDX-License-Identifier: MIT
#![cfg(test)]

//! Fee assertions + machine-readable fee report (issue #743).
//!
//! `OphirPayContract::calculate_fee` is a pure function, so its outputs can be
//! asserted natively without deploying anything. This test:
//!
//!   1. asserts the documented fee invariants (0 bps ⇒ 0, floor rounding,
//!      non-negative and monotonic in bps), so a change in the fee maths fails
//!      CI immediately; and
//!   2. writes the observed outputs as JSON when `OPHIRPAY_FEE_REPORT_PATH` is
//!      set, which `.github/workflows/contract-regression.yml` feeds to
//!      `scripts/check-contract-regressions.mjs` so the PR shows the fee delta
//!      next to the WASM size delta.
//!
//! Local runs are unaffected: without the env var this is a plain assertion
//! test and writes nothing.

use ophirpay_contract::OphirPayContract;
use std::env;
use std::fmt::Write as _;
use std::fs;

/// The amounts (in stroops) and fee rates (in basis points) that make up the
/// committed reference matrix in `contracts/fee-baseline.json`. Keep the two in
/// sync — the regression script fails when an entry is missing from the report.
const AMOUNTS: [i128; 5] = [10_000, 1_000_000, 10_000_000, 1_000_000_000, 333_333];
const FEE_BPS: [u32; 5] = [0, 30, 50, 100, 150];

fn render_report() -> String {
    let mut out = String::from("{\n  \"schemaVersion\": 1,\n  \"fees\": [\n");
    let mut first = true;

    for amount in AMOUNTS {
        for bps in FEE_BPS {
            let fee = OphirPayContract::calculate_fee(amount, bps);
            if !first {
                out.push_str(",\n");
            }
            first = false;
            let _ = write!(out, "    {{ \"amount\": {amount}, \"bps\": {bps}, \"fee\": {fee} }}");
        }
    }

    out.push_str("\n  ]\n}\n");
    out
}

#[test]
fn calculate_fee_holds_documented_invariants() {
    for amount in AMOUNTS {
        for bps in FEE_BPS {
            let fee = OphirPayContract::calculate_fee(amount, bps);

            assert!(fee >= 0, "fee must never be negative: {amount} @ {bps} bps → {fee}");

            if bps == 0 {
                assert_eq!(fee, 0, "a 0 bps rate must charge nothing");
            } else {
                // Floor division: the fee never exceeds the exact proportional
                // share, and never rounds up above it.
                assert!(
                    fee <= amount.saturating_mul(bps as i128) / 10_000,
                    "fee must be floored, not rounded up: {amount} @ {bps} bps → {fee}",
                );
            }
        }
    }
}

#[test]
fn calculate_fee_is_monotonic_in_fee_bps() {
    let amount = 1_000_000i128;
    let mut previous = 0i128;

    for bps in FEE_BPS {
        let fee = OphirPayContract::calculate_fee(amount, bps);
        assert!(
            fee >= previous,
            "fee must not decrease as the rate rises: {bps} bps → {fee} after {previous}",
        );
        previous = fee;
    }
}

#[test]
fn calculate_fee_floors_partial_stroops() {
    // 333_333 * 150 / 10_000 = 4_999.995 → 4_999 stroops. Pins the rounding
    // mode: the fee baseline would flag a switch to rounding-up.
    assert_eq!(OphirPayContract::calculate_fee(333_333, 150), 4_999);
    assert_eq!(OphirPayContract::calculate_fee(333_333, 50), 1_666);
    // Non-positive amounts never charge a fee.
    assert_eq!(OphirPayContract::calculate_fee(0, 150), 0);
    assert_eq!(OphirPayContract::calculate_fee(-1_000, 150), 0);
}

#[test]
fn writes_fee_report_when_requested() {
    let Ok(path) = env::var("OPHIRPAY_FEE_REPORT_PATH") else {
        // Normal local `cargo test` run — nothing to emit.
        return;
    };

    let report = render_report();
    fs::write(&path, report).expect("failed to write the fee report");

    // The report must be parseable by the regression script: re-read it and
    // check that every matrix entry made it in exactly once.
    let written = fs::read_to_string(&path).expect("failed to read back the fee report");
    let expected_entries = AMOUNTS.len() * FEE_BPS.len();
    assert_eq!(
        written.matches("\"fee\":").count(),
        expected_entries,
        "fee report must contain one entry per (amount, bps) pair",
    );
    assert_eq!(
        written.matches("\"amount\":").count(),
        expected_entries,
        "fee report must contain one amount per (amount, bps) pair",
    );
}
