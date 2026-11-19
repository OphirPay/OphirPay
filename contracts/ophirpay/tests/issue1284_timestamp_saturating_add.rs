#![cfg(test)]
// SPDX-License-Identifier: MIT
//
// Issue #1284 — timestamp arithmetic must use `saturating_add`.
//
// A raw `+` on a ledger timestamp can overflow when the ledger timestamp is
// close to `u64::MAX`, which aborts the host with an opaque arithmetic-error
// panic instead of returning a typed contract error. Every timestamp offset in
// both contracts is therefore computed with `saturating_add`; this test pins
// that convention down at the source level so a new timelock cannot quietly
// reintroduce `+`.
//
// `src/test.rs` and `emitter/src/test.rs` are deliberately excluded: tests add
// small offsets to a fixed, known ledger time where overflow is impossible.

/// Production sources covered by the audit.
const SOURCES: &[(&str, &str)] = &[
    (
        "contracts/ophirpay/src/contract.rs",
        include_str!("../src/contract.rs"),
    ),
    (
        "contracts/ophirpay/src/events.rs",
        include_str!("../src/events.rs"),
    ),
    (
        "contracts/ophirpay/src/helpers.rs",
        include_str!("../src/helpers.rs"),
    ),
    (
        "contracts/ophirpay/src/spending_limit.rs",
        include_str!("../src/spending_limit.rs"),
    ),
    (
        "contracts/ophirpay/src/storage.rs",
        include_str!("../src/storage.rs"),
    ),
    (
        "contracts/emitter/src/lib.rs",
        include_str!("../../emitter/src/lib.rs"),
    ),
];

/// Drop `//` line comments so prose that mentions `now + 1` is not flagged.
fn strip_comments(source: &str) -> String {
    source
        .lines()
        .map(|line| line.split("//").next().unwrap_or(""))
        .collect::<Vec<_>>()
        .join("\n")
}

/// True when `token` — the left operand immediately before a `+` — is a ledger
/// timestamp or a timestamp offset.
fn is_timestamp_operand(token: &str) -> bool {
    let token = token.to_ascii_lowercase();
    if token.is_empty() {
        return false;
    }
    // Matches `timestamp()`, `env.ledger().timestamp()`, `now`, `proposed_at`,
    // `escrow.deadline`, `unlocks_at`, `start_time`, …
    token.ends_with("timestamp()")
        || token == "timestamp"
        || token == "now"
        || token.ends_with("_at")
        || token.contains("deadline")
        || token.contains("expires")
        || token.contains("unlock")
        || token.ends_with("_time")
}

/// Return one entry per raw `+` applied to a timestamp expression.
fn raw_timestamp_additions(source: &str) -> Vec<String> {
    let code: Vec<char> = strip_comments(source)
        .chars()
        .filter(|c| !c.is_whitespace())
        .collect();

    let mut offenders = Vec::new();
    for (index, character) in code.iter().enumerate() {
        if *character != '+' {
            continue;
        }

        // Walk back over the left operand (identifiers, calls, field access).
        let mut start = index;
        while start > 0 {
            let previous = code[start - 1];
            if previous.is_alphanumeric() || matches!(previous, '_' | '(' | ')' | '.') {
                start -= 1;
            } else {
                break;
            }
        }

        let token: String = code[start..index].iter().collect();
        if is_timestamp_operand(&token) {
            offenders.push(format!("`{token}` is offset with a raw `+`"));
        }
    }
    offenders
}

/// The detector itself must be able to tell the two forms apart — otherwise the
/// audit below would pass vacuously.
#[test]
fn detector_recognises_raw_timestamp_arithmetic() {
    assert_eq!(
        raw_timestamp_additions("let eta = env.ledger().timestamp() + 86_400;"),
        vec!["`env.ledger().timestamp()` is offset with a raw `+`"]
    );
    assert_eq!(
        raw_timestamp_additions("let unlock_at = now + TMLOCK_DELAY;").len(),
        1
    );
    assert_eq!(
        raw_timestamp_additions("escrow.deadline = created_at + 60;").len(),
        1
    );
    assert!(raw_timestamp_additions("let eta = now.saturating_add(TMLOCK_DELAY);").is_empty());
    assert!(raw_timestamp_additions("let total = fee + amount;").is_empty());
    // A commented-out example is not code.
    assert!(raw_timestamp_additions("// let eta = now + TMLOCK_DELAY;").is_empty());
}

/// Acceptance criterion for #1284: zero raw `+` arithmetic on timestamps in
/// both contracts.
#[test]
fn production_sources_only_offset_timestamps_with_saturating_add() {
    let mut failures = Vec::new();
    for (path, source) in SOURCES {
        for offender in raw_timestamp_additions(source) {
            failures.push(format!("{path}: {offender}"));
        }
    }

    assert!(
        failures.is_empty(),
        "raw timestamp arithmetic found — use `.saturating_add(...)`:\n{}",
        failures.join("\n")
    );
}
