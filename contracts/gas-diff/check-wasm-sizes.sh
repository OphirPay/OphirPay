#!/usr/bin/env bash
# SPDX-License-Identifier: MIT
#
# OphirPay #212 - contract gas-diff regression guard.
#
# Fails CI when the optimized WASM artifacts grow significantly vs the
# checked-in baseline (contracts/gas-diff/wasm-baseline.json) or exceed the
# hard 128 KB (131072 B) protocol limit. Reports values to the GitHub job
# summary when run under actions/upload-artifact CI (writes to
# "$GITHUB_STEP_SUMMARY" if set) and to stdout otherwise.
#
# Usage:
#   check-wasm-sizes.sh [OPHIRPAY_WASM] [EMITTER_WASM]
# If paths are omitted, the script attempts to locate the artifacts at the
# usual cargo target path for the wasm32v1-none target.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BASELINE_FILE="$SCRIPT_DIR/wasm-baseline.json"
PROTOCOL_LIMIT=$((128 * 1024))

die() { echo "check-wasm-sizes: $*" >&2; exit 1; }

[ -f "$BASELINE_FILE" ] || die "baseline manifest not found: $BASELINE_FILE"

# ----- locate artifacts ----------------------------------------------------
OPHIR_WASM="${1:-}"
EMIT_WASM="${2:-}"
if [ -z "$OPHIR_WASM" ]; then
  CAND="contracts/ophirpay/target/wasm32v1-none/release/ophirpay_contract.wasm"
  [ -f "$CAND" ] && OPHIR_WASM="$CAND"
fi
if [ -z "$EMIT_WASM" ]; then
  CAND="contracts/emitter/target/wasm32v1-none/release/ophirpay_emitter.wasm"
  [ -f "$CAND" ] && EMIT_WASM="$CAND"
fi
[ -n "$OPHIR_WASM" ] && [ -f "$OPHIR_WASM" ] || die "ophirpay contract WASM not found (pass path or run from repo root)"
[ -n "$EMIT_WASM" ] && [ -f "$EMIT_WASM" ] || die "emitter WASM not found (pass path or run from repo root)"

# ----- read baseline -------------------------------------------------------
[ -x "/usr/bin/python3" ] || die "python3 required to parse baseline"
OPHIR_BASE="$(python3 -c "import json; print(json.load(open('$BASELINE_FILE'))['baselines']['ophirpay_contract.wasm']['optimized_bytes'])")"
EMIT_BASE="$(python3 -c "import json; print(json.load(open('$BASELINE_FILE'))['baselines']['ophirpay_emitter.wasm']['optimized_bytes'])")"
ALERT_PCT="$(python3 -c "import json; print(json.load(open('$BASELINE_FILE'))['policy']['alert_growth_pct'])")"
BLOCK_PCT="$(python3 -c "import json; print(json.load(open('$BASELINE_FILE'))['policy']['blocker_growth_pct'])")"

# ----- measure -------------------------------------------------------------
ophir_bytes=$(stat -c %s "$OPHIR_WASM")
emit_bytes=$(stat -c %s "$EMIT_WASM")

ophir_growth="$(python3 -c "print(round(($ophir_bytes - $OPHIR_BASE) / $OPHIR_BASE * 100, 1))")"
emit_growth="$(python3 -c "print(round(($emit_bytes - $EMIT_BASE) / $EMIT_BASE * 100, 1))")"

# ----- report ---------------------------------------------------------------
report="## Contract WASM size guard (#212)

| Artifact | Baseline (B) | Current (B) | Growth | Status |
|---|---|---|---|---|
| ophirpay_contract.wasm | $OPHIR_BASE | $ophir_bytes | ${ophir_growth}% | |
| ophirpay_emitter.wasm | $EMIT_BASE | $emit_bytes | ${emit_growth}% | |

Hard protocol limit: 128 KiB per contract.
"
SUMMARY="${GITHUB_STEP_SUMMARY:-}"
if [ -n "$SUMMARY" ]; then
  printf '%s\n' "$report" >> "$SUMMARY"
fi

# ----- verdict --------------------------------------------------------------
fail=0
for name_bytes in "ophirpay_contract.wasm:$ophir_bytes:$OPHIR_BASE:$ophir_growth" "ophirpay_emitter.wasm:$emit_bytes:$EMIT_BASE:$emit_growth"; do
  IFS=: read -r name cur base growth <<<"$name_bytes"
  if [ "$cur" -gt $PROTOCOL_LIMIT ]; then
    echo "FAIL [$name]: $cur B exceeds hard protocol limit $PROTOCOL_LIMIT B"
    fail=1
  fi
  gt="$(python3 -c "print(1 if $growth > $BLOCK_PCT else 0)")"
  if [ "$gt" = "1" ]; then
    echo "FAIL [$name]: grew ${growth}% vs baseline ($base B) - exceeds blocker threshold ${BLOCK_PCT}%"
    fail=1
  else
    gt2="$(python3 -c "print(1 if $growth > $ALERT_PCT else 0)")"
    if [ "$gt2" = "1" ]; then
      echo "WARN [$name]: grew ${growth}% vs baseline ($base B) - over alert threshold ${ALERT_PCT}%, under blocker ${BLOCK_PCT}%"
    else
      echo "OK   [$name]: ${cur} B (baseline $base B, ${growth}%)"
    fi
  fi
done
exit "$fail"
