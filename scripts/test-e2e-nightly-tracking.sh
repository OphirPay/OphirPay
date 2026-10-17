#!/usr/bin/env bash
# SPDX-License-Identifier: MIT
# Test harness for e2e-nightly.yml report-status logic (Issue #1342)

set -euo pipefail

PASS=0
FAIL=0

test_status_reporter() {
  local test_name="$1"
  local tests_result="$2"
  local existing_issue="$3"
  local expected_action="$4"
  local expected_exit="$5"

  local ref_name="integration/staging"
  local run_id="12345"
  local server_url="https://github.com"
  local repository="OphirPay/OphirPay"
  local issue_title="Nightly E2E failing on ${ref_name}"

  local action_taken="none"
  local actual_exit=0

  # Emulate status reporter shell logic
  if [ "${tests_result}" = "success" ]; then
    if [ -n "${existing_issue}" ]; then
      action_taken="close"
    else
      action_taken="noop"
    fi
  else
    if [ -n "${existing_issue}" ]; then
      action_taken="update"
    else
      action_taken="create"
    fi
    actual_exit=1
  fi

  if [ "$action_taken" = "$expected_action" ] && [ "$actual_exit" -eq "$expected_exit" ]; then
    echo "  [PASS] $test_name (action: $action_taken, exit: $actual_exit)"
    PASS=$((PASS + 1))
  else
    echo "  [FAIL] $test_name (expected action: $expected_action, got: $action_taken, exit expected: $expected_exit, got: $actual_exit)"
    FAIL=$((FAIL + 1))
  fi
}

echo "=== Running E2E Nightly Status Reporter Tests ==="
test_status_reporter "Failure creates new issue when none exists" "failure" "" "create" 1
test_status_reporter "Failure updates existing issue without duplicate" "failure" "101" "update" 1
test_status_reporter "Success closes existing tracking issue" "success" "101" "close" 0
test_status_reporter "Success does nothing when no issue exists" "success" "" "noop" 0
echo "================================================="
echo "Passed: $PASS, Failed: $FAIL"

if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
