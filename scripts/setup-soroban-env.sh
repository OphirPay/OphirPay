#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# setup-soroban-env.sh
#
# Automated installation and verification script for the OphirPay Soroban
# smart-contract toolchain (Issue #1418).
#
# Reads the pinned Rust toolchain specification from contracts/rust-toolchain.toml
# (Rust 1.91.0, targets wasm32-unknown-unknown + wasm32v1-none, components
# rustfmt + clippy) and ensures the pinned Soroban / Stellar CLI is installed
# so local builds produce byte-for-byte identical WASM artifacts to CI.
#
# Usage:
#   ./scripts/setup-soroban-env.sh                 # install + verify toolchain & CLI
#   ./scripts/setup-soroban-env.sh --verify        # verify installed versions without installing
#   ./scripts/setup-soroban-env.sh --dry-run       # print commands without executing
#   ./scripts/setup-soroban-env.sh --print-config  # output resolved toolchain JSON
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TOOLCHAIN_FILE="$ROOT/contracts/rust-toolchain.toml"

if [[ ! -f "$TOOLCHAIN_FILE" ]]; then
  echo "❌ Missing toolchain file: $TOOLCHAIN_FILE" >&2
  exit 1
fi

# Extract pinned channel from contracts/rust-toolchain.toml
RUST_CHANNEL="$(grep -E '^channel\s*=' "$TOOLCHAIN_FILE" | head -n1 | sed -E 's/.*"([^"]+)".*/\1/')"
RUST_CHANNEL="${RUST_CHANNEL:-1.91.0}"

# Pinned targets required for Soroban protocol 25+ and legacy compatibility
REQUIRED_TARGETS=("wasm32-unknown-unknown" "wasm32v1-none")
REQUIRED_COMPONENTS=("rustfmt" "clippy")

# Pinned Stellar / Soroban CLI version for deterministic contract builds
STELLAR_CLI_VERSION="${STELLAR_CLI_VERSION:-22.5.0}"
SOROBAN_CLI_CRATE="${SOROBAN_CLI_CRATE:-stellar-cli}"

MODE="install"
for arg in "$@"; do
  case "$arg" in
    --verify)
      MODE="verify"
      ;;
    --dry-run)
      MODE="dry-run"
      ;;
    --print-config)
      MODE="print-config"
      ;;
    -h|--help)
      echo "Usage: ./scripts/setup-soroban-env.sh [--verify | --dry-run | --print-config]"
      exit 0
      ;;
    *)
      echo "Unknown option: $arg" >&2
      exit 1
      ;;
  esac
done

if [[ "$MODE" == "print-config" ]]; then
  cat <<EOF
{
  "rustChannel": "$RUST_CHANNEL",
  "toolchainFile": "contracts/rust-toolchain.toml",
  "targets": ["wasm32-unknown-unknown", "wasm32v1-none"],
  "components": ["rustfmt", "clippy"],
  "stellarCliCrate": "$SOROBAN_CLI_CRATE",
  "stellarCliVersion": "$STELLAR_CLI_VERSION",
  "requiredRustflags": "-C opt-level=z -C link-arg=-s --remap-path-prefix=\${CARGO_HOME:-~/.cargo}=/cargo-home"
}
EOF
  exit 0
fi

run_cmd() {
  if [[ "$MODE" == "dry-run" ]]; then
    echo "[dry-run] $*"
  else
    echo "▶ $*"
    "$@"
  fi
}

echo "==> OphirPay Soroban Toolchain Setup (Rust $RUST_CHANNEL, $SOROBAN_CLI_CRATE $STELLAR_CLI_VERSION)"

if [[ "$MODE" == "verify" ]]; then
  if ! command -v rustup >/dev/null 2>&1; then
    echo "❌ rustup is not installed. Run ./scripts/setup-soroban-env.sh to install." >&2
    exit 1
  fi
  INSTALLED_TOOLCHAINS="$(rustup toolchain list)"
  if ! echo "$INSTALLED_TOOLCHAINS" | grep -q "^${RUST_CHANNEL}"; then
    echo "❌ Rust toolchain $RUST_CHANNEL is not installed." >&2
    exit 1
  fi
  INSTALLED_TARGETS="$(rustup target list --installed --toolchain "$RUST_CHANNEL")"
  for target in "${REQUIRED_TARGETS[@]}"; do
    if ! echo "$INSTALLED_TARGETS" | grep -qx "$target"; then
      echo "❌ Missing Rust target '$target' on toolchain $RUST_CHANNEL." >&2
      exit 1
    fi
  done
  if ! command -v stellar >/dev/null 2>&1 && ! command -v soroban >/dev/null 2>&1; then
    echo "❌ Neither 'stellar' nor 'soroban' CLI is installed in PATH." >&2
    exit 1
  fi
  echo "✅ Soroban environment verified (Rust $RUST_CHANNEL + WASM targets + CLI)."
  exit 0
fi

# 1. Ensure rustup is available
if ! command -v rustup >/dev/null 2>&1; then
  if [[ "$MODE" == "dry-run" ]]; then
    echo "[dry-run] curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --default-toolchain $RUST_CHANNEL"
  else
    echo "==> Installing rustup and Rust $RUST_CHANNEL..."
    curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --default-toolchain "$RUST_CHANNEL"
    # shellcheck disable=SC1091
    [[ -f "$HOME/.cargo/env" ]] && source "$HOME/.cargo/env"
  fi
fi

# 2. Install pinned toolchain, components, and WASM targets
run_cmd rustup toolchain install "$RUST_CHANNEL" --profile minimal --component "${REQUIRED_COMPONENTS[@]}"
for target in "${REQUIRED_TARGETS[@]}"; do
  run_cmd rustup target add "$target" --toolchain "$RUST_CHANNEL"
done

# 3. Install pinned Stellar / Soroban CLI
if command -v cargo-binstall >/dev/null 2>&1; then
  run_cmd cargo binstall -y --locked "${SOROBAN_CLI_CRATE}@${STELLAR_CLI_VERSION}"
else
  run_cmd cargo "+${RUST_CHANNEL}" install --locked "$SOROBAN_CLI_CRATE" --version "$STELLAR_CLI_VERSION"
fi

echo "✅ Soroban environment ready (Rust $RUST_CHANNEL, targets: ${REQUIRED_TARGETS[*]}, $SOROBAN_CLI_CRATE@$STELLAR_CLI_VERSION)."
