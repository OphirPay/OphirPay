/**
 * Deploy the OphirPay Soroban contract to Stellar Testnet.
 *
 * Usage: node scripts/deploy-contract.js <secret_key>
 *
 * Two-step deployment:
 * 1. Upload WASM → get wasm_hash
 * 2. Create contract from wasm_hash → get contract_id
 */

const sdk = require("@stellar/stellar-sdk");
const fs = require("fs");
const path = require("path");

const RPC_URL = "https://soroban-testnet.stellar.org:443";
const NETWORK_PASSPHRASE = sdk.Networks.TESTNET;

async function buildAndSubmit(server, keypair, sourceAccount, operation) {
  const tx = new sdk.TransactionBuilder(sourceAccount, {
    fee: "1000000",
    networkPassphrase: NETWORK_PASSPHRASE,
    timebounds: {
      minTime: 0,
      maxTime: Math.floor(Date.now() / 1000) + 300,
    },
  })
    .addOperation(operation)
    .build();

  console.log("  Preparing transaction...");
  const prepared = await server.prepareTransaction(tx);
  prepared.sign(keypair);

  console.log("  Submitting...");
  const result = await server.sendTransaction(prepared);

  if (result.errorResultXdr) {
    throw new Error("Send failed: " + result.errorResultXdr);
  }

  console.log(`  TX hash: ${result.hash}`);

  // Poll for result
  let txResult = await server.getTransaction(result.hash);
  let attempts = 0;
  while (txResult.status === "NOT_FOUND" && attempts < 30) {
    await new Promise((r) => setTimeout(r, 2000));
    txResult = await server.getTransaction(result.hash);
    attempts++;
  }

  if (txResult.status !== "SUCCESS") {
    throw new Error(
      `Transaction ${txResult.status}: ${JSON.stringify(txResult)}`
    );
  }

  console.log(`  Status: ${txResult.status}`);
  return { hash: result.hash, resultMetaXdr: txResult.resultMetaXdr };
}

async function main() {
  const secretKey = process.argv[2];
  if (!secretKey) {
    console.error("Usage: node scripts/deploy-contract.js <SECRET_KEY>");
    process.exit(1);
  }

  const server = new sdk.rpc.Server(RPC_URL, { allowHttp: true });
  const keypair = sdk.Keypair.fromSecret(secretKey);
  const publicKey = keypair.publicKey();

  console.log(`Deploying from: ${publicKey}`);

  // Load WASM
  const wasmPath = path.join(
    __dirname,
    "..",
    "contracts",
    "ophirpay",
    "target",
    "wasm32v1-none",
    "release",
    "ophirpay_contract.wasm"
  );
  const wasmBuffer = fs.readFileSync(wasmPath);
  console.log(`WASM size: ${wasmBuffer.length} bytes`);

  // Load account
  const sourceAccount = await server.getAccount(publicKey);
  console.log(`Account sequence: ${sourceAccount.sequenceNumber()}`);

  // ── Step 1: Upload WASM ──────────────────────────────────────
  console.log("\n📦 Step 1: Uploading WASM...");
  const uploadHostFn =
    sdk.xdr.HostFunction.hostFunctionTypeUploadContractWasm(wasmBuffer);
  const uploadOp = sdk.Operation.invokeHostFunction({
    func: uploadHostFn,
    auth: [],
  });

  const uploadResult = await buildAndSubmit(
    server,
    keypair,
    sourceAccount,
    uploadOp
  );
  console.log(`  Upload TX: https://stellar.expert/explorer/testnet/tx/${uploadResult.hash}`);

  // Extract wasm hash from result meta
  const wasmHash = extractWasmHash(uploadResult.resultMetaXdr);
  if (!wasmHash) {
    console.error("Could not extract wasm hash from upload result.");
    console.log("Raw resultMetaXdr:", uploadResult.resultMetaXdr);
    process.exit(1);
  }
  console.log(`  WASM Hash: ${wasmHash}`);

  // ── Step 2: Create Contract ──────────────────────────────────
  console.log("\n📜 Step 2: Creating contract...");
  const sourceAccount2 = await server.getAccount(publicKey);

  // Build create contract host function
  const createHostFn = sdk.xdr.HostFunction.hostFunctionTypeCreateContract({
    contractIdPreimage: sdk.xdr.ContractIdPreimage.contractIdPreimageFromAddress(
      new sdk.xdr.ContractIdPreimageFromAddress({
        address: sdk.xdr.ScAddress.scAddressTypeAccount(
          sdk.StrKey.decodeEd25519PublicKey(publicKey)
        ),
        salt: Buffer.alloc(32, 0),
      })
    ),
    executable: sdk.xdr.ContractExecutable.contractExecutableWasm(
      wasmHash
    ),
  });

  const createOp = sdk.Operation.invokeHostFunction({
    func: createHostFn,
    auth: [],
  });

  const createResult = await buildAndSubmit(
    server,
    keypair,
    sourceAccount2,
    createOp
  );
  console.log(`  Create TX: https://stellar.expert/explorer/testnet/tx/${createResult.hash}`);

  // Extract contract ID from result meta
  const contractId = extractContractId(createResult.resultMetaXdr);
  if (!contractId) {
    console.error("Could not extract contract ID from create result.");
    console.log("Raw resultMetaXdr:", createResult.resultMetaXdr);
    process.exit(1);
  }

  console.log(`\n✅ CONTRACT DEPLOYED SUCCESSFULLY`);
  console.log(`===================================`);
  console.log(`Contract ID: ${contractId}`);
  console.log(`Explorer:   https://stellar.expert/explorer/testnet/contract/${contractId}`);
  console.log(`Upload TX:  https://stellar.expert/explorer/testnet/tx/${uploadResult.hash}`);
  console.log(`Create TX:  https://stellar.expert/explorer/testnet/tx/${createResult.hash}`);
  console.log(`===================================`);

  // Write to .env.txt for easy copy
  fs.writeFileSync(
    path.join(__dirname, "..", ".env.contract"),
    `# Generated by deploy-contract.js\nNEXT_PUBLIC_CONTRACT_ID=${contractId}\nNEXT_PUBLIC_CONTRACT_WASM_HASH=${wasmHash}\nNEXT_PUBLIC_CONTRACT_CREATE_TX=${createResult.hash}\nNEXT_PUBLIC_CONTRACT_UPLOAD_TX=${uploadResult.hash}\nNEXT_PUBLIC_CONTRACT_OWNER=${publicKey}\n`
  );
  console.log(`\nSaved to .env.contract`);
}

function extractWasmHash(resultMetaXdr) {
  // The wasm hash is a SHA-256 hash returned in the result
  try {
    const buff = Buffer.from(resultMetaXdr, "base64");
    const hex = buff.toString("hex");
    // Look for a 32-byte (64 hex) hash pattern after the return value
    // This is heuristic - the wasm hash appears in the result
    const match = hex.match(/[a-f0-9]{64}/g);
    if (match) {
      // The wasm hash is typically the last or second-to-last 64-char hex
      for (const m of match.reverse()) {
        if (!m.match(/^0+$/)) return m;
      }
    }
    return null;
  } catch {
    return null;
  }
}

function extractContractId(resultMetaXdr) {
  try {
    const buff = Buffer.from(resultMetaXdr, "base64");
    const hex = buff.toString("hex");
    // Contract ID is 32 bytes (64 hex chars)
    const match = hex.match(/[a-f0-9]{64}/g);
    if (match) {
      for (const m of match.reverse()) {
        if (!m.match(/^0+$/)) return m;
      }
    }
    return null;
  } catch {
    return null;
  }
}

main().catch((err) => {
  console.error("\n❌ Deployment failed:", err.message);
  process.exit(1);
});
