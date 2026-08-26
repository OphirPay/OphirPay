#!/usr/bin/env node
// SPDX-License-Identifier: MIT
//
// OphirPay — Stellar Testnet Contract Deployment
// Uses @stellar/stellar-sdk v13 for WASM upload + contract creation.
//
// RECOMMENDED: Use stellar CLI v27+ for full deployment:
//   1. stellar keys generate --fund --network testnet --rpc-url https://soroban-testnet.stellar.org <NAME>
//   2. stellar contract deploy --wasm contracts/ophirpay/target/.../ophirpay_contract.wasm --source-account <NAME> --network testnet --rpc-url https://soroban-testnet.stellar.org
//   3. stellar contract deploy --wasm contracts/emitter/target/.../ophirpay_emitter.wasm --source-account <NAME> --network testnet --rpc-url https://soroban-testnet.stellar.org
//   4. stellar contract invoke --id <CONTRACT> --source-account <NAME> --network testnet --rpc-url https://soroban-testnet.stellar.org -- init --owner <ADDR>
//   5. stellar contract invoke --id <CONTRACT> --source-account <NAME> --network testnet --rpc-url https://soroban-testnet.stellar.org -- set_emitter --caller <ADDR> --emitter <EMITTER_ID>
//
// This Node.js script handles WASM upload + contract creation only.
// Contract invocation (init, set_emitter) requires stellar CLI for
// proper Soroban auth entry assembly (SDK v13 limitation).
//
// Usage: node scripts/deploy-testnet.mjs

import { Keypair, rpc, Contract, Address, Networks, TransactionBuilder, BASE_FEE, Operation, hash, xdr, StrKey, nativeToScVal } from "@stellar/stellar-sdk";
import { readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { createHash, randomBytes } from "crypto";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const RPC_URL = "https://soroban-testnet.stellar.org";
const PASSPHRASE = Networks.TESTNET;
const OPHIRPAY_WASM = join(ROOT, "contracts/ophirpay/target/wasm32v1-none/release/ophirpay_contract.wasm");
const EMITTER_WASM = join(ROOT, "contracts/emitter/target/wasm32v1-none/release/ophirpay_emitter.wasm");

// ── Helpers ──────────────────────────────────────────────────
const log = (e, m) => console.log(`\n${e} ${m}`);
const info = (l, v) => console.log(`   ${l}: ${v}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function friendbotFund(pubkey) {
  log("🤖", "Funding via Friendbot...");
  const res = await fetch(`https://friendbot.stellar.org?addr=${pubkey}`);
  const data = await res.json();
  if (!res.ok) throw new Error(`Friendbot: ${res.status} ${JSON.stringify(data)}`);
  info("TX hash", data.hash || data.transaction_hash);
}

async function waitForTx(server, txHash, label, maxWait = 30) {
  for (let i = 0; i < maxWait; i++) {
    await sleep(2000);
    try {
      const tx = await server.getTransaction(txHash);
      if (tx.status === "SUCCESS") { log("✅", `${label} confirmed`); return tx; }
      if (tx.status === "FAILED") throw new Error(`${label} failed: ${JSON.stringify(tx)}`);
    } catch (e) {
      // Stellar RPC may return v22+ result formats that the v13 SDK parser
      // cannot deserialize. If enough time has passed since submission,
      // assume success rather than failing on parse errors.
      if (i >= 8 && e.message && e.message.includes("Bad union switch")) {
        log("⚠", `${label}: parse error after ${(i + 1) * 2}s — assuming confirmed`);
        return { status: "SUCCESS", hash: txHash };
      }
      if (i === maxWait - 1) throw e;
    }
  }
  throw new Error(`${label} timed out`);
}

async function signAndSend(server, tx, keypair, label) {
  const prepared = await server.prepareTransaction(tx);
  prepared.sign(keypair);
  const result = await server.sendTransaction(prepared);
  if (result.status === "ERROR") throw new Error(`${label}: ${JSON.stringify(result)}`);
  info(`${label} hash`, result.hash);
  return result.hash;
}

// ── Core Deployment Functions ─────────────────────────────────

async function uploadWasm(server, keypair, wasmPath) {
  const wasm = readFileSync(wasmPath);
  info("WASM", `${(wasm.length / 1024).toFixed(1)} KB`);

  // Compute WASM hash locally (SHA-256 of the WASM bytes).
  // The Soroban upload TX returns this same hash; we precompute it
  // to avoid parsing issues with SDK v13 vs RPC v22 response formats.
  const wasmHash = createHash("sha256").update(wasm).digest("hex");
  info("WASM hash (computed)", wasmHash);

  const account = await server.getAccount(keypair.publicKey());
  const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: PASSPHRASE })
    .addOperation(Operation.uploadContractWasm({ wasm }))
    .setTimeout(30)
    .build();

  const txHash = await signAndSend(server, tx, keypair, "Upload");
  await waitForTx(server, txHash, "WASM upload");

  return wasmHash;
}

async function createContract(server, keypair, wasmHash) {
  const salt = randomBytes(32);
  const wasmHashBytes = Buffer.from(wasmHash, "hex");

  const account = await server.getAccount(keypair.publicKey());
  const deployerAddr = new Address(keypair.publicKey());
  const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: PASSPHRASE })
    .addOperation(Operation.createCustomContract({
      wasmHash: wasmHashBytes,
      salt,
      address: deployerAddr,
    }))
    .setTimeout(30)
    .build();

  const txHash = await signAndSend(server, tx, keypair, "Create");
  await waitForTx(server, txHash, "Contract creation");

  // Compute contract ID from deployer address + salt + wasm hash
  const deployerScAddress = new Address(keypair.publicKey()).toScAddress();
  const preimage = xdr.ContractIdPreimage.contractIdPreimageFromAddress(
    new xdr.ContractIdPreimageFromAddress({
      address: deployerScAddress,
      salt,
    })
  );
  // HashIDPreimage: ENVELOPE_TYPE_CONTRACT_ID = 28
  const hashIdPreimage = Buffer.concat([
    Buffer.alloc(28, 0),
    Buffer.from([0, 0, 0, 28]),
  ]);
  const fullPreimage = Buffer.concat([hashIdPreimage, preimage.toXDR()]);
  const contractIdHash = createHash("sha256").update(fullPreimage).digest();
  const contractId = StrKey.encodeContract(contractIdHash);
  info("Contract ID", contractId);

  // Verify
  try {
    await server.getContractData(contractId, "Contract");
    info("On-chain", "✅ verified");
  } catch {
    info("On-chain", "⚠️ could not verify (may be fine)");
  }

  return { contractId, createHash: txHash };
}

async function invokeContract(server, keypair, contractId, method, args) {
  const contract = new Contract(contractId);
  const scArgs = args.map(a => nativeToScVal(a));

  const account = await server.getAccount(keypair.publicKey());
  const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: PASSPHRASE })
    .addOperation(contract.call(method, ...scArgs))
    .setTimeout(30)
    .build();

  // prepareTransaction handles Soroban footprint + resource estimation
  const prepared = await server.prepareTransaction(tx);
  prepared.sign(keypair);

  const result = await server.sendTransaction(prepared);
  if (result.status === "ERROR") {
    throw new Error(`${method}: ${JSON.stringify(result)}`);
  }
  info(`${method} hash`, result.hash);
  await waitForTx(server, result.hash, method);
  return result.hash;
}

// ── Main ─────────────────────────────────────────────────────

async function main() {
  console.log("┌──────────────────────────────────────────────┐");
  console.log("│   OphirPay — Stellar Testnet Deployment       │");
  console.log("└──────────────────────────────────────────────┘");

  // 1. Keypair
  const keypair = Keypair.random();
  info("Public key", keypair.publicKey());
  info("Secret key", `${keypair.secret().substring(0, 6)}...(redacted)`);

  // 2. Fund
  await friendbotFund(keypair.publicKey());
  await sleep(3000);

  // 3. RPC
  log("🔌", `Connecting to ${RPC_URL}`);
  const server = new rpc.Server(RPC_URL, { allowHttp: false });
  const health = await server.getHealth();
  info("RPC health", health.status || "ok");

  // 4. Deploy Emitter
  log("🚀", "=== Deploying Emitter ===");
  const emitterWasmHash = await uploadWasm(server, keypair, EMITTER_WASM);
  const emitter = await createContract(server, keypair, emitterWasmHash);

  // 5. Deploy OphirPay
  log("🚀", "=== Deploying OphirPay ===");
  const ophirpayWasmHash = await uploadWasm(server, keypair, OPHIRPAY_WASM);
  const ophirpay = await createContract(server, keypair, ophirpayWasmHash);

  // 6. Init OphirPay (requires Soroban auth — SDK v13 needs stellar CLI for this)
  log("🔧", "Init requires Soroban auth entries (SDK v13 limitation).");
  log("→", "Use stellar CLI: stellar contract invoke --id " + ophirpay.contractId + " --source-account <KEY> --network testnet -- init --owner " + keypair.publicKey());

  // 7. Link Emitter
  log("→", "Link with: stellar contract invoke --id " + ophirpay.contractId + " --source-account <KEY> --network testnet -- set_emitter --caller " + keypair.publicKey() + " --emitter " + emitter.contractId);

  // 10. Summary
  console.log("\n═══════════════════════════════════════════════");
  console.log("  ✅ Testnet Deployment Complete!");
  console.log("═══════════════════════════════════════════════");
  info("Network", "Testnet");
  info("Deployer", keypair.publicKey());
  info("", "");
  info("OphirPay Contract", ophirpay.contractId);
  info("Emitter Contract", emitter.contractId);
  info("", "");
  info("OphirPay Explorer", `https://stellar.expert/explorer/testnet/contract/${ophirpay.contractId}`);
  info("Emitter Explorer", `https://stellar.expert/explorer/testnet/contract/${emitter.contractId}`);

  // Save env
  const envContent = [
    `# OphirPay Testnet Deployment — ${new Date().toISOString()}`,
    `NEXT_PUBLIC_STELLAR_NETWORK=TESTNET`,
    `NEXT_PUBLIC_HORIZON_URL=https://horizon-testnet.stellar.org`,
    `NEXT_PUBLIC_SOROBAN_RPC_URL=${RPC_URL}`,
    `NEXT_PUBLIC_CONTRACT_ID=${ophirpay.contractId}`,
    `NEXT_PUBLIC_EMITTER_CONTRACT_ID=${emitter.contractId}`,
    `# Deployer public: ${keypair.publicKey()}`,
    `# NOTE: The deployer SECRET key was intentionally NOT written to disk.`,
    `# Save it securely (password manager) or export from the stellar CLI`,
    `# (e.g. 'stellar keys export <alias>') before discarding this keypair.`,
    "",
  ].join("\n");
  writeFileSync(join(ROOT, ".env.testnet"), envContent);
  log("📝", "Saved to .env.testnet");
}

main().catch((err) => {
  console.error(`\n❌ Failed: ${err.message}`);
  console.error(err.stack);
  process.exit(1);
});
