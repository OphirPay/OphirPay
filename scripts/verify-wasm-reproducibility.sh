#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# verify-wasm-reproducibility.sh
#
# Verifies that the contract WASM artifacts are reproducible: builds both
# Soroban contracts in the pinned toolchain (contracts/rust-toolchain.toml,
# channel 1.91.0) with the exact flags used by the CI `contract-wasm` job and
# compares the resulting bytes against the committed expected hashes in
# contracts/expected-wasm-hashes.sha256.
#
# If the build is deterministic, the freshly built artifacts must be
# byte-for-byte identical to the expected hash. Any difference means either
# (a) the contract sources changed (update the expected hashes deliberately),
#     or
# (b) the build is non-deterministic (a bug that must be fixed).
#
# On failure the script prints BOTH the expected and the actual hash so the
# mismatch can be diagnosed immediately (issue #405 acceptance criteria).
#
# Usage:
#   ./scripts/verify-wasm-reproducibility.sh            # build + verify
#   ./scripts/verify-wasm-reproducibility.sh --update   # rebuild & rewrite expected hashes
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HASH_FILE="$ROOT/contracts/expected-wasm-hashes.sha256"
TARGET="wasm32v1-none"

# Build deterministically: `file!()`-style macros inside dependency sources
# embed the absolute CARGO_HOME registry path (e.g. /home/runner/.cargo vs
# /home/user/.cargo), which would make the WASM bytes differ between
# machines. Remap CARGO_HOME to a fixed, environment-independent prefix so
# every build produces identical bytes regardless of where cargo lives.
REMAP_PREFIX="/cargo-home"
RUSTFLAGS="-C link-arg=-s --remap-path-prefix=${CARGO_HOME:-"$HOME/.cargo"}=$REMAP_PREFIX"

# A temp dir that mirrors the repo layout used in the hash file, so
# sha256sum -c works against our committed file verbatim.
TMP_ROOT="$(mktemp -d)"
trap 'rm -rf "$TMP_ROOT"' EXIT

build() {
  local contract_dir="$1" # e.g. contracts/ophirpay
  echo "▶ Building $contract_dir (pinned toolchain, $TARGET, release)..."
  (
    cd "$ROOT/$contract_dir"
    # --locked makes CI fail fast if the committed Cargo.lock is out of date
    # (the lockfile pins the dependency graph so builds are reproducible).
    RUSTFLAGS="$RUSTFLAGS" cargo build --locked --target "$TARGET" --release
  )
}

echo "==> Toolchain: $(cd "$ROOT/contracts/ophirpay" && rustc --version)"
echo "==> Target:    $TARGET"

build "contracts/ophirpay"
build "contracts/emitter"

# Stage freshly built artifacts under $TMP_ROOT mirroring the committed paths.
mkdir -p "$TMP_ROOT/contracts/ophirpay/target/wasm32v1-none/release"
mkdir -p "$TMP_ROOT/contracts/emitter/target/wasm32v1-none/release"
cp "$ROOT"/contracts/ophirpay/target/wasm32v1-none/release/*.wasm \
  "$TMP_ROOT/contracts/ophirpay/target/wasm32v1-none/release/"
cp "$ROOT"/contracts/emitter/target/wasm32v1-none/release/*.wasm \
  "$TMP_ROOT/contracts/emitter/target/wasm32v1-none/release/"

if [[ "${1:-}" == "--update" ]]; then
  echo "==> --update: rewriting $HASH_FILE with freshly built hashes."
  (
    cd "$TMP_ROOT"
    sha256sum contracts/ophirpay/target/wasm32v1-none/release/*.wasm \
               contracts/emitter/target/wasm32v1-none/release/*.wasm
  ) > "$HASH_FILE"
  cat "$HASH_FILE"
  echo "==> Expected hashes updated. Commit the new $HASH_FILE with your change."
  exit 0
fi

echo "==> Comparing freshly built artifacts against committed expected hashes..."
if (cd "$TMP_ROOT" && sha256sum -c "$HASH_FILE" 2>&1); then
  echo "✅ WASM artifacts are reproducible — byte-for-byte identical to the committed expected hashes."
  exit 0
else
  echo "❌ WASM reproducibility check FAILED."
  echo ""
  echo "    Expected hashes (committed in $HASH_FILE):"
  sed 's/^/      /' "$HASH_FILE"
  echo ""
  echo "    Actual hashes (freshly built):"
  (cd "$TMP_ROOT" && sha256sum contracts/ophirpay/target/wasm32v1-none/release/*.wasm \
                             contracts/emitter/target/wasm32v1-none/release/*.wasm) | sed 's/^/      /'
  echo ""
  echo "    If the contract sources changed intentionally, update the expected hashes with:"
  echo "      ./scripts/verify-wasm-reproducibility.sh --update"
  echo "    If the sources did NOT change, the build is non-deterministic — investigate!"
  exit 1
fi
