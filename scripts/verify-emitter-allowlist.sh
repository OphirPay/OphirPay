#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
# OphirPay Emitter Allow-List & Ownership Verification Script
# Resolves Issue #782 / AUDIT.md MEDIUM-3
# ─────────────────────────────────────────────────────────────
# Verifies on-chain that:
# 1. PaymentEventEmitter's ALLOWED_SOURCE matches OphirPayContract ID.
# 2. PaymentEventEmitter owner matches OphirPayContract owner.
# 3. Fails loudly with remediation commands if allow-list is unset or misaligned.
# ─────────────────────────────────────────────────────────────
set -euo pipefail

GREEN="\033[0;32m"
YELLOW="\033[1;33m"
RED="\033[0;31m"
NC="\033[0m"

echo -e "${GREEN}┌──────────────────────────────────────────────────────────────┐${NC}"
echo -e "${GREEN}│   OphirPay Emitter Allow-List & Ownership Verification      │${NC}"
echo -e "${GREEN}└──────────────────────────────────────────────────────────────┘${NC}"
echo ""

# ── Load Configuration ──────────────────────────────────────────
NETWORK_MODE="${NETWORK_MODE:-TESTNET}"
SIMULATION_MODE="${SIMULATION_MODE:-false}"

if [ "$NETWORK_MODE" = "PUBLIC" ]; then
  RPC_URL="${RPC_URL:-https://soroban.stellar.org:443}"
  NETWORK_PASSPHRASE="${NETWORK_PASSPHRASE:-Public Global Stellar Network ; September 2015}"
  NETWORK_FLAG="--network public"
else
  RPC_URL="${RPC_URL:-https://soroban-testnet.stellar.org:443}"
  NETWORK_PASSPHRASE="${NETWORK_PASSPHRASE:-Test SDF Network ; September 2015}"
  NETWORK_FLAG="--network testnet"
fi

CONTRACT_ID="${1:-${NEXT_PUBLIC_CONTRACT_ID:-${CONTRACT_ID:-}}}"
EMITTER_ID="${2:-${NEXT_PUBLIC_EMITTER_CONTRACT_ID:-${EMITTER_ID:-}}}"
EXPECTED_OWNER="${3:-${OWNER_PUBLIC_KEY:-${OWNER_KEY:-}}}"
STELLAR_CLI="${STELLAR_CLI_PATH:-stellar}"

if [ -z "$CONTRACT_ID" ] || [ -z "$EMITTER_ID" ]; then
  echo -e "${RED}Error: Missing required contract addresses.${NC}"
  echo ""
  echo "Usage: $0 <ORCHESTRATOR_CONTRACT_ID> <EMITTER_CONTRACT_ID> [EXPECTED_OWNER_KEY]"
  echo ""
  echo "Or provide via environment variables:"
  echo "  NEXT_PUBLIC_CONTRACT_ID           Main OphirPay orchestrator contract ID"
  echo "  NEXT_PUBLIC_EMITTER_CONTRACT_ID   PaymentEventEmitter contract ID"
  echo "  OWNER_PUBLIC_KEY                  Expected admin/owner public key"
  echo "  NETWORK_MODE                      TESTNET (default) or PUBLIC"
  exit 1
fi

echo -e "Network:      ${YELLOW}${NETWORK_MODE}${NC}"
echo -e "Orchestrator: ${YELLOW}${CONTRACT_ID}${NC}"
echo -e "Emitter:      ${YELLOW}${EMITTER_ID}${NC}"
[ -n "$EXPECTED_OWNER" ] && echo -e "Owner Key:    ${YELLOW}${EXPECTED_OWNER}${NC}"
echo ""

# ── Fetch / Query On-Chain State ───────────────────────────────

if [ "$SIMULATION_MODE" = "true" ]; then
  echo -e "${YELLOW}[simulation] Using injected mock parameters for verification...${NC}"
  ALLOWED_SOURCE="${MOCK_ALLOWED_SOURCE:-}"
  EMITTER_OWNER="${MOCK_EMITTER_OWNER:-$EXPECTED_OWNER}"
  ORCHESTRATOR_OWNER="${MOCK_ORCHESTRATOR_OWNER:-$EXPECTED_OWNER}"
else
  if ! command -v "$STELLAR_CLI" &>/dev/null; then
    echo -e "${RED}Error: stellar CLI not found at '$STELLAR_CLI'.${NC}"
    echo "Install it or set STELLAR_CLI_PATH."
    exit 1
  fi

  echo "Querying PaymentEventEmitter for ALLOWED_SOURCE..."
  RAW_ALLOWED=$($STELLAR_CLI contract invoke \
    --id "$EMITTER_ID" \
    --rpc-url "$RPC_URL" \
    --network-passphrase "$NETWORK_PASSPHRASE" \
    $NETWORK_FLAG \
    --send no \
    -- get_allowed_source 2>&1 || echo "ERROR")

  # Normalize quotes and formatting from stellar CLI output
  ALLOWED_SOURCE=$(echo "$RAW_ALLOWED" | tr -d '"' | tr -d ' ' | grep -E '^C[A-Z0-9]{55}$' || echo "$RAW_ALLOWED")

  echo "Querying PaymentEventEmitter for owner..."
  RAW_EMITTER_OWNER=$($STELLAR_CLI contract invoke \
    --id "$EMITTER_ID" \
    --rpc-url "$RPC_URL" \
    --network-passphrase "$NETWORK_PASSPHRASE" \
    $NETWORK_FLAG \
    --send no \
    -- get_owner 2>&1 || echo "ERROR")
  EMITTER_OWNER=$(echo "$RAW_EMITTER_OWNER" | tr -d '"' | tr -d ' ' | grep -E '^[GC][A-Z0-9]{55}$' || echo "$RAW_EMITTER_OWNER")

  echo "Querying OphirPayContract for owner..."
  RAW_ORCH_OWNER=$($STELLAR_CLI contract invoke \
    --id "$CONTRACT_ID" \
    --rpc-url "$RPC_URL" \
    --network-passphrase "$NETWORK_PASSPHRASE" \
    $NETWORK_FLAG \
    --send no \
    -- get_owner 2>&1 || echo "ERROR")
  ORCHESTRATOR_OWNER=$(echo "$RAW_ORCH_OWNER" | tr -d '"' | tr -d ' ' | grep -E '^[GC][A-Z0-9]{55}$' || echo "$RAW_ORCH_OWNER")
fi

echo ""
echo "── Verification Results ───────────────────────────────────────────"

HAS_FAILURE=false

# ── Check 1: Emitter ALLOWED_SOURCE matches Orchestrator ──────
if [ "$ALLOWED_SOURCE" = "$CONTRACT_ID" ]; then
  echo -e "${GREEN}✓ [PASS] Emitter ALLOWED_SOURCE matches Orchestrator:${NC} ${ALLOWED_SOURCE}"
else
  HAS_FAILURE=true
  echo -e "${RED}✗ [FAIL] Emitter ALLOWED_SOURCE is UNSET or MISMATCHED!${NC}"
  echo -e "  Expected: ${GREEN}${CONTRACT_ID}${NC}"
  echo -e "  Actual:   ${RED}${ALLOWED_SOURCE:-<NONE>}${NC}"
  echo ""
  echo -e "${RED}  CRITICAL SECURITY / OPERATIONAL CONSEQUENCE:${NC}"
  echo -e "  - If ALLOWED_SOURCE is unset or points elsewhere, any cross-contract call"
  echo -e "    from OphirPayContract to emit_payment will fail with EmitterError::Unauthorized (code 4)."
  echo -e "  - All on-chain payment event emissions will revert, breaking the SSE stream"
  echo -e "    (/api/events), webhook dispatchers, and audit log pipelines."
  echo ""
  echo -e "${YELLOW}  Remediation Command:${NC}"
  echo -e "  stellar contract invoke \\"
  echo -e "    --id ${EMITTER_ID} \\"
  echo -e "    --source <OWNER_SECRET_KEY> \\"
  echo -e "    --rpc-url \"${RPC_URL}\" \\"
  echo -e "    --network-passphrase \"${NETWORK_PASSPHRASE}\" \\"
  echo -e "    ${NETWORK_FLAG} \\"
  echo -e "    -- set_allowed_source --caller <OWNER_PUBLIC_KEY> --source ${CONTRACT_ID}"
  echo ""
fi

# ── Check 2: Owner alignment ─────────────────────────────────
if [ -n "$EXPECTED_OWNER" ]; then
  if [ "$EMITTER_OWNER" = "$EXPECTED_OWNER" ] && [ "$ORCHESTRATOR_OWNER" = "$EXPECTED_OWNER" ]; then
    echo -e "${GREEN}✓ [PASS] Ownership aligned: both contracts owned by expected key:${NC} ${EXPECTED_OWNER}"
  else
    HAS_FAILURE=true
    echo -e "${RED}✗ [FAIL] Ownership alignment check failed against expected owner!${NC}"
    echo -e "  Expected Owner:     ${GREEN}${EXPECTED_OWNER}${NC}"
    echo -e "  Emitter Owner:      ${YELLOW}${EMITTER_OWNER}${NC}"
    echo -e "  Orchestrator Owner: ${YELLOW}${ORCHESTRATOR_OWNER}${NC}"
  fi
else
  if [ "$EMITTER_OWNER" = "$ORCHESTRATOR_OWNER" ] && [ "$EMITTER_OWNER" != "ERROR" ]; then
    echo -e "${GREEN}✓ [PASS] Ownership aligned: both contracts share the same owner:${NC} ${EMITTER_OWNER}"
  else
    HAS_FAILURE=true
    echo -e "${RED}✗ [FAIL] Emitter and Orchestrator owners are misaligned!${NC}"
    echo -e "  Emitter Owner:      ${YELLOW}${EMITTER_OWNER}${NC}"
    echo -e "  Orchestrator Owner: ${YELLOW}${ORCHESTRATOR_OWNER}${NC}"
    echo ""
    echo -e "${RED}  CRITICAL SECURITY / OPERATIONAL CONSEQUENCE:${NC}"
    echo -e "  - Emitter owner must match orchestrator owner for emergency_pause_all"
    echo -e "    and synchronous multi-contract administrative actions to succeed."
    echo ""
  fi
fi

echo "───────────────────────────────────────────────────────────────────"
if [ "$HAS_FAILURE" = "true" ]; then
  echo -e "${RED}✗ Post-deployment verification FAILED. See required remediations above.${NC}"
  exit 1
else
  echo -e "${GREEN}✓ All post-deployment emitter verification checks PASSED.${NC}"
  exit 0
fi
