#!/usr/bin/env node
// SPDX-License-Identifier: MIT

import fs from "fs";

function setOutput(key, value) {
  const outputFile = process.env.GITHUB_OUTPUT;
  if (outputFile) {
    fs.appendFileSync(outputFile, `${key}=${value}\n`);
  }
}

async function run() {
  const apiKey = process.env.INPUT_API_KEY;
  const amountStr = process.env.INPUT_AMOUNT;
  const destAddress = process.env.INPUT_DEST_ADDRESS;
  const sourceAccount = process.env.INPUT_SOURCE_ACCOUNT;
  const assetCode = process.env.INPUT_ASSET_CODE || "XLM";
  const baseUrl = (process.env.INPUT_BASE_URL || "https://api.ophirpay.com").replace(/\/+$/, "");
  const memo = process.env.INPUT_MEMO || "";
  const description = process.env.INPUT_DESCRIPTION || "";

  if (!apiKey) {
    console.error("::error::Missing required input: api-key");
    process.exit(1);
  }
  if (!amountStr || isNaN(Number(amountStr)) || Number(amountStr) <= 0) {
    console.error("::error::Missing or invalid amount");
    process.exit(1);
  }
  if (!destAddress) {
    console.error("::error::Missing required input: dest-address");
    process.exit(1);
  }
  if (!sourceAccount) {
    console.error("::error::Missing required input: source-account");
    process.exit(1);
  }

  const payload = {
    amount: Number(amountStr),
    destAddress,
    sourceAccountId: sourceAccount,
    assetCode,
    memo: memo || undefined,
    description: description || undefined,
  };

  const headers = {
    "Content-Type": "application/json",
    Accept: "application/json",
    Authorization: `Bearer ${apiKey}`,
    "X-API-Key": apiKey,
  };

  let response;
  try {
    response = await fetch(`${baseUrl}/api/payments`, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });
  } catch (err) {
    console.error(`::error::Network error calling OphirPay API: ${err.message}`);
    process.exit(1);
  }

  let result;
  try {
    result = await response.json();
  } catch {
    console.error(`::error::API returned non-JSON response (HTTP ${response.status})`);
    process.exit(1);
  }

  if (!response.ok) {
    const message = result?.error?.message || result?.message || `HTTP ${response.status}`;
    console.error(`::error::OphirPay payment creation failed: ${message}`);
    process.exit(1);
  }

  const payment = result.data || result;
  setOutput("payment-id", payment.id);
  setOutput("status", payment.status);
  setOutput("tx-hash", payment.txHash || "");

  console.log(`Payment created: ID=${payment.id}, Status=${payment.status}, TxHash=${payment.txHash || "pending"}`);
}

run();
