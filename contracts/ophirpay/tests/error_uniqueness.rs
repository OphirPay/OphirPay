#![cfg(test)]
// SPDX-License-Identifier: MIT
//
// Issue #717 — Assert every PaymentError variant has a unique numeric code.
// Issue #766 — Assert the trimmed catalog stays unique, stays within the
// documented ceiling, and never collides with a reserved (unallocated) code.
//
// A duplicate discriminant compiles fine but produces wrong user-facing
// messages at runtime because the TypeScript catalog (src/lib/contract-errors.ts)
// maps codes 1:1. These tests enumerate the allocated discriminants and fail
// with the offending variant names if a collision is found.

use ophirpay_contract::PaymentError;
use std::collections::{HashMap, HashSet};

/// The reserved (unallocated) code ranges documented on the PaymentError enum
/// and in docs/SPEC.md § "Error code allocation". Kept in sync by hand.
const RESERVED_CODE_RANGES: &[(u32, u32)] = &[
    (15, 16),
    (28, 28),
    (33, 34),
    (43, 44),
    (49, 50),
    (53, 61),
    (63, 64),
    (66, 90),
    (92, 300),
];

/// The highest code this contract has ever allocated. The trim in #766 must
/// not raise it, and no new code may exceed it without extending the ceiling.
const MAX_ERROR_CODE: u32 = 307;

/// Returns a list of (variant_name, discriminant) for every allocated
/// PaymentError variant. Maintained by hand because Soroban's
/// `#[contracterror]` does not expose an iterator.
fn allocated_variants() -> Vec<(&'static str, u32)> {
    vec![
        ("NotInitialized", PaymentError::NotInitialized as u32),
        ("AlreadyInitialized", PaymentError::AlreadyInitialized as u32),
        ("PaymentNotFound", PaymentError::PaymentNotFound as u32),
        ("Unauthorized", PaymentError::Unauthorized as u32),
        ("InvalidAmount", PaymentError::InvalidAmount as u32),
        ("EscrowNotDue", PaymentError::EscrowNotDue as u32),
        ("EscrowAlreadyReleased", PaymentError::EscrowAlreadyReleased as u32),
        ("EscrowNotFound", PaymentError::EscrowNotFound as u32),
        ("StreamNotStarted", PaymentError::StreamNotStarted as u32),
        ("StreamAlreadyCancelled", PaymentError::StreamAlreadyCancelled as u32),
        ("StreamNotFound", PaymentError::StreamNotFound as u32),
        ("StreamFullyClaimed", PaymentError::StreamFullyClaimed as u32),
        ("BatchTooLarge", PaymentError::BatchTooLarge as u32),
        ("BatchEmpty", PaymentError::BatchEmpty as u32),
        ("PaymentAlreadyCancelled", PaymentError::PaymentAlreadyCancelled as u32),
        ("ContractPaused", PaymentError::ContractPaused as u32),
        ("NoTokensToWithdraw", PaymentError::NoTokensToWithdraw as u32),
        ("UpgradeNotProposed", PaymentError::UpgradeNotProposed as u32),
        ("UpgradeTimelockActive", PaymentError::UpgradeTimelockActive as u32),
        ("MultisigNotConfigured", PaymentError::MultisigNotConfigured as u32),
        ("NotASigner", PaymentError::NotASigner as u32),
        ("AlreadyApproved", PaymentError::AlreadyApproved as u32),
        ("ThresholdNotMet", PaymentError::ThresholdNotMet as u32),
        ("AlreadyExecuted", PaymentError::AlreadyExecuted as u32),
        ("NotARoleHolder", PaymentError::NotARoleHolder as u32),
        ("AuditEntryNotFound", PaymentError::AuditEntryNotFound as u32),
        ("RecurringNotFound", PaymentError::RecurringNotFound as u32),
        ("RecurringNotDue", PaymentError::RecurringNotDue as u32),
        ("RecurringAlreadyCancelled", PaymentError::RecurringAlreadyCancelled as u32),
        ("FeeTooHigh", PaymentError::FeeTooHigh as u32),
        ("TimelockNotFound", PaymentError::TimelockNotFound as u32),
        ("TimelockNotDue", PaymentError::TimelockNotDue as u32),
        ("TimelockAlreadyExecuted", PaymentError::TimelockAlreadyExecuted as u32),
        ("GovernanceNotConfigured", PaymentError::GovernanceNotConfigured as u32),
        ("ProposalNotFound", PaymentError::ProposalNotFound as u32),
        ("VotingPeriodEnded", PaymentError::VotingPeriodEnded as u32),
        ("ProposalAlreadyExecuted", PaymentError::ProposalAlreadyExecuted as u32),
        ("DepositTooLow", PaymentError::DepositTooLow as u32),
        ("SpendingLimitExpired", PaymentError::SpendingLimitExpired as u32),
        ("RefundNotFound", PaymentError::RefundNotFound as u32),
        ("RefundAlreadyProcessed", PaymentError::RefundAlreadyProcessed as u32),
        ("AlreadyVoted", PaymentError::AlreadyVoted as u32),
        ("ReentrantCall", PaymentError::ReentrantCall as u32),
        ("HookNotFound", PaymentError::HookNotFound as u32),
        ("AssetNotSupported", PaymentError::AssetNotSupported as u32),
        ("MaxSignersExceeded", PaymentError::MaxSignersExceeded as u32),
        ("RevocationNotFound", PaymentError::RevocationNotFound as u32),
        ("RevocationNotDue", PaymentError::RevocationNotDue as u32),
        ("RevocationAlreadyExecuted", PaymentError::RevocationAlreadyExecuted as u32),
        ("CannotRevokeSelf", PaymentError::CannotRevokeSelf as u32),
        ("NoPendingOwner", PaymentError::NoPendingOwner as u32),
        ("MathOverflow", PaymentError::MathOverflow as u32),
        ("StreamInvariantViolated", PaymentError::StreamInvariantViolated as u32),
    ]
}

#[test]
fn every_payment_error_discriminant_is_unique() {
    let variants = allocated_variants();
    let mut seen: HashMap<u32, &str> = HashMap::new();
    let mut duplicates: Vec<String> = Vec::new();

    for (name, code) in &variants {
        if let Some(existing) = seen.get(code) {
            duplicates.push(format!(
                "code {} is shared by '{}' and '{}'",
                code, existing, name
            ));
        } else {
            seen.insert(*code, name);
        }
    }

    assert!(
        duplicates.is_empty(),
        "Duplicate PaymentError discriminants found:\n{}",
        duplicates.join("\n")
    );
}

#[test]
fn allocated_codes_and_reserved_ranges_partition_1_to_max() {
    let mut seen: HashSet<u32> = HashSet::new();

    for (name, code) in allocated_variants() {
        assert!(
            seen.insert(code),
            "'{}' reuses code {}, which is already allocated",
            name,
            code
        );
    }

    let mut previous_high: Option<u32> = None;
    for &(low, high) in RESERVED_CODE_RANGES {
        assert!(low <= high, "reserved range {}-{} is inverted", low, high);
        if let Some(prev) = previous_high {
            assert!(
                low > prev,
                "reserved ranges must be sorted and non-overlapping"
            );
        }
        for code in low..=high {
            assert!(
                seen.insert(code),
                "code {} is listed as reserved but is also allocated",
                code
            );
        }
        previous_high = Some(high);
    }

    for code in 1..=MAX_ERROR_CODE {
        assert!(
            seen.contains(&code),
            "code {} is neither allocated nor documented as reserved",
            code
        );
    }
    assert_eq!(seen.len(), MAX_ERROR_CODE as usize);
}

#[test]
fn allocated_codes_stay_within_the_documented_ceiling() {
    let variants = allocated_variants();
    assert!(
        variants.iter().all(|(_, code)| *code >= 1 && *code <= MAX_ERROR_CODE),
        "every allocated code must stay within 1..={}",
        MAX_ERROR_CODE
    );
    // The highest allocated code is a live error (StreamInvariantViolated),
    // so the ceiling must not be lowered without renumbering it.
    assert!(variants.iter().any(|(_, code)| *code == MAX_ERROR_CODE));
}

#[test]
fn variant_count_matches_catalog() {
    let variants = allocated_variants();
    // The TypeScript catalog should have exactly as many entries as Rust
    // variants. This is verified by the TS-side test; here we record the count.
    assert_eq!(
        variants.len(),
        53,
        "Expected 53 PaymentError variants (issue #766 trim)"
    );
}
