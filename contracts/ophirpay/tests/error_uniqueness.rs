#![cfg(test)]
// SPDX-License-Identifier: MIT
//
// Issues #717, #766 — Assert every PaymentError variant has a unique numeric code
// and reachable variants partition the allocated code space with documented reserved ranges.
//
// docs/AUDIT.md LOW-6 trimmed the original 308-variant catalog down to the 54
// variants that are actually reachable from contract entrypoints and helpers.
// The freed numeric codes are maintained in documented reserved ranges so future
// additions do not renumber existing codes.

use ophirpay_contract::PaymentError;
use std::collections::{HashMap, HashSet};

/// Returns a list of (variant_name, discriminant) for every reachable PaymentError variant.
fn all_variants() -> Vec<(&'static str, u32)> {
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
        ("InvalidPauseScope", PaymentError::InvalidPauseScope as u32),
    ]
}

/// Documented reserved numeric ranges (inclusive) reserved for future domain features.
fn reserved_ranges() -> Vec<(u32, u32)> {
    vec![
        (15, 16),
        (28, 28),
        (33, 34),
        (43, 44),
        (49, 50),
        (53, 61),
        (63, 64),
        (66, 90),
        (92, 300),
    ]
}

#[test]
fn every_payment_error_discriminant_is_unique() {
    let variants = all_variants();
    let mut seen: HashMap<u32, &str> = HashMap::new();
    let mut duplicates = Vec::new();

    for (name, code) in &variants {
        if let Some(existing) = seen.get(code) {
            duplicates.push(format!(
                "  Code {}: '{}' collides with '{}'",
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
fn allocated_and_reserved_partition_1_to_max() {
    let variants = all_variants();
    let allocated_codes: HashSet<u32> = variants.iter().map(|(_, c)| *c).collect();
    let mut reserved_codes: HashSet<u32> = HashSet::new();

    // Check reserved ranges are well-formed and non-overlapping
    for (start, end) in reserved_ranges() {
        assert!(start <= end, "Invalid reserved range: {}..={}", start, end);
        for code in start..=end {
            assert!(
                reserved_codes.insert(code),
                "Overlapping reserved range for code {}",
                code
            );
            assert!(
                !allocated_codes.contains(&code),
                "Code {} is both allocated and reserved",
                code
            );
        }
    }

    // Pinned ceiling: highest code is currently 308 (InvalidPauseScope)
    let max_code = 308;
    for code in 1..=max_code {
        assert!(
            allocated_codes.contains(&code) || reserved_codes.contains(&code),
            "Code {} is neither allocated nor documented as reserved",
            code
        );
    }

    assert_eq!(
        allocated_codes.len() + reserved_codes.len(),
        max_code as usize,
        "Allocated + reserved count should exactly partition 1..={}",
        max_code
    );
}

#[test]
fn variant_count_matches_catalog() {
    let variants = all_variants();
    // 54 reachable variants in the contract
    assert_eq!(
        variants.len(),
        54,
        "Expected 54 reachable PaymentError variants"
    );
}
