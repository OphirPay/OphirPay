#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────
# OphirPay Full Contract Deployment
# ─────────────────────────────────────────────────────────────────
# Builds and deploys BOTH the OphirPay and Emitter Soroban contracts
# to Stellar Testnet.
#
# Prerequisites:
#   - Rust toolchain with wasm32v1-none target (soroban-sdk 27)
#   - Stellar CLI (stellar) or soroban CLI installed
#   - A funded testnet account
#
# Usage: ./scripts/deploy-all.sh <SECRET_KEY>
#
# Environment variables (optional):
#   SOROBAN_RPC_URL  — RPC endpoint (default: testnet)
#   SOROBAN_NETWORK  — Network passphrase (default: testnet)
# ─────────────────────────────────────────────────────────────────

set -euo pipefail

SECRET_KEY="${1:-}"
if [ -z "$SECRET_KEY" ]; then
  echo "Usage: ./scripts/deploy-all.sh <SECRET_KEY>"
  echo ""
  echo "Provide a Stellar secret key (starts with S...) for a funded testnet account."
  exit 1
fi

RPC_URL="${SOROBAN_RPC_URL:-https://soroban-testnet.stellar.org:443}"
NETWORK="${SOROBAN_NETWORK:-Test SDF Network ; September 2015}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

echo "============================================"
echo " OphirPay Full Contract Deployment"
echo "============================================"
echo "RPC:     $RPC_URL"
echo ""

# ── Step 0: Build WASM ─────────────────────────────────────────
echo "🔨 Building contracts..."
echo ""

echo "  → OphirPay contract..."
(cd "$PROJECT_DIR/contracts/ophirpay" && \
  cargo build --target wasm32v1-none --release 2>&1 | tail -3)

echo "  → Emitter contract..."
(cd "$PROJECT_DIR/contracts/emitter" && \
  cargo build --target wasm32v1-none --release 2>&1 | tail -3)

echo ""
echo "✅ Both contracts built"
echo ""

# ── Step 1: Deploy OphirPay ────────────────────────────────────
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo " 📦 Deploying OphirPay Contract"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

node "$PROJECT_DIR/scripts/deploy-contract.js" "$SECRET_KEY"

OPHIRPAY_CONTRACT_ID=$(grep NEXT_PUBLIC_CONTRACT_ID "$PROJECT_DIR/.env.contract" 2>/dev/null | cut -d= -f2 || echo "")

if [ -z "$OPHIRPAY_CONTRACT_ID" ]; then
  echo "⚠️  Could not extract OphirPay contract ID — continuing anyway"
else
  echo ""
  echo "OphirPay Contract ID: $OPHIRPAY_CONTRACT_ID"
fi

# ── Step 2: Deploy Emitter ─────────────────────────────────────
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo " 📡 Deploying Emitter Contract"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

cd "$PROJECT_DIR"
node -e "
const sdk = require('@stellar/stellar-sdk');
const fs = require('fs');
const path = require('path');

const RPC = '$RPC_URL';
const NETWORK_PASSPHRASE = '$NETWORK';

async function deploy() {
  const server = new sdk.rpc.Server(RPC, { allowHttp: true });
  const keypair = sdk.Keypair.fromSecret('$SECRET_KEY');
  const pubKey = keypair.publicKey();

  // Load Emitter WASM
  const wasmPath = path.join('$PROJECT_DIR', 'contracts', 'emitter', 'target', 'wasm32v1-none', 'release', 'emitter_contract.wasm');
  const wasmBuffer = fs.readFileSync(wasmPath);
  console.log('WASM size: ' + wasmBuffer.length + ' bytes');

  const sourceAccount = await server.getAccount(pubKey);

  // Upload WASM
  console.log('Uploading WASM...');
  const uploadFn = sdk.xdr.HostFunction.hostFunctionTypeUploadContractWasm(wasmBuffer);
  const uploadOp = sdk.Operation.invokeHostFunction({ func: uploadFn, auth: [] });

  const tx = new sdk.TransactionBuilder(sourceAccount, {
    fee: '1000000',
    networkPassphrase: NETWORK_PASSPHRASE,
    timebounds: { minTime: 0, maxTime: Math.floor(Date.now() / 1000) + 300 },
  }).addOperation(uploadOp).build();

  const prepared = await server.prepareTransaction(tx);
  prepared.sign(keypair);
  const result = await server.sendTransaction(prepared);

  let txResult = await server.getTransaction(result.hash);
  let attempts = 0;
  while (txResult.status === 'NOT_FOUND' && attempts < 30) {
    await new Promise(r => setTimeout(r, 2000));
    txResult = await server.getTransaction(result.hash);
    attempts++;
  }

  if (txResult.status !== 'SUCCESS') {
    throw new Error('Upload failed: ' + txResult.status);
  }
  console.log('Upload TX: https://stellar.expert/explorer/testnet/tx/' + result.hash);

  // Extract wasm hash
  const buff = Buffer.from(txResult.resultMetaXdr, 'base64');
  const hex = buff.toString('hex');
  const match = hex.match(/[a-f0-9]{64}/g);
  const wasmHash = match ? match.find(m => !m.match(/^0+$/)) : null;
  if (!wasmHash) throw new Error('Could not extract wasm hash');
  console.log('WASM Hash: ' + wasmHash);

  // Create contract
  const sourceAccount2 = await server.getAccount(pubKey);
  const createHostFn = sdk.xdr.HostFunction.hostFunctionTypeCreateContract({
    contractIdPreimage: sdk.xdr.ContractIdPreimage.contractIdPreimageFromAddress(
      new sdk.xdr.ContractIdPreimageFromAddress({
        address: sdk.xdr.ScAddress.scAddressTypeAccount(sdk.StrKey.decodeEd25519PublicKey(pubKey)),
        salt: Buffer.alloc(32, 1), // Different salt from OphirPay (0)
      })
    ),
    executable: sdk.xdr.ContractExecutable.contractExecutableWasm(wasmHash),
  });

  const createOp = sdk.Operation.invokeHostFunction({ func: createHostFn, auth: [] });
  const createTx = new sdk.TransactionBuilder(sourceAccount2, {
    fee: '1000000',
    networkPassphrase: NETWORK_PASSPHRASE,
    timebounds: { minTime: 0, maxTime: Math.floor(Date.now() / 1000) + 300 },
  }).addOperation(createOp).build();

  const createPrepared = await server.prepareTransaction(createTx);
  createPrepared.sign(keypair);
  const createResult = await server.sendTransaction(createPrepared);

  let createTxResult = await server.getTransaction(createResult.hash);
  let cAttempts = 0;
  while (createTxResult.status === 'NOT_FOUND' && cAttempts < 30) {
    await new Promise(r => setTimeout(r, 2000));
    createTxResult = await server.getTransaction(createResult.hash);
    cAttempts++;
  }
  if (createTxResult.status !== 'SUCCESS') throw new Error('Create failed');

  // Extract contract ID
  const cBuff = Buffer.from(createTxResult.resultMetaXdr, 'base64');
  const cHex = cBuff.toString('hex');
  const cMatch = cHex.match(/[a-f0-9]{64}/g);
  const contractId = cMatch ? cMatch.find(m => !m.match(/^0+$/)) : null;

  console.log();
  console.log('✅ EMITTER DEPLOYED');
  console.log('Contract ID: ' + contractId);
  console.log('Explorer:    https://stellar.expert/explorer/testnet/contract/' + contractId);
  console.log('Upload TX:   https://stellar.expert/explorer/testnet/tx/' + result.hash);
  console.log('Create TX:   https://stellar.expert/explorer/testnet/tx/' + createResult.hash);

  // Append Emitter ID to .env.contract
  fs.appendFileSync(
    path.join('$PROJECT_DIR', '.env.contract'),
    'NEXT_PUBLIC_EMITTER_CONTRACT_ID=' + contractId + '\\n' +
    'NEXT_PUBLIC_EMITTER_WASM_HASH=' + wasmHash + '\\n' +
    'NEXT_PUBLIC_EMITTER_CREATE_TX=' + createResult.hash + '\\n' +
    'NEXT_PUBLIC_EMITTER_UPLOAD_TX=' + result.hash + '\\n'
  );

  // Link Emitter to OphirPay (cross-contract orchestration)
  console.log('');
  console.log('🔗 To link Emitter to OphirPay:');
  console.log('   Call set_emitter on the OphirPay contract with the Emitter contract ID');
  console.log('   Then emergency_pause_all / emergency_unpause_all will control both.');
}

deploy().catch(err => {
  console.error('Emitter deployment failed:', err.message);
  process.exit(1);
});
"

echo ""
echo "============================================"
echo " ✅ DEPLOYMENT COMPLETE"
echo "============================================"
echo ""
echo "Contract IDs saved to .env.contract"
echo ""
echo "Next steps:"
echo "  1. Copy .env.contract values to .env.local"
echo "  2. Call init(owner) on both contracts"
echo "  3. Call set_emitter(emitter_address) on OphirPay"
echo "  4. Verify at https://stellar.expert/explorer/testnet"
echo ""
