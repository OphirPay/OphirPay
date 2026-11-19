#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# setup-soroban-env.sh
#
# Sets up the pinned Soroban smart contract development environment.
# Reads the exact toolchain channel, components, and targets specified in
# contracts/rust-toolchain.toml (channel 1.91.0, wasm32-unknown-unknown,
# wasm32v1-none) and installs them via rustup. Also checks for stellar-cli /
# soroban-cli and WASM optimization tools (binaryen).
#
# Usage:
#   ./scripts/setup-soroban-env.sh                 # Install Rust toolchain & check CLI
#   ./scripts/setup-soroban-env.sh --install-cli   # Also attempt to install stellar-cli via cargo
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TOOLCHAIN_FILE="$ROOT/contracts/rust-toolchain.toml"

echo "=========================================================="
echo "🔧 Setting up Soroban Contract Development Environment"
echo "=========================================================="

if [ ! -f "$TOOLCHAIN_FILE" ]; then
  echo "❌ Error: Toolchain file not found at $TOOLCHAIN_FILE" >&2
  exit 1
fi

# 1. Parse pinned values from contracts/rust-toolchain.toml
CHANNEL=$(grep -E '^\s*channel\s*=' "$TOOLCHAIN_FILE" | head -n1 | sed -E 's/.*"([^"]+)".*/\1/')
if [ -z "$CHANNEL" ]; then
  CHANNEL="1.91.0"
fi

echo "▶ Target Rust Channel: $CHANNEL (pinned in contracts/rust-toolchain.toml)"

# 2. Check for rustup
if ! command -v rustup >/dev/null 2>&1; then
  echo "❌ Error: 'rustup' is not installed or not in PATH." >&2
  echo "   Please install rustup from https://rustup.rs:" >&2
  echo "     curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh" >&2
  exit 1
fi

# 3. Install pinned toolchain
echo "▶ Installing Rust toolchain $CHANNEL..."
rustup toolchain install "$CHANNEL" --profile minimal

# 4. Install components (rustfmt, clippy)
echo "▶ Adding components (rustfmt, clippy) to $CHANNEL..."
rustup component add --toolchain "$CHANNEL" rustfmt clippy

# 5. Install targets (wasm32-unknown-unknown, wasm32v1-none)
echo "▶ Adding targets (wasm32-unknown-unknown, wasm32v1-none) to $CHANNEL..."
rustup target add --toolchain "$CHANNEL" wasm32-unknown-unknown wasm32v1-none

# 6. Check for Stellar / Soroban CLI
echo ""
echo "▶ Checking Stellar CLI tooling..."
INSTALL_CLI=false
if [[ "${1:-}" == "--install-cli" ]]; then
  INSTALL_CLI=true
fi

if command -v stellar >/dev/null 2>&1; then
  STELLAR_VER=$(stellar --version 2>&1 | head -n1 || true)
  echo "  ✅ stellar-cli found: $STELLAR_VER"
elif command -v soroban >/dev/null 2>&1; then
  SOROBAN_VER=$(soroban --version 2>&1 | head -n1 || true)
  echo "  ✅ soroban-cli found: $SOROBAN_VER"
else
  echo "  ⚠️ stellar-cli / soroban-cli is not installed."
  if [ "$INSTALL_CLI" = true ]; then
    echo "  ▶ Installing stellar-cli via cargo (this may take a few minutes)..."
    cargo install --locked stellar-cli || {
      echo "  ❌ Failed to install stellar-cli via cargo. Please install manually:" >&2
      echo "     cargo install --locked stellar-cli" >&2
    }
  else
    echo "  To install stellar-cli:"
    echo "    cargo install --locked stellar-cli"
    echo "    # or run this script with --install-cli"
    echo "    # or see https://developers.stellar.org/docs/smart-contracts/getting-started/setup"
  fi
fi

# 7. Check for binaryen (wasm-opt, wasm-strip)
echo ""
echo "▶ Checking WASM optimization tools (binaryen)..."
if command -v wasm-opt >/dev/null 2>&1 && command -v wasm-strip >/dev/null 2>&1; then
  WASM_OPT_VER=$(wasm-opt --version 2>&1 | head -n1 || true)
  echo "  ✅ binaryen found: $WASM_OPT_VER"
else
  echo "  ℹ️ binaryen (wasm-opt / wasm-strip) optional tool not found."
  echo "     Linux:   sudo apt-get install binaryen"
  echo "     macOS:   brew install binaryen"
fi

# 8. Verification summary
echo ""
echo "=========================================================="
echo "✅ Soroban Environment Configuration Complete"
echo "=========================================================="
echo "  Rust:    $(rustc +"$CHANNEL" --version)"
echo "  Cargo:   $(cargo +"$CHANNEL" --version)"
echo "  Targets: wasm32-unknown-unknown, wasm32v1-none"
echo ""
echo "To verify WASM contract build reproducibility, run:"
echo "  ./scripts/verify-wasm-reproducibility.sh"
echo "=========================================================="
