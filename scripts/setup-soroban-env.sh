#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# setup-soroban-env.sh
#
# Automated installation and verification script for the pinned Soroban
# smart contract toolchain, targets, components, and CLI tools.
# Reads settings directly from `contracts/rust-toolchain.toml`.
#
# Usage:
#   ./scripts/setup-soroban-env.sh          # verify & install missing components
#   ./scripts/setup-soroban-env.sh --check  # dry-run verification mode (exit 0 if ready, 1 if missing)
#   ./scripts/setup-soroban-env.sh --help   # display help
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TOOLCHAIN_FILE="$ROOT/contracts/rust-toolchain.toml"

MODE="install"
if [[ "${1:-}" == "--check" ]]; then
  MODE="check"
elif [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  echo "Usage: $0 [--check | --help]"
  echo ""
  echo "Options:"
  echo "  --check   Audit local environment without installing anything (exits with code 1 if incomplete)"
  echo "  --help    Show this help message"
  exit 0
fi

echo "================================================================="
echo "  OphirPay — Soroban Contract Toolchain Environment Setup"
echo "================================================================="
echo "Mode: $MODE"
echo "Config: $TOOLCHAIN_FILE"

# 1. Parse configuration from contracts/rust-toolchain.toml with fallback defaults
PINNED_CHANNEL="1.91.0"
PINNED_COMPONENTS=("rustfmt" "clippy")
PINNED_TARGETS=("wasm32-unknown-unknown" "wasm32v1-none")

if [[ -f "$TOOLCHAIN_FILE" ]]; then
  PARSED_CHANNEL=$(grep -E '^\s*channel\s*=' "$TOOLCHAIN_FILE" | head -n1 | sed -E 's/.*"([^"]+)".*/\1/' || true)
  if [[ -n "$PARSED_CHANNEL" ]]; then
    PINNED_CHANNEL="$PARSED_CHANNEL"
  fi
fi

echo "Target Toolchain Channel: $PINNED_CHANNEL"
echo "Required Targets:        ${PINNED_TARGETS[*]}"
echo "Required Components:     ${PINNED_COMPONENTS[*]}"
echo "-----------------------------------------------------------------"

MISSING_REQUIREMENTS=0

# 2. Check rustup
if ! command -v rustup >/dev/null 2>&1; then
  echo "❌ rustup is NOT installed or not on PATH."
  echo "   Remediation: Install rustup via: curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh"
  MISSING_REQUIREMENTS=$((MISSING_REQUIREMENTS + 1))
else
  echo "✅ rustup is installed: $(rustup --version | head -n1)"
fi

# 3. Check toolchain channel
if command -v rustup >/dev/null 2>&1; then
  INSTALLED_TOOLCHAINS=$(rustup toolchain list || true)
  if echo "$INSTALLED_TOOLCHAINS" | grep -q "$PINNED_CHANNEL"; then
    echo "✅ Rust toolchain '$PINNED_CHANNEL' is installed."
  else
    echo "⚠️  Rust toolchain '$PINNED_CHANNEL' is NOT installed."
    if [[ "$MODE" == "install" ]]; then
      echo "   ▶ Installing rustup toolchain $PINNED_CHANNEL..."
      rustup toolchain install "$PINNED_CHANNEL" --profile minimal --no-self-update
      echo "✅ Successfully installed toolchain $PINNED_CHANNEL."
    else
      echo "   Remediation: Run 'rustup toolchain install $PINNED_CHANNEL'"
      MISSING_REQUIREMENTS=$((MISSING_REQUIREMENTS + 1))
    fi
  fi

  # 4. Check targets
  INSTALLED_TARGETS=$(rustup target list --toolchain "$PINNED_CHANNEL" | grep '(installed)' || true)
  for target in "${PINNED_TARGETS[@]}"; do
    if echo "$INSTALLED_TARGETS" | grep -q "$target"; then
      echo "✅ Target '$target' is installed for $PINNED_CHANNEL."
    else
      echo "⚠️  Target '$target' is NOT installed for $PINNED_CHANNEL."
      if [[ "$MODE" == "install" ]]; then
        echo "   ▶ Adding target '$target' to $PINNED_CHANNEL..."
        rustup target add "$target" --toolchain "$PINNED_CHANNEL"
        echo "✅ Added target '$target'."
      else
        echo "   Remediation: Run 'rustup target add $target --toolchain $PINNED_CHANNEL'"
        MISSING_REQUIREMENTS=$((MISSING_REQUIREMENTS + 1))
      fi
    fi
  done

  # 5. Check components
  INSTALLED_COMPONENTS=$(rustup component list --toolchain "$PINNED_CHANNEL" | grep '(installed)' || true)
  for comp in "${PINNED_COMPONENTS[@]}"; do
    if echo "$INSTALLED_COMPONENTS" | grep -q "^$comp"; then
      echo "✅ Component '$comp' is installed for $PINNED_CHANNEL."
    else
      echo "⚠️  Component '$comp' is NOT installed for $PINNED_CHANNEL."
      if [[ "$MODE" == "install" ]]; then
        echo "   ▶ Adding component '$comp' to $PINNED_CHANNEL..."
        rustup component add "$comp" --toolchain "$PINNED_CHANNEL"
        echo "✅ Added component '$comp'."
      else
        echo "   Remediation: Run 'rustup component add $comp --toolchain $PINNED_CHANNEL'"
        MISSING_REQUIREMENTS=$((MISSING_REQUIREMENTS + 1))
      fi
    fi
  done
fi

# 6. Check Soroban / Stellar CLI
echo "-----------------------------------------------------------------"
echo "Checking Stellar / Soroban CLI tooling..."
CLI_FOUND=0
if command -v stellar >/dev/null 2>&1; then
  echo "✅ Stellar CLI ('stellar') is installed: $(stellar --version 2>/dev/null || echo 'installed')"
  CLI_FOUND=1
elif command -v soroban >/dev/null 2>&1; then
  echo "✅ Soroban CLI ('soroban') is installed: $(soroban --version 2>/dev/null || echo 'installed')"
  CLI_FOUND=1
fi

if [[ "$CLI_FOUND" -eq 0 ]]; then
  echo "⚠️  Neither 'stellar' nor 'soroban' CLI was found in PATH."
  if [[ "$MODE" == "install" ]]; then
    echo "   Note: 'stellar-cli' is the modern CLI for Stellar & Soroban smart contracts."
    echo "   Recommended installation options:"
    echo "     1. Cargo:  cargo install --locked stellar-cli --features opt"
    echo "     2. Brew:   brew install stellar-cli"
    echo "     3. Linux:  curl -fsSL https://github.com/stellar/stellar-cli/releases/latest/download/stellar-cli.tar.gz | tar -xz"
  else
    echo "   Remediation: Install stellar-cli via 'cargo install --locked stellar-cli --features opt'"
    MISSING_REQUIREMENTS=$((MISSING_REQUIREMENTS + 1))
  fi
fi

echo "================================================================="
if [[ "$MISSING_REQUIREMENTS" -gt 0 ]]; then
  echo "❌ Environment check FAILED with $MISSING_REQUIREMENTS missing requirement(s)."
  echo "   Please review the actionable remediations above or run without --check."
  exit 1
else
  echo "✅ Soroban contract development environment is ready!"
  exit 0
fi
