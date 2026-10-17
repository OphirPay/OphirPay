#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# verify-wasm-reproducibility.sh
#
# Verifies that the contract WASM artifacts are reproducible: builds both
# Soroban contracts in the pinned toolchain (contracts/rust-toolchain.toml,
# channel 1.91.0) with deterministic compiler flags (--locked, -C opt-level=z,
# -C link-arg=-s, path remapping) and compares the resulting bytes against
# the committed expected hashes in contracts/expected-wasm-hashes.sha256.
#
# If the build is deterministic, the freshly built artifacts must be
# byte-for-byte identical to the expected hash. Any difference means either
# (a) the contract sources changed (update the expected hashes deliberately),
#     or
# (b) the build is non-deterministic (a bug or toolchain drift to fix).
#
# On failure the script prints BOTH expected and actual hashes per artifact
# along with actionable remediation instructions (issue #1418 criteria).
#
# Usage:
#   ./scripts/verify-wasm-reproducibility.sh            # build + verify
#   ./scripts/verify-wasm-reproducibility.sh --check    # verify existing WASMs without rebuild
#   ./scripts/verify-wasm-reproducibility.sh --update   # rebuild & rewrite expected hashes
#   ./scripts/verify-wasm-reproducibility.sh --help     # show help
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HASH_FILE="$ROOT/contracts/expected-wasm-hashes.sha256"
TARGET="wasm32v1-none"

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  echo "Usage: $0 [--check | --update | --help]"
  echo ""
  echo "Options:"
  echo "  (default)  Compile contracts with deterministic flags and verify against expected hashes"
  echo "  --check    Verify pre-existing compiled WASM artifacts without rebuilding"
  echo "  --update   Rebuild contracts and rewrite contracts/expected-wasm-hashes.sha256"
  echo "  --help     Show this help message"
  exit 0
fi

# Build deterministically:
# 1. `-C opt-level=z` produces minimal size deterministic WASM output
# 2. `-C link-arg=-s` strips debug symbols from wasm binary
# 3. `file!()`-style macros inside dependencies embed CARGO_HOME absolute paths.
#    Remap CARGO_HOME to a fixed prefix so builds are bit-for-bit identical across hosts.
REMAP_PREFIX="/cargo-home"
RUSTFLAGS="-C opt-level=z -C link-arg=-s --remap-path-prefix=${CARGO_HOME:-"$HOME/.cargo"}=$REMAP_PREFIX"

# Verify compiler flag configurations
echo "================================================================="
echo "  Soroban WASM Reproducibility Verification"
echo "================================================================="
echo "Target Architecture: $TARGET"
echo "Deterministic Flags:"
echo "  • --locked (Cargo dependency lock enforcement)"
echo "  • -C opt-level=z (Size-optimized deterministic compilation)"
echo "  • -C link-arg=-s (Symbol stripping)"
echo "  • --remap-path-prefix (Host-independent CARGO_HOME path mapping)"
echo "-----------------------------------------------------------------"

# Temporary staging directory to verify artifacts cleanly
TMP_ROOT="$(mktemp -d)"
trap 'rm -rf "$TMP_ROOT"' EXIT

build_contract() {
  local contract_dir="$1" # e.g. contracts/ophirpay
  echo "▶ Building $contract_dir with pinned toolchain ($TARGET, release)..."
  (
    cd "$ROOT/$contract_dir"
    # Ensure Cargo.lock is honored and compiler flags are passed
    RUSTFLAGS="$RUSTFLAGS" cargo build --locked --target "$TARGET" --release
  )
}

if [[ "${1:-}" != "--check" ]]; then
  if [ -d "$ROOT/contracts/ophirpay" ] && command -v cargo >/dev/null 2>&1; then
    echo "==> Compiler: $(cd "$ROOT/contracts/ophirpay" && rustc --version 2>/dev/null || echo 'cargo active')"
    build_contract "contracts/ophirpay"
    build_contract "contracts/emitter"
  else
    echo "⚠️  Cargo or contract directories unavailable. Proceeding with staged artifact checks."
  fi
fi

# Stage built artifacts under $TMP_ROOT mirroring repository paths
mkdir -p "$TMP_ROOT/contracts/ophirpay/target/wasm32v1-none/release"
mkdir -p "$TMP_ROOT/contracts/emitter/target/wasm32v1-none/release"

if [ -f "$ROOT/contracts/ophirpay/target/wasm32v1-none/release/ophirpay_contract.wasm" ]; then
  cp "$ROOT/contracts/ophirpay/target/wasm32v1-none/release/ophirpay_contract.wasm" \
     "$TMP_ROOT/contracts/ophirpay/target/wasm32v1-none/release/"
fi

if [ -f "$ROOT/contracts/emitter/target/wasm32v1-none/release/ophirpay_emitter.wasm" ]; then
  cp "$ROOT/contracts/emitter/target/wasm32v1-none/release/ophirpay_emitter.wasm" \
     "$TMP_ROOT/contracts/emitter/target/wasm32v1-none/release/"
fi

if [[ "${1:-}" == "--update" ]]; then
  echo "==> --update: Updating expected hashes in $HASH_FILE..."
  (
    cd "$TMP_ROOT"
    sha256sum contracts/ophirpay/target/wasm32v1-none/release/*.wasm \
               contracts/emitter/target/wasm32v1-none/release/*.wasm
  ) > "$HASH_FILE"
  cat "$HASH_FILE"
  echo "==> Expected hashes updated. Commit the new $HASH_FILE with your PR."
  exit 0
fi

echo "==> Comparing built WASM artifacts against committed expected hashes..."
echo "Hash manifest: $HASH_FILE"
echo "-----------------------------------------------------------------"

MISMATCH_COUNT=0
TOTAL_CHECKED=0

while read -r expected_hash rel_path; do
  [[ -z "$expected_hash" || "$expected_hash" =~ ^# ]] && continue
  TOTAL_CHECKED=$((TOTAL_CHECKED + 1))
  
  target_file="$TMP_ROOT/$rel_path"
  if [ ! -f "$target_file" ]; then
    # Fallback to direct repository location if not copied to tmp
    if [ -f "$ROOT/$rel_path" ]; then
      target_file="$ROOT/$rel_path"
    fi
  fi

  echo "Artifact: $rel_path"
  if [ ! -f "$target_file" ]; then
    echo "  Status:   MISSING ❌ (Artifact not found on disk)"
    echo "  Expected: $expected_hash"
    MISMATCH_COUNT=$((MISMATCH_COUNT + 1))
    continue
  fi

  actual_hash=$(sha256sum "$target_file" | awk '{print $1}')
  echo "  Expected: $expected_hash"
  echo "  Actual:   $actual_hash"

  if [[ "$expected_hash" == "$actual_hash" ]]; then
    echo "  Result:   MATCH ✅ (Bit-for-bit reproducible)"
  else
    echo "  Result:   MISMATCH ❌ (Bytes differ from baseline)"
    MISMATCH_COUNT=$((MISMATCH_COUNT + 1))
  fi
  echo ""
done < "$HASH_FILE"

echo "================================================================="
if [[ "$MISMATCH_COUNT" -eq 0 && "$TOTAL_CHECKED" -gt 0 ]]; then
  echo "🎉 SUCCESS: All $TOTAL_CHECKED contract WASM artifacts are byte-for-byte reproducible!"
  exit 0
else
  echo "❌ WASM reproducibility verification FAILED ($MISMATCH_COUNT failure(s) out of $TOTAL_CHECKED checked)."
  echo ""
  echo "Actionable Remediation Instructions:"
  echo "  1. Toolchain mismatch:"
  echo "     Run './scripts/setup-soroban-env.sh --check' to verify exact toolchain version"
  echo "     and required targets (Rust 1.91.0, wasm32v1-none, wasm32-unknown-unknown)."
  echo ""
  echo "  2. Compiler flags mismatch:"
  echo "     Ensure compilation uses '--locked' and '-C opt-level=z' with path remapping."
  echo ""
  echo "  3. Intentional contract source change:"
  echo "     If you modified contract code under 'contracts/', recalculate and commit the"
  echo "     new baseline hashes by running:"
  echo "       ./scripts/verify-wasm-reproducibility.sh --update"
  echo ""
  echo "  4. Non-deterministic build or cache pollution:"
  echo "     Clear local cargo build cache via 'cargo clean --target-dir contracts/ophirpay/target'"
  echo "     and rebuild from a pristine workspace."
  echo "================================================================="
  exit 1
fi
