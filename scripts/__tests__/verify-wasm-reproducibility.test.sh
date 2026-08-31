#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════════
# Unit Tests for scripts/verify-wasm-reproducibility.sh
# ══════════════════════════════════════════════════════════════════
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCRIPT="${ROOT}/scripts/verify-wasm-reproducibility.sh"
TMP_DIR="$(mktemp -d)"

cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

TESTS_RUN=0
TESTS_PASSED=0

assert_eq() {
  local expected="$1"
  local actual="$2"
  local msg="$3"
  TESTS_RUN=$((TESTS_RUN + 1))
  if [[ "$expected" == "$actual" ]]; then
    echo "  ✅ PASS: $msg"
    TESTS_PASSED=$((TESTS_PASSED + 1))
  else
    echo "  ❌ FAIL: $msg (expected '$expected', got '$actual')"
    exit 1
  fi
}

assert_contains() {
  local haystack="$1"
  local needle="$2"
  local msg="$3"
  TESTS_RUN=$((TESTS_RUN + 1))
  if [[ "$haystack" == *"$needle"* ]]; then
    echo "  ✅ PASS: $msg"
    TESTS_PASSED=$((TESTS_PASSED + 1))
  else
    echo "  ❌ FAIL: $msg (string '$needle' not found in output)"
    echo "Output was:"
    echo "$haystack"
    exit 1
  fi
}

echo "══════════════════════════════════════════════════════════════════"
echo "  Testing scripts/verify-wasm-reproducibility.sh"
echo "══════════════════════════════════════════════════════════════════"

# Setup dummy artifacts
DUMMY_DIR="${TMP_DIR}/test_artifacts"
mkdir -p "$DUMMY_DIR"
echo "contract-byte-data-v1" > "${DUMMY_DIR}/contract1.wasm"
echo "contract-byte-data-v2" > "${DUMMY_DIR}/contract2.wasm"

if command -v sha256sum >/dev/null 2>&1; then
  HASH1="$(sha256sum "${DUMMY_DIR}/contract1.wasm" | awk '{print $1}')"
  HASH2="$(sha256sum "${DUMMY_DIR}/contract2.wasm" | awk '{print $1}')"
else
  HASH1="$(shasum -a 256 "${DUMMY_DIR}/contract1.wasm" | awk '{print $1}')"
  HASH2="$(shasum -a 256 "${DUMMY_DIR}/contract2.wasm" | awk '{print $1}')"
fi

# Test 1: Matching Checksums pass
echo "Test 1: Matching checksums pass with exit 0"
CHECKSUM_FILE_1="${TMP_DIR}/pass.sha256"
cat << EOF > "$CHECKSUM_FILE_1"
# Test comment
${HASH1}  ${DUMMY_DIR}/contract1.wasm
${HASH2}  ${DUMMY_DIR}/contract2.wasm
EOF

OUTPUT_1="$("$SCRIPT" --checksums "$CHECKSUM_FILE_1" 2>&1)"
STATUS_1=$?
assert_eq 0 "$STATUS_1" "Exit code is 0 on match"
assert_contains "$OUTPUT_1" "REPRODUCIBILITY VERIFIED" "Output reports verification success"
assert_contains "$OUTPUT_1" "contract1.wasm" "Lists contract1.wasm"
assert_contains "$OUTPUT_1" "contract2.wasm" "Lists contract2.wasm"

# Test 2: Mismatched Checksums fail and output BOTH expected and actual hashes
echo "Test 2: Mismatched checksums fail and output both hashes"
CHECKSUM_FILE_2="${TMP_DIR}/fail.sha256"
FAKE_HASH="111122223333444455556666777788889999aaaabbbbccccddddeeeeffff0000"
cat << EOF > "$CHECKSUM_FILE_2"
${FAKE_HASH}  ${DUMMY_DIR}/contract1.wasm
EOF

set +e
OUTPUT_2="$("$SCRIPT" --checksums "$CHECKSUM_FILE_2" 2>&1)"
STATUS_2=$?
set -e
assert_eq 1 "$STATUS_2" "Exit code is 1 on hash mismatch"
assert_contains "$OUTPUT_2" "Expected Hash: ${FAKE_HASH}" "Output includes expected hash"
assert_contains "$OUTPUT_2" "Actual Hash:   ${HASH1}" "Output includes actual hash"
assert_contains "$OUTPUT_2" "REPRODUCIBILITY FAILED" "Output reports failure"

# Test 3: Missing artifact fails
echo "Test 3: Missing artifact fails"
CHECKSUM_FILE_3="${TMP_DIR}/missing.sha256"
cat << EOF > "$CHECKSUM_FILE_3"
${HASH1}  ${DUMMY_DIR}/nonexistent.wasm
EOF

set +e
OUTPUT_3="$("$SCRIPT" --checksums "$CHECKSUM_FILE_3" 2>&1)"
STATUS_3=$?
set -e
assert_eq 1 "$STATUS_3" "Exit code is 1 on missing artifact"
assert_contains "$OUTPUT_3" "Missing WASM Artifact" "Output reports missing artifact"

# Test 4: Missing checksum file fails
echo "Test 4: Missing checksum file fails"
set +e
OUTPUT_4="$("$SCRIPT" --checksums "${TMP_DIR}/not_found.sha256" 2>&1)"
STATUS_4=$?
set -e
assert_eq 1 "$STATUS_4" "Exit code is 1 on missing checksum file"
assert_contains "$OUTPUT_4" "Checksum file not found" "Output reports missing checksum file"

echo "══════════════════════════════════════════════════════════════════"
echo "✅ All ${TESTS_PASSED}/${TESTS_RUN} unit test assertions passed!"
echo "══════════════════════════════════════════════════════════════════"
