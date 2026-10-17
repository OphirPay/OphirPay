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
# mismatch can be diagnosed immediately (issue #405 & #1418 acceptance criteria).
#
# Usage:
#   ./scripts/verify-wasm-reproducibility.sh                    # build + verify
#   ./scripts/verify-wasm-reproducibility.sh --update           # rebuild & rewrite expected hashes
#   ./scripts/verify-wasm-reproducibility.sh --check-config     # validate & print build/hash config JSON
#   ./scripts/verify-wasm-reproducibility.sh --verify-dir <dir> # verify pre-staged artifacts in <dir>
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HASH_FILE="${WASM_HASH_FILE:-$ROOT/contracts/expected-wasm-hashes.sha256}"
TOOLCHAIN_FILE="$ROOT/contracts/rust-toolchain.toml"
TARGET="wasm32v1-none"

# Build deterministically:
# - `-C opt-level=z` enforces size-optimized codegen matching [profile.release]
# - `-C link-arg=-s` strips symbol tables deterministically
# - `--remap-path-prefix` normalizes CARGO_HOME registry paths so `file!()`
#   macros inside dependencies produce identical WASM bytes across machines.
REMAP_PREFIX="/cargo-home"
RUSTFLAGS="-C opt-level=z -C link-arg=-s --remap-path-prefix=${CARGO_HOME:-"$HOME/.cargo"}=$REMAP_PREFIX"

if [[ "${1:-}" == "--check-config" ]]; then
  if [[ ! -f "$HASH_FILE" ]]; then
    echo "❌ Missing expected hash lockfile: $HASH_FILE" >&2
    exit 1
  fi
  if [[ ! -f "$TOOLCHAIN_FILE" ]]; then
    echo "❌ Missing toolchain file: $TOOLCHAIN_FILE" >&2
    exit 1
  fi
  RUST_CHANNEL="$(grep -E '^channel\s*=' "$TOOLCHAIN_FILE" | head -n1 | sed -E 's/.*"([^"]+)".*/\1/')"
  OPHIRPAY_HASH="$(grep 'ophirpay_contract.wasm' "$HASH_FILE" | awk '{print $1}')"
  EMITTER_HASH="$(grep 'ophirpay_emitter.wasm' "$HASH_FILE" | awk '{print $1}')"
  cat <<EOF
{
  "rustChannel": "${RUST_CHANNEL:-1.91.0}",
  "target": "$TARGET",
  "cargoFlags": ["--locked", "--target", "$TARGET", "--release"],
  "rustflags": "$RUSTFLAGS",
  "hashFile": "contracts/expected-wasm-hashes.sha256",
  "expectedHashes": {
    "contracts/ophirpay/target/wasm32v1-none/release/ophirpay_contract.wasm": "$OPHIRPAY_HASH",
    "contracts/emitter/target/wasm32v1-none/release/ophirpay_emitter.wasm": "$EMITTER_HASH"
  }
}
EOF
  exit 0
fi

verify_staged_dir() {
  local staged_dir="$1"
  echo "==> Comparing WASM artifacts against committed expected hashes..."
  if (cd "$staged_dir" && sha256sum -c "$HASH_FILE" 2>&1); then
    echo "✅ WASM artifacts are reproducible — byte-for-byte identical to the committed expected hashes."
    return 0
  else
    echo "❌ WASM reproducibility check FAILED."
    echo ""
    echo "    Expected hashes (committed in $HASH_FILE):"
    sed 's/^/      /' "$HASH_FILE"
    echo ""
    echo "    Actual hashes (built/staged):"
    (cd "$staged_dir" && sha256sum contracts/ophirpay/target/wasm32v1-none/release/*.wasm \
                                   contracts/emitter/target/wasm32v1-none/release/*.wasm 2>/dev/null || true) | sed 's/^/      /'
    echo ""
    echo "    Remediation steps:"
    echo "      1. Ensure your local toolchain matches CI by running:"
    echo "         ./scripts/setup-soroban-env.sh"
    echo "      2. If the contract sources changed intentionally, update the expected hashes with:"
    echo "         ./scripts/verify-wasm-reproducibility.sh --update"
    echo "      3. If the sources did NOT change, the build is non-deterministic — investigate!"
    return 1
  fi
}

if [[ "${1:-}" == "--verify-dir" ]]; then
  VERIFY_DIR="${2:-}"
  if [[ -z "$VERIFY_DIR" || ! -d "$VERIFY_DIR" ]]; then
    echo "❌ Usage: ./scripts/verify-wasm-reproducibility.sh --verify-dir <dir>" >&2
    exit 1
  fi
  verify_staged_dir "$VERIFY_DIR"
  exit $?
fi

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
echo "==> RUSTFLAGS: $RUSTFLAGS"

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

verify_staged_dir "$TMP_ROOT"
