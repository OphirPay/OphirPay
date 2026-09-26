#!/usr/bin/env node
// SPDX-License-Identifier: MIT

import fs from "fs";
import path from "path";

// ── CSV Parsing Logic ──────────────────────────────────────────
function parseCsvLine(line) {
  const result = [];
  let current = "";
  let insideQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (insideQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        insideQuotes = !insideQuotes;
      }
    } else if (char === "," && !insideQuotes) {
      result.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  return result;
}

function parsePaymentCsv(csvContent) {
  if (!csvContent || !csvContent.trim()) {
    throw new Error("CSV content is empty");
  }

  const rawLines = csvContent.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (rawLines.length === 0) {
    throw new Error("CSV content contains no data rows");
  }

  let startIndex = 0;
  let colAddress = 0;
  let colAmount = 1;
  let colAsset = 2;
  let colMemo = 3;

  const firstRow = parseCsvLine(rawLines[0]).map((h) => h.toLowerCase());
  const hasHeader =
    firstRow.some((h) => h.includes("address") || h.includes("dest") || h.includes("recipient")) &&
    firstRow.some((h) => h.includes("amount") || h.includes("value") || h.includes("total"));

  if (hasHeader) {
    startIndex = 1;
    colAddress = firstRow.findIndex((h) => h.includes("address") || h.includes("dest") || h.includes("recipient"));
    colAmount = firstRow.findIndex((h) => h.includes("amount") || h.includes("value") || h.includes("total"));
    colAsset = firstRow.findIndex((h) => h.includes("asset") || h.includes("currency") || h.includes("token"));
    colMemo = firstRow.findIndex((h) => h.includes("memo") || h.includes("note") || h.includes("desc"));
  }

  const recipients = [];

  for (let i = startIndex; i < rawLines.length; i++) {
    const lineNumber = i + 1;
    const cols = parseCsvLine(rawLines[i]);
    if (cols.length === 0 || (cols.length === 1 && !cols[0])) continue;

    const address = colAddress !== -1 ? cols[colAddress] : undefined;
    const amountStr = colAmount !== -1 ? cols[colAmount] : undefined;
    const assetCode = colAsset !== -1 && cols[colAsset] ? cols[colAsset].toUpperCase() : "XLM";
    const memo = colMemo !== -1 && cols[colMemo] ? cols[colMemo] : undefined;

    if (!address) {
      throw new Error(`Line ${lineNumber}: Missing destination address`);
    }

    if (!/^G[A-Z0-9]{55}$/.test(address)) {
      throw new Error(
        `Line ${lineNumber}: Invalid Stellar address "${address}". Must be 56 characters starting with 'G'.`
      );
    }

    const amount = Number(amountStr);
    if (!amountStr || isNaN(amount) || amount <= 0) {
      throw new Error(`Line ${lineNumber}: Invalid payment amount "${amountStr}". Must be positive.`);
    }

    recipients.push({ address, amount, assetCode, memo: memo || undefined });
  }

  if (recipients.length === 0) {
    throw new Error("No valid recipient rows found in CSV");
  }

  return recipients;
}

// ── GitHub Action Output Helpers ───────────────────────────────
function setOutput(key, value) {
  const outputFile = process.env.GITHUB_OUTPUT;
  if (outputFile) {
    fs.appendFileSync(outputFile, `${key}=${value}\n`);
  }
}

function setStepSummary(markdown) {
  const summaryFile = process.env.GITHUB_STEP_SUMMARY;
  if (summaryFile) {
    fs.appendFileSync(summaryFile, markdown + "\n");
  }
}

async function run() {
  const apiKey = process.env.INPUT_API_KEY;
  const csvFile = process.env.INPUT_CSV_FILE;
  const batchName = process.env.INPUT_BATCH_NAME;
  const sourceAccount = process.env.INPUT_SOURCE_ACCOUNT;
  const baseUrl = (process.env.INPUT_BASE_URL || "https://api.ophirpay.com").replace(/\/+$/, "");
  const description = process.env.INPUT_DESCRIPTION || "";
  const idempotencyKey = process.env.INPUT_IDEMPOTENCY_KEY || "";
  const failOnRejected = (process.env.INPUT_FAIL_ON_REJECTED || "true").toLowerCase() === "true";

  if (!apiKey) {
    console.error("::error::Missing required input: api-key");
    process.exit(1);
  }
  if (!csvFile) {
    console.error("::error::Missing required input: csv-file");
    process.exit(1);
  }
  if (!batchName) {
    console.error("::error::Missing required input: batch-name");
    process.exit(1);
  }
  if (!sourceAccount) {
    console.error("::error::Missing required input: source-account");
    process.exit(1);
  }

  const resolvedPath = path.resolve(process.cwd(), csvFile);
  if (!fs.existsSync(resolvedPath)) {
    console.error(`::error::CSV file not found: ${resolvedPath}`);
    process.exit(1);
  }

  let recipients;
  try {
    const csvContent = fs.readFileSync(resolvedPath, "utf8");
    recipients = parsePaymentCsv(csvContent);
  } catch (err) {
    console.error(`::error::Failed to parse CSV file: ${err.message}`);
    process.exit(1);
  }

  const totalAmount = recipients.reduce((sum, r) => sum + r.amount, 0);
  console.log(`Submitting batch "${batchName}" with ${recipients.length} recipients (total: ${totalAmount} XLM)...`);

  const headers = {
    "Content-Type": "application/json",
    Accept: "application/json",
    Authorization: `Bearer ${apiKey}`,
    "X-API-Key": apiKey,
  };
  if (idempotencyKey) {
    headers["Idempotency-Key"] = idempotencyKey;
  }

  let response;
  try {
    response = await fetch(`${baseUrl}/api/batches`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        name: batchName,
        description: description || undefined,
        sourceAccountId: sourceAccount,
        recipients,
      }),
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
    console.error(`::error::OphirPay batch submission failed: ${message}`);
    process.exit(1);
  }

  const batch = result.data || result;
  const items = batch.items || batch.payments || [];
  const failedItems = items.filter((p) => p.status === "failed" || p.status === "FAILED");
  const isFailed = batch.status === "FAILED" || (batch.progress && batch.progress.failed > 0) || failedItems.length > 0;

  setOutput("batch-id", batch.id);
  setOutput("status", batch.status);
  setOutput("total-recipients", recipients.length);
  setOutput("total-amount", totalAmount);

  console.log(`Batch processed successfully: ID=${batch.id}, Status=${batch.status}`);

  setStepSummary(`
### 💸 OphirPay Batch Payout Summary
- **Batch ID:** \`${batch.id}\`
- **Name:** ${batchName}
- **Status:** **${batch.status}**
- **Recipients:** ${recipients.length}
- **Total Amount:** ${totalAmount}
- **Failed Payments:** ${failedItems.length}
`);

  if (failOnRejected && isFailed) {
    console.error(
      `::error::OphirPay batch ${batch.id} contains ${failedItems.length} rejected or failed payment(s). Failing workflow job.`
    );
    process.exit(1);
  }
}

run();
