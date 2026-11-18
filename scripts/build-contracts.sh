#!/usr/bin/env bash
# SPDX-License-Identifier: MIT
# scripts/build-contracts.sh — Build and optimize OphirPay Soroban smart contracts.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONTRACTS_DIR="${REPO_ROOT}/contracts"
TARGET_DIR="${REPO_ROOT}/target"
MAX_WASM_SIZE=131072 # 128 KB hard mainnet limit

echo "══════════════════════════════════════════════════════════════════════════"
echo "  🛠️  OphirPay — Soroban Contract Build & Optimization Pipeline"
echo "══════════════════════════════════════════════════════════════════════════"

# 1. Check Cargo installation
if ! command -v cargo >/dev/null 2>&1; then
  echo "❌ Error: cargo is not installed or not in PATH."
  exit 1
fi

# 2. Determine WebAssembly compilation target
TARGET="wasm32v1-none"
if ! rustup target list --installed | grep -q "^wasm32v1-none$"; then
  if rustup target list --installed | grep -q "^wasm32-unknown-unknown$"; then
    TARGET="wasm32-unknown-unknown"
    echo "ℹ️ Using fallback target: ${TARGET}"
  else
    echo "⚠️ Target wasm32v1-none not installed. Attempting installation..."
    rustup target add wasm32v1-none || {
      TARGET="wasm32-unknown-unknown"
      rustup target add wasm32-unknown-unknown
    }
  fi
fi

echo "🎯 Target Architecture: ${TARGET}"
echo "📦 Build Directory:    ${CONTRACTS_DIR}"

CONTRACTS=("ophirpay" "emitter")
OUTPUT_DIR="${TARGET_DIR}/${TARGET}/release"
mkdir -p "${OUTPUT_DIR}"

# 3. Compile Contracts
for contract in "${CONTRACTS[@]}"; do
  echo ""
  echo "🔨 Compiling ${contract} contract..."
  cargo build \
    --manifest-path "${CONTRACTS_DIR}/${contract}/Cargo.toml" \
    --target "${TARGET}" \
    --release
done

# 4. Optimization Stage
echo ""
echo "⚙️  Optimizing WASM Binaries..."

HAS_WASM_STRIP=false
HAS_WASM_OPT=false
HAS_STELLAR_CLI=false

if command -v wasm-strip >/dev/null 2>&1; then HAS_WASM_STRIP=true; fi
if command -v wasm-opt >/dev/null 2>&1; then HAS_WASM_OPT=true; fi
if command -v stellar >/dev/null 2>&1; then HAS_STELLAR_CLI=true; fi

declare -A RAW_SIZES
declare -A OPT_SIZES

for contract in "${CONTRACTS[@]}"; do
  # Determine raw binary path
  RAW_WASM="${OUTPUT_DIR}/${contract}.wasm"
  if [[ ! -f "${RAW_WASM}" ]]; then
    # Some cargo configurations prefix with crate name
    RAW_WASM="${OUTPUT_DIR}/ophirpay_${contract}.wasm"
  fi

  if [[ ! -f "${RAW_WASM}" ]]; then
    # Search for matching wasm file
    FOUND=$(find "${OUTPUT_DIR}" -maxdepth 1 -name "*${contract}*.wasm" | head -n 1)
    if [[ -n "${FOUND}" ]]; then
      RAW_WASM="${FOUND}"
    else
      echo "⚠️ Warning: WASM binary for ${contract} not found at ${OUTPUT_DIR}"
      continue
    fi
  fi

  RAW_SIZE=$(wc -c < "${RAW_WASM}")
  RAW_SIZES["${contract}"]="${RAW_SIZE}"

  OPT_WASM="${OUTPUT_DIR}/${contract}_optimized.wasm"

  if [ "${HAS_STELLAR_CLI}" = true ]; then
    stellar contract optimize --wasm "${RAW_WASM}" --output-file "${OPT_WASM}" >/dev/null 2>&1 || cp "${RAW_WASM}" "${OPT_WASM}"
  elif [ "${HAS_WASM_OPT}" = true ]; then
    cp "${RAW_WASM}" "${OPT_WASM}"
    if [ "${HAS_WASM_STRIP}" = true ]; then
      wasm-strip "${OPT_WASM}" >/dev/null 2>&1 || true
    fi
    wasm-opt -Oz --strip-debug --strip-producers "${OPT_WASM}" -o "${OPT_WASM}" >/dev/null 2>&1 || true
  else
    cp "${RAW_WASM}" "${OPT_WASM}"
  fi

  OPT_SIZE=$(wc -c < "${OPT_WASM}")
  OPT_SIZES["${contract}"]="${OPT_SIZE}"
done

# 5. Output Verification Report
echo ""
echo "══════════════════════════════════════════════════════════════════════════"
echo "  📊 WASM Size & Budget Report (Max: 128 KB = ${MAX_WASM_SIZE} bytes)"
echo "══════════════════════════════════════════════════════════════════════════"
printf "%-12s | %-12s | %-14s | %-14s | %-8s\n" "Contract" "Raw Size" "Optimized Size" "Headroom" "Status"
echo "-------------+--------------+----------------+----------------+---------"

OVERALL_PASS=true

for contract in "${CONTRACTS[@]}"; do
  RAW=${RAW_SIZES["${contract}"]:-0}
  OPT=${OPT_SIZES["${contract}"]:-$RAW}
  HEADROOM=$((MAX_WASM_SIZE - OPT))

  if [ "${OPT}" -le "${MAX_WASM_SIZE}" ]; then
    STATUS="✅ PASS"
  else
    STATUS="❌ FAIL"
    OVERALL_PASS=false
  fi

  printf "%-12s | %8d B   | %9d B     | %8d B       | %s\n" \
    "${contract}" "${RAW}" "${OPT}" "${HEADROOM}" "${STATUS}"
done

echo "══════════════════════════════════════════════════════════════════════════"

if [ "${OVERALL_PASS}" = true ]; then
  echo "🎉 All Soroban contracts compiled and optimized within 128 KB budget!"
  exit 0
else
  echo "💥 Error: One or more contracts exceed the 128 KB Soroban budget limit!"
  exit 1
fi
