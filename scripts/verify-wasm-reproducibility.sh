#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════════
# OphirPay — Smart Contract WASM Reproducibility Verification
# ══════════════════════════════════════════════════════════════════
# Verifies that built contract WASM artifacts match committed SHA-256
# hashes when built using the pinned toolchain.
#
# Acceptance Criteria:
# 1. Build in pinned toolchain (Rust 1.91.0, wasm32v1-none)
# 2. Hash comparison against committed expected hashes
# 3. Failure output includes BOTH expected and actual hashes
#
# Usage:
#   bash scripts/verify-wasm-reproducibility.sh
#   bash scripts/verify-wasm-reproducibility.sh --checksums contracts/checksums.sha256
#   bash scripts/verify-wasm-reproducibility.sh --update
# ══════════════════════════════════════════════════════════════════
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

CHECKSUM_FILE="${CHECKSUM_FILE:-contracts/checksums.sha256}"
UPDATE_MODE=0
TARGET_NAME="${TARGET_NAME:-wasm32v1-none}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --checksums|--checksums-file)
      CHECKSUM_FILE="$2"
      shift 2
      ;;
    --target)
      TARGET_NAME="$2"
      shift 2
      ;;
    --update)
      UPDATE_MODE=1
      shift
      ;;
    -h|--help)
      echo "Usage: $0 [--checksums <file>] [--target <target>] [--update]"
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 1
      ;;
  esac
done

# Helper function to compute SHA-256 hash of a file
compute_sha256() {
  local file="$1"
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$file" | awk '{print $1}'
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$file" | awk '{print $1}'
  elif command -v openssl >/dev/null 2>&1; then
    openssl dgst -sha256 "$file" | awk '{print $NF}'
  else
    echo "Error: No SHA-256 utility found (sha256sum, shasum, openssl)" >&2
    exit 1
  fi
}

# Normalize string to lowercase
to_lower() {
  echo "$1" | tr '[:upper:]' '[:lower:]'
}

# Resolve candidate WASM path
resolve_wasm_path() {
  local declared_path="$1"
  local base
  base="$(basename "$declared_path")"

  # 1. Direct path check
  if [[ -f "$declared_path" ]]; then
    echo "$declared_path"
    return 0
  fi

  # 2. Check in specific contract target dirs
  local candidates=(
    "contracts/ophirpay/target/${TARGET_NAME}/release/${base}"
    "contracts/emitter/target/${TARGET_NAME}/release/${base}"
    "contracts/ophirpay/target/wasm32-unknown-unknown/release/${base}"
    "contracts/emitter/target/wasm32-unknown-unknown/release/${base}"
    "target/${TARGET_NAME}/release/${base}"
    "target/wasm32-unknown-unknown/release/${base}"
  )

  for cand in "${candidates[@]}"; do
    if [[ -f "$cand" ]]; then
      echo "$cand"
      return 0
    fi
  done

  echo "$declared_path"
  return 1
}

# Update mode: recalculate and rewrite checksums file
if [[ "$UPDATE_MODE" -eq 1 ]]; then
  echo "=== Updating WASM Checksums (${CHECKSUM_FILE}) ==="
  ARTIFACTS=(
    "contracts/emitter/target/${TARGET_NAME}/release/ophirpay_emitter.wasm"
    "contracts/ophirpay/target/${TARGET_NAME}/release/ophirpay_contract.wasm"
  )

  OUTPUT_CONTENT="# OphirPay Smart Contract WASM SHA-256 Checksums
# Pinned Toolchain: Rust 1.91.0 (dtolnay/rust-toolchain@1.91.0)
# Pinned Target: ${TARGET_NAME}
#
# Generated & verified for deterministic bytecode reproducibility.
# To verify locally: bash scripts/verify-wasm-reproducibility.sh
# To update hashes: bash scripts/verify-wasm-reproducibility.sh --update
"

  for art in "${ARTIFACTS[@]}"; do
    resolved_path="$(resolve_wasm_path "$art" || true)"
    if [[ -f "$resolved_path" ]]; then
      hash="$(compute_sha256 "$resolved_path")"
      OUTPUT_CONTENT+="${hash}  ${art}"$'\n'
      echo "  Updated $(basename "$art"): ${hash}"
    else
      echo "  ⚠️ Warning: ${art} not found (skipped)" >&2
    fi
  done

  printf '%s' "$OUTPUT_CONTENT" > "$CHECKSUM_FILE"
  echo "✅ Checksum file updated successfully: ${CHECKSUM_FILE}"
  exit 0
fi

# Verification mode
if [[ ! -f "$CHECKSUM_FILE" ]]; then
  echo "❌ Error: Checksum file not found at '${CHECKSUM_FILE}'" >&2
  exit 1
fi

echo "══════════════════════════════════════════════════════════════════"
echo "  OphirPay Contract WASM Reproducibility Check"
echo "  Checksums: ${CHECKSUM_FILE}"
echo "══════════════════════════════════════════════════════════════════"

PASSED_COUNT=0
FAILED_COUNT=0
TOTAL_COUNT=0
FAILURES=""

while IFS= read -r line || [[ -n "$line" ]]; do
  # Trim whitespace
  line="$(echo "$line" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')"

  # Skip blank lines and comment lines
  if [[ -z "$line" || "$line" =~ ^# ]]; then
    continue
  fi

  TOTAL_COUNT=$((TOTAL_COUNT + 1))
  expected_hash="$(echo "$line" | awk '{print $1}')"
  declared_path="$(echo "$line" | awk '{print $2}')"
  artifact_name="$(basename "$declared_path")"

  resolved_path="$(resolve_wasm_path "$declared_path" || true)"

  if [[ ! -f "$resolved_path" ]]; then
    FAILED_COUNT=$((FAILED_COUNT + 1))
    FAILURES="${FAILURES}   - Artifact Missing: ${artifact_name}"$'\n'
    echo "❌ [FAIL] Missing WASM Artifact: ${artifact_name}"
    echo "   Declared Path: ${declared_path}"
    echo "   Searched Path: ${resolved_path}"
    echo "   Expected Hash: ${expected_hash}"
    echo "   Actual Hash:   <file not found>"
    echo ""
    continue
  fi

  actual_hash="$(compute_sha256 "$resolved_path")"

  expected_lower="$(to_lower "$expected_hash")"
  actual_lower="$(to_lower "$actual_hash")"

  # Case-insensitive string comparison
  if [[ "$expected_lower" == "$actual_lower" ]]; then
    PASSED_COUNT=$((PASSED_COUNT + 1))
    echo "✅ [PASS] ${artifact_name}"
    echo "   Path:     ${resolved_path}"
    echo "   Hash:     ${actual_hash}"
    echo "   Status:   Byte-for-byte reproducible"
    echo ""
  else
    FAILED_COUNT=$((FAILED_COUNT + 1))
    FAILURES="${FAILURES}   - Hash Mismatch: ${artifact_name}"$'\n'
    echo "❌ [FAIL] ${artifact_name}: WASM Reproducibility Mismatch!"
    echo "   Path:          ${resolved_path}"
    echo "   Expected Hash: ${expected_hash}"
    echo "   Actual Hash:   ${actual_hash}"
    echo "   Diff:          Byte digests differ from committed expected hash"
    echo ""
  fi
done < "$CHECKSUM_FILE"

echo "══════════════════════════════════════════════════════════════════"
if [[ "$FAILED_COUNT" -eq 0 && "$TOTAL_COUNT" -gt 0 ]]; then
  echo "✅ REPRODUCIBILITY VERIFIED: ${PASSED_COUNT}/${TOTAL_COUNT} contract WASM artifacts matched expected hashes."
  echo "══════════════════════════════════════════════════════════════════"
  exit 0
else
  echo "❌ REPRODUCIBILITY FAILED: ${FAILED_COUNT}/${TOTAL_COUNT} artifact(s) failed validation."
  printf '%s' "$FAILURES"
  echo "══════════════════════════════════════════════════════════════════"
  exit 1
fi
