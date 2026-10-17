#!/usr/bin/env bash
# SPDX-License-Identifier: MIT
# Test harness for .github/workflows/enforce-integration-branch.yml logic (Issue #1341)

set -euo pipefail

PASS_COUNT=0
FAIL_COUNT=0

run_guard() {
  local mock_api_output="$1"
  local mock_api_exit="$2"
  local head_ref="$3"
  local base_ref="$4"
  local pr_number="999"
  local integration_branch="integration/staging"

  # Emulate the workflow script step
  local api_output="$mock_api_output"
  local api_exit="$mock_api_exit"

  if [ "$api_exit" -eq 0 ]; then
    : # branch exists
  else
    local http_status
    http_status=$(echo "$api_output" | grep -m 1 -E '^HTTP/[0-9.]+[[:space:]]+[0-9]+' | awk '{print $2}' || true)

    if [ "$http_status" = "404" ] || echo "$api_output" | grep -q "HTTP 404"; then
      return 0
    fi

    # Non-404 API error fails closed
    return 1
  fi

  if [ "$head_ref" = "$integration_branch" ]; then
    return 0
  fi

  if [ "$base_ref" = "main" ]; then
    return 1
  fi

  return 0
}

assert_result() {
  local desc="$1"
  local expected_exit="$2"
  local mock_output="$3"
  local mock_exit="$4"
  local head="$5"
  local base="$6"

  local actual_exit=0
  run_guard "$mock_output" "$mock_exit" "$head" "$base" || actual_exit=$?

  if [ "$actual_exit" -eq "$expected_exit" ]; then
    echo "  [PASS] $desc (expected $expected_exit, got $actual_exit)"
    PASS_COUNT=$((PASS_COUNT + 1))
  else
    echo "  [FAIL] $desc (expected $expected_exit, got $actual_exit)"
    FAIL_COUNT=$((FAIL_COUNT + 1))
  fi
}

echo "=== Running Enforce Integration Branch Test Suite ==="

# 1. 200 OK: Branch exists, PR targets main -> should fail (exit 1)
assert_result "200 OK: PR targets main while branch exists" \
  1 \
  "HTTP/2.0 200 OK"$'\n'"{\"ref\":\"refs/heads/integration/staging\"}" \
  0 \
  "feature/foo" \
  "main"

# 2. 200 OK: Branch exists, PR targets integration/staging -> should pass (exit 0)
assert_result "200 OK: PR targets integration/staging while branch exists" \
  0 \
  "HTTP/2.0 200 OK"$'\n'"{\"ref\":\"refs/heads/integration/staging\"}" \
  0 \
  "feature/foo" \
  "integration/staging"

# 3. 200 OK: Branch exists, PR is integration/staging merging itself -> should pass (exit 0)
assert_result "200 OK: PR is integration/staging merging itself" \
  0 \
  "HTTP/2.0 200 OK"$'\n'"{\"ref\":\"refs/heads/integration/staging\"}" \
  0 \
  "integration/staging" \
  "main"

# 4. 404 Not Found: Branch does not exist (batch mode over), PR targets main -> should pass (exit 0)
assert_result "404 Not Found: Branch does not exist, PR targets main" \
  0 \
  "HTTP/2.0 404 Not Found"$'\n'"{\"message\":\"Not Found\"}"$'\n'"gh: Not Found (HTTP 404)" \
  1 \
  "feature/foo" \
  "main"

# 5. 403 Forbidden / Rate limit: Must fail closed (exit 1)
assert_result "403 Forbidden (Rate limit): Must fail closed" \
  1 \
  "HTTP/2.0 403 Forbidden"$'\n'"{\"message\":\"API rate limit exceeded\"}"$'\n'"gh: API rate limit exceeded (HTTP 403)" \
  1 \
  "feature/foo" \
  "integration/staging"

# 6. 500 Internal Server Error: Must fail closed (exit 1)
assert_result "500 Server Error: Must fail closed" \
  1 \
  "HTTP/2.0 500 Internal Server Error"$'\n'"{\"message\":\"Internal error\"}" \
  1 \
  "feature/foo" \
  "integration/staging"

# 7. Network / connection dropped (no HTTP header): Must fail closed (exit 1)
assert_result "Network drop / connection failure: Must fail closed" \
  1 \
  "gh: dial tcp 140.82.121.4:443: connect: connection refused" \
  1 \
  "feature/foo" \
  "integration/staging"

echo "======================================================"
echo "Tests passed: $PASS_COUNT, failed: $FAIL_COUNT"

if [ "$FAIL_COUNT" -gt 0 ]; then
  exit 1
fi
