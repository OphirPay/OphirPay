#!/usr/bin/env bash
# OphirPay — Local Dev Contract Deployment
# Deploys both contracts to Stellar Testnet and outputs contract IDs for .env.local
set -euo pipefail

echo "🔨 Building contracts..."
cd "$(dirname "$0")/.."

(cd contracts/ophirpay && cargo build --target wasm32v1-none --release)
(cd contracts/emitter && cargo build --target wasm32v1-none --release)

echo ""
echo "📦 Deploying OphirPay contract to Testnet..."
OPHIRPAY_WASM="contracts/ophirpay/target/wasm32v1-none/release/ophirpay_contract.wasm"
OPHIRPAY_ID=$(stellar contract deploy \
  --wasm "$OPHIRPAY_WASM" \
  --source "${1:?Usage: $0 <SECRET_KEY>}" \
  --network testnet \
  --fee 10000000 \
  2>/dev/null | grep -o 'C[A-Z0-9]\{55\}')

echo "   OphirPay  → $OPHIRPAY_ID"

echo ""
echo "📦 Deploying Emitter contract to Testnet..."
EMITTER_WASM="contracts/emitter/target/wasm32v1-none/release/ophirpay_emitter.wasm"
EMITTER_ID=$(stellar contract deploy \
  --wasm "$EMITTER_WASM" \
  --source "${1}" \
  --network testnet \
  --fee 10000000 \
  2>/dev/null | grep -o 'C[A-Z0-9]\{55\}')

echo "   Emitter   → $EMITTER_ID"

echo ""
echo "✅ Deployment complete. Add to .env.local:"
echo "   NEXT_PUBLIC_CONTRACT_ID=$OPHIRPAY_ID"
echo "   NEXT_PUBLIC_EMITTER_CONTRACT_ID=$EMITTER_ID"
echo ""
echo "📋 Initialize contracts:"
echo "   stellar contract invoke --id $OPHIRPAY_ID --source $1 --network testnet -- init --owner <YOUR_PUBLIC_KEY>"
echo "   stellar contract invoke --id $OPHIRPAY_ID --source $1 --network testnet -- set_emitter --caller <YOUR_PUBLIC_KEY> --emitter $EMITTER_ID"
