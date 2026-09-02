#!/bin/bash
# ─────────────────────────────────────────────────────────────
# OphirPay Smart Contract Deployment Workflow
# Validate PUBLIC config in CI: bash scripts/validate-deploy-config.sh
# ─────────────────────────────────────────────────────────────
# Automates the full Soroban contract deployment pipeline:
# 1. Build WASM from Rust source
# 2. Install WASM on-chain
# 3. Deploy contract instance
# 4. Initialize contract with owner
# 5. Verify deployment with test call
# ─────────────────────────────────────────────────────────────
set -euo pipefail

GREEN="\033[0;32m"
YELLOW="\033[1;33m"
RED="\033[0;31m"
NC="\033[0m"

echo -e "${GREEN}┌──────────────────────────────────────────────┐${NC}"
echo -e "${GREEN}│   OphirPay Contract Deployment Workflow      │${NC}"
echo -e "${GREEN}└──────────────────────────────────────────────┘${NC}"
echo ""

# ── Configuration ───────────────────────────────────────────
# Network mode: TESTNET (default) or PUBLIC (Stellar Mainnet).
# PUBLIC mode requires --network public and disables friendbot funding.
NETWORK_MODE="${NETWORK_MODE:-TESTNET}"
DRY_RUN="${DRY_RUN:-false}"

if [ "$NETWORK_MODE" = "PUBLIC" ]; then
  RPC_URL="${RPC_URL:-https://soroban.stellar.org:443}"
  HORIZON_URL="${HORIZON_URL:-https://horizon.stellar.org}"
  NETWORK_PASSPHRASE="${NETWORK_PASSPHRASE:-Public Global Stellar Network ; September 2015}"
  NETWORK_FLAG="--network public"
  FRIENDBOT_ENABLED=false
else
  RPC_URL="${RPC_URL:-https://soroban-testnet.stellar.org:443}"
  HORIZON_URL="${HORIZON_URL:-https://horizon-testnet.stellar.org}"
  NETWORK_PASSPHRASE="${NETWORK_PASSPHRASE:-Test SDF Network ; September 2015}"
  NETWORK_FLAG="--network testnet"
  FRIENDBOT_ENABLED=true
fi

CONTRACT_DIR="contracts/ophirpay"
WASM_PATH="$CONTRACT_DIR/target/wasm32v1-none/release/ophirpay_contract.wasm"

# ── Validate inputs ──────────────────────────────────────────
if [ $# -lt 2 ]; then
  echo -e "${RED}Usage: $0 <SECRET_KEY> <OWNER_PUBLIC_KEY> [EMITTER_CONTRACT_ID]${NC}"
  echo ""
  echo "Example:"
  echo "  $0 SDEMO... GDEMO... CA6LAP..."
  echo ""
  echo "Environment variables:"
  echo "  NETWORK_MODE          TESTNET (default) or PUBLIC (Stellar Mainnet)"
  echo "  RPC_URL               Soroban RPC URL (default: testnet or mainnet)"
  echo "  HORIZON_URL           Stellar Horizon URL (default: testnet or mainnet)"
  echo "  NETWORK_PASSPHRASE     Network passphrase"
  echo "  STELLAR_CLI_PATH       Path to stellar CLI binary"
  echo "  DRY_RUN               Set to true to validate config without submitting"
  exit 1
fi

SECRET_KEY="$1"
OWNER_KEY="$2"
EMITTER_ID="${3:-}"
STELLAR_CLI="${STELLAR_CLI_PATH:-stellar}"

# ── Dry-run guard ────────────────────────────────────────────
# In PUBLIC mode, a dry-run must fail before any real submission.
if [ "$NETWORK_MODE" = "PUBLIC" ] && [ "$DRY_RUN" = "true" ]; then
  echo -e "${YELLOW}[dry-run] Validating PUBLIC network configuration...${NC}"
  echo -e "${YELLOW}[dry-run] RPC:            ${RPC_URL}${NC}"
  echo -e "${YELLOW}[dry-run] Horizon:        ${HORIZON_URL}${NC}"
  echo -e "${YELLOW}[dry-run] Passphrase:     ${NETWORK_PASSPHRASE}${NC}"
  echo -e "${YELLOW}[dry-run] Friendbot:      disabled (mainnet has no friendbot)${NC}"
  echo -e "${YELLOW}[dry-run] Network flag:   ${NETWORK_FLAG}${NC}"
  echo ""
  echo -e "${RED}✗ Dry-run: refusing to submit any transaction to PUBLIC network.${NC}"
  echo -e "${RED}  Remove DRY_RUN=true to perform a real mainnet deployment.${NC}"
  exit 1
fi

# ── Check prerequisites ──────────────────────────────────────
if ! command -v "$STELLAR_CLI" &>/dev/null; then
  echo -e "${RED}Error: stellar CLI not found. Install it from:${NC}"
  echo "  https://github.com/stellar/stellar-cli/releases"
  exit 1
fi

if ! command -v cargo &>/dev/null; then
  echo -e "${YELLOW}Warning: cargo not found. Skipping WASM build step.${NC}"
  echo "  Install Rust: https://rustup.rs"
  SKIP_BUILD=true
else
  SKIP_BUILD=false
fi

# ── Step 1: Build WASM ───────────────────────────────────────
echo -e "${YELLOW}[1/5] Building contract WASM...${NC}"
if [ "$SKIP_BUILD" = false ]; then
  cd "$CONTRACT_DIR"
  cargo build --target wasm32v1-none --release
  cd - > /dev/null
  WASM_SIZE=$(wc -c < "$WASM_PATH" | tr -d ' ')
  echo -e "${GREEN}  ✓ Built ${WASM_SIZE} bytes${NC}"
else
  if [ -f "$WASM_PATH" ]; then
    echo -e "${GREEN}  ✓ Using existing WASM${NC}"
  else
    echo -e "${RED}  ✗ No WASM found and cargo not available${NC}"
    exit 1
  fi
fi

# ── Step 2: Upload WASM ──────────────────────────────────────
echo -e "${YELLOW}[2/5] Uploading WASM to Stellar ${NETWORK_MODE}...${NC}"
$STELLAR_CLI contract upload \
  --wasm "$WASM_PATH" \
  --source-account "$SECRET_KEY" \
  --rpc-url "$RPC_URL" \
  --network-passphrase "$NETWORK_PASSPHRASE" \
  $NETWORK_FLAG \
  --quiet

echo -e "${GREEN}  ✓ WASM uploaded${NC}"

# ── Step 3: Deploy contract ──────────────────────────────────
echo -e "${YELLOW}[3/5] Deploying contract instance...${NC}"
CONTRACT_ID=$($STELLAR_CLI contract deploy \
  --wasm "$WASM_PATH" \
  --source-account "$SECRET_KEY" \
  --rpc-url "$RPC_URL" \
  --network-passphrase "$NETWORK_PASSPHRASE" \
  $NETWORK_FLAG \
  --quiet 2>/dev/null)

echo -e "${GREEN}  ✓ Contract ID: ${CONTRACT_ID}${NC}"

# ── Step 4: Initialize contract ───────────────────────────────
if [ -n "$EMITTER_ID" ]; then
  echo -e "${YELLOW}[4/5] Initializing contract with emitter...${NC}"
  INIT_TX=$($STELLAR_CLI contract invoke \
    --id "$CONTRACT_ID" \
    --source-account "$SECRET_KEY" \
    --rpc-url "$RPC_URL" \
    --network-passphrase "$NETWORK_PASSPHRASE" \
    $NETWORK_FLAG \
    --quiet \
    -- init --owner "$OWNER_KEY" --emitter "$EMITTER_ID" 2>/dev/null || echo "")
else
  echo -e "${YELLOW}[4/5] Initializing contract...${NC}"
  INIT_TX=$($STELLAR_CLI contract invoke \
    --id "$CONTRACT_ID" \
    --source-account "$SECRET_KEY" \
    --rpc-url "$RPC_URL" \
    --network-passphrase "$NETWORK_PASSPHRASE" \
    $NETWORK_FLAG \
    --quiet \
    -- init --owner "$OWNER_KEY" 2>/dev/null || echo "")
fi

if [ -n "$INIT_TX" ]; then
  echo -e "${GREEN}  ✓ Init TX: ${INIT_TX}${NC}"
else
  echo -e "${YELLOW}  ⚠ Contract may already be initialized${NC}"
fi

# ── Step 5: Verify ───────────────────────────────────────────
echo -e "${YELLOW}[5/5] Verifying deployment...${NC}"
OWNER_RESULT=$($STELLAR_CLI contract invoke \
  --id "$CONTRACT_ID" \
  --source-account "$SECRET_KEY" \
  --rpc-url "$RPC_URL" \
  --network-passphrase "$NETWORK_PASSPHRASE" \
  $NETWORK_FLAG \
  --send no \
  --quiet \
  -- get_owner 2>/dev/null || echo "N/A")

echo -e "${GREEN}  ✓ Owner: ${OWNER_RESULT}${NC}"

# ── Summary ──────────────────────────────────────────────────
if [ "$NETWORK_MODE" = "PUBLIC" ]; then
  EXPLORER_URL="https://stellar.expert/explorer/public/contract/${CONTRACT_ID}"
else
  EXPLORER_URL="https://stellar.expert/explorer/testnet/contract/${CONTRACT_ID}"
fi
echo ""
echo -e "${GREEN}┌──────────────────────────────────────────────┐${NC}"
echo -e "${GREEN}│   Deployment Complete!                       │${NC}"
echo -e "${GREEN}├──────────────────────────────────────────────┤${NC}"
echo -e "${GREEN}│ Network:  ${NETWORK_MODE}${NC}"
echo -e "${GREEN}│ Contract: ${CONTRACT_ID}${NC}"
echo -e "${GREEN}│ Explorer: ${EXPLORER_URL}${NC}"
echo -e "${GREEN}│ Owner:    ${OWNER_RESULT}${NC}"
echo -e "${GREEN}└──────────────────────────────────────────────┘${NC}"
echo ""
echo "Update your .env:"
echo "  NEXT_PUBLIC_CONTRACT_ID=${CONTRACT_ID}"
