# OphirPay Troubleshooting & Error Resolution Guide

## Overview

This guide provides systematic solutions for common setup, network, smart contract, and wallet connectivity issues encountered when running OphirPay locally or on Stellar Testnet/Mainnet.

---

## Table of Contents

1. [Stellar Network & Horizon RPC Errors](#1-stellar-network--horizon-rpc-errors)
2. [Friendbot Testnet Account Funding Failures](#2-friendbot-testnet-account-funding-failures)
3. [Trustline & Asset Transfer Issues](#3-trustline--asset-transfer-issues)
4. [Wallet Rejections & Hardware Signers](#4-wallet-rejections--hardware-signers)
5. [Local Development & Database Drift](#5-local-development--database-drift)

---

## 1. Stellar Network & Horizon RPC Errors

### Symptom: `504 Gateway Timeout` or `Horizon RPC Timeout`
* **Cause:** Public Stellar Horizon / Soroban RPC nodes are under heavy traffic or rate-limiting unauthenticated requests.
* **Fix:**
  1. Open `.env` and switch to an alternate public RPC node or configure a private RPC endpoint (e.g. QuickNode / Blockdaemon):
     ```bash
     NEXT_PUBLIC_STELLAR_RPC_URL="https://soroban-testnet.stellar.org"
     ```
  2. Verify network status at [Stellar Dashboard](https://dashboard.stellar.org).

### Symptom: `tx_bad_seq` (Bad Sequence Number)
* **Cause:** A transaction was submitted using a sequence number that has already been consumed by another concurrent transaction.
* **Fix:**
  * Re-fetch the latest account sequence from Horizon before signing:
    ```typescript
    const account = await server.loadAccount(publicKey);
    ```

---

## 2. Friendbot Testnet Account Funding Failures

### Symptom: `Friendbot 400 Bad Request` or Account Remains Unfunded
* **Cause:** The destination Stellar public key is invalid, or Friendbot rate limit has been exceeded for the client IP.
* **Fix:**
  1. Validate that the public key starts with `G` and has exactly 56 alphanumeric characters.
  2. Trigger Friendbot via direct curl request:
     ```bash
     curl "https://friendbot.stellar.org?addr=YOUR_STELLAR_PUBLIC_KEY"
     ```
  3. If rate-limited, connect through a VPN or fund using [Stellar Laboratory](https://laboratory.stellar.org/#account-creator).

---

## 3. Trustline & Asset Transfer Issues

### Symptom: `op_no_trust` (Trustline Not Established)
* **Cause:** Attempting to send non-native assets (such as USDC) to an account that has not established a trustline with the asset issuer.
* **Fix:**
  1. The recipient account must submit a `ChangeTrust` operation establishing trust with the issuer:
     ```typescript
     const trustOp = Operation.changeTrust({
       asset: new Asset("USDC", ISSUER_ADDRESS),
       limit: "1000000"
     });
     ```
  2. Ensure the recipient has at least 1.5 XLM available to satisfy Stellar's minimum reserve requirement (0.5 XLM base reserve + 0.5 XLM per trustline).

---

## 4. Wallet Rejections & Hardware Signers

### Symptom: `User Rejected Request` (Freighter / Albedo / xBull)
* **Cause:** The user dismissed the wallet popup or transaction simulation returned an estimated failure on Soroban.
* **Fix:**
  * Check contract parameters for invalid authorization addresses.
  * In Freighter, ensure the active network matches the application environment (`Testnet` vs `Mainnet`).

---

## 5. Local Development & Database Drift

### Symptom: `PrismaClientKnownRequestError: Table does not exist`
* **Cause:** Local SQLite/PostgreSQL schema is out of sync with Prisma migrations.
* **Fix:**
  ```bash
  npx prisma migrate dev
  npx prisma generate
  ```
