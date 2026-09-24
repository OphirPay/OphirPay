#!/usr/bin/env node
// SPDX-License-Identifier: MIT

import fs from "fs";
import path from "path";
import crypto from "crypto";

const VERSION = "0.1.0";

// ── Colors and Formatting ──────────────────────────────────────
const reset = "\x1b[0m";
const bold = "\x1b[1m";
const green = "\x1b[32m";
const red = "\x1b[31m";
const yellow = "\x1b[33m";
const cyan = "\x1b[36m";

function logSuccess(msg) {
  console.log(`${green}✔${reset} ${msg}`);
}

function logError(msg) {
  console.error(`${red}✖${reset} ${bold}${msg}${reset}`);
}

function logWarning(msg) {
  console.log(`${yellow}⚠${reset} ${msg}`);
}

function logInfo(msg) {
  console.log(`${cyan}ℹ${reset} ${msg}`);
}

// ── CSV Parser Helper ──────────────────────────────────────────
export function parseCsvLine(line) {
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

export function parsePaymentCsv(csvContent) {
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

    if (memo && memo.length > 28) {
      throw new Error(`Line ${lineNumber}: Memo "${memo}" exceeds maximum limit of 28 characters.`);
    }

    recipients.push({ address, amount, assetCode, memo: memo || undefined });
  }

  if (recipients.length === 0) {
    throw new Error("No valid recipient rows found in CSV");
  }

  if (recipients.length > 100) {
    throw new Error(`CSV contains ${recipients.length} recipients. Maximum allowed per batch is 100.`);
  }

  return recipients;
}

// ── Webhook Verification Helper ────────────────────────────────
export function verifyWebhook(bodyContent, signature, secret) {
  if (!bodyContent) return { valid: false, reason: "Payload body is empty" };
  if (!signature) return { valid: false, reason: "Missing signature" };
  if (!secret) return { valid: false, reason: "Missing secret" };

  let parsed;
  try {
    parsed = typeof bodyContent === "string" ? JSON.parse(bodyContent) : bodyContent;
  } catch {
    return { valid: false, reason: "Malformed JSON payload" };
  }

  const canonicalObj = { ...parsed, signature: "" };
  const canonicalString = JSON.stringify(canonicalObj);

  const expectedSignature = crypto
    .createHmac("sha256", secret)
    .update(canonicalString)
    .digest("hex");

  const sigBuffer = Buffer.from(signature.trim().toLowerCase(), "hex");
  const expBuffer = Buffer.from(expectedSignature.toLowerCase(), "hex");

  if (sigBuffer.length !== expBuffer.length) {
    return { valid: false, reason: "Signature length mismatch" };
  }

  const match = crypto.timingSafeEqual(sigBuffer, expBuffer);
  return { valid: match, reason: match ? undefined : "HMAC signature mismatch" };
}

// ── HTTP API Client Helper ─────────────────────────────────────
async function apiRequest(endpoint, options = {}, config = {}) {
  const baseUrl = (config.baseUrl || process.env.OPHIRPAY_BASE_URL || "https://api.ophirpay.com").replace(/\/+$/, "");
  const apiKey = config.apiKey || process.env.OPHIRPAY_API_KEY;

  const url = `${baseUrl}${endpoint.startsWith("/") ? endpoint : `/${endpoint}`}`;
  const headers = {
    Accept: "application/json",
    ...(options.headers || {}),
  };

  if (apiKey) {
    headers["Authorization"] = `Bearer ${apiKey}`;
    headers["X-API-Key"] = apiKey;
  }

  if (options.body && typeof options.body === "string" && !headers["Content-Type"]) {
    headers["Content-Type"] = "application/json";
  }

  const res = await fetch(url, {
    ...options,
    headers,
  });

  const contentType = res.headers.get("content-type") || "";
  let json = null;
  if (contentType.includes("application/json")) {
    json = await res.json();
  } else {
    const text = await res.text();
    json = text ? { message: text } : null;
  }

  if (!res.ok) {
    const message = (json?.error?.message || json?.message || `HTTP ${res.status}`);
    const err = new Error(message);
    err.status = res.status;
    err.response = json;
    throw err;
  }

  return json;
}

// ── CLI Argument Parser ────────────────────────────────────────
function parseArgs(args) {
  const flags = {};
  const positionals = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      if (i + 1 < args.length && !args[i + 1].startsWith("--")) {
        flags[key] = args[i + 1];
        i++;
      } else {
        flags[key] = true;
      }
    } else if (arg.startsWith("-")) {
      const key = arg.slice(1);
      if (i + 1 < args.length && !args[i + 1].startsWith("-")) {
        flags[key] = args[i + 1];
        i++;
      } else {
        flags[key] = true;
      }
    } else {
      positionals.push(arg);
    }
  }

  return { flags, positionals };
}

function printHelp() {
  console.log(`
${bold}OphirPay CLI${reset} — Programmatic Payment Orchestration for CI/CD & Automation (v${VERSION})

${bold}USAGE:${reset}
  $ ophirpay <command> [options]

${bold}COMMANDS:${reset}
  ${cyan}payment create${reset}     Create an individual payment
  ${cyan}payment get <id>${reset}   Retrieve status of a payment
  ${cyan}batch create${reset}       Create a batch payout from a CSV file
  ${cyan}batch get <id>${reset}     Retrieve batch progress and item statuses
  ${cyan}status <id>${reset}        Retrieve payment or batch status
  ${cyan}webhook verify${reset}     Verify webhook payload HMAC signature
  ${cyan}health${reset}             Check API connectivity and server status

${bold}GLOBAL OPTIONS:${reset}
  --api-key <key>       API key (or set OPHIRPAY_API_KEY env)
  --base-url <url>      OphirPay API URL (or set OPHIRPAY_BASE_URL env)
  --json                Output response in raw JSON format
  -h, --help            Show this help reference
  -v, --version         Show CLI version

${bold}EXAMPLES:${reset}
  # Submit batch payout from CSV file
  $ ophirpay batch create --csv ./payouts.csv --name "Payroll-Sep" --source GACNK...

  # Create single payment
  $ ophirpay payment create --amount 25.5 --dest GXYZ... --source GABC... --memo "Invoice-1"

  # Check status of payment or batch
  $ ophirpay status p_987654

  # Verify incoming webhook signature
  $ ophirpay webhook verify --payload webhook.json --signature 64794... --secret whsec_...
`);
}

// ── Main Entrypoint ────────────────────────────────────────────
async function main() {
  const argv = process.argv.slice(2);
  if (argv.length === 0 || argv.includes("-h") || argv.includes("--help")) {
    printHelp();
    process.exit(0);
  }

  if (argv.includes("-v") || argv.includes("--version")) {
    console.log(`ophirpay v${VERSION}`);
    process.exit(0);
  }

  const { flags, positionals } = parseArgs(argv);
  const command = positionals[0]?.toLowerCase();
  const subcommand = positionals[1]?.toLowerCase();

  const config = {
    apiKey: flags["api-key"] || flags["k"],
    baseUrl: flags["base-url"] || flags["u"],
  };

  try {
    // ── Payment Commands ──
    if (command === "payment") {
      if (subcommand === "create") {
        const amount = Number(flags["amount"]);
        const destAddress = flags["dest"] || flags["destination"];
        const sourceAccountId = flags["source"] || flags["source-account"];
        const assetCode = flags["asset"] || flags["asset-code"] || "XLM";
        const memo = flags["memo"];
        const description = flags["desc"] || flags["description"];

        if (!amount || isNaN(amount) || amount <= 0) {
          logError("Missing or invalid --amount (must be positive number)");
          process.exit(1);
        }
        if (!destAddress) {
          logError("Missing --dest (destination Stellar address)");
          process.exit(1);
        }
        if (!sourceAccountId) {
          logError("Missing --source (source Stellar account)");
          process.exit(1);
        }

        const payload = {
          amount,
          destAddress,
          sourceAccountId,
          assetCode,
          memo: memo || undefined,
          description: description || undefined,
        };

        const res = await apiRequest("/api/payments", {
          method: "POST",
          body: JSON.stringify(payload),
        }, config);

        if (flags["json"]) {
          console.log(JSON.stringify(res, null, 2));
        } else {
          const p = res.data || res;
          logSuccess(`Payment created successfully! ID: ${bold}${p.id}${reset}`);
          console.log(`  Amount: ${p.amount} ${p.assetCode}`);
          console.log(`  Status: ${p.status}`);
          console.log(`  Destination: ${p.destAddress}`);
          if (p.txHash) console.log(`  TxHash: ${p.txHash}`);
        }
        return;
      }

      if (subcommand === "get" || subcommand === "status") {
        const id = positionals[2] || flags["id"];
        if (!id) {
          logError("Missing payment ID (e.g. ophirpay payment get <id>)");
          process.exit(1);
        }

        const res = await apiRequest(`/api/payments/${encodeURIComponent(id)}`, { method: "GET" }, config);
        if (flags["json"]) {
          console.log(JSON.stringify(res, null, 2));
        } else {
          const p = res.data || res;
          logInfo(`Payment ${bold}${p.id}${reset}`);
          console.log(`  Status: ${p.status}`);
          console.log(`  Amount: ${p.amount} ${p.assetCode}`);
          console.log(`  Destination: ${p.destAddress}`);
          if (p.txHash) console.log(`  TxHash: ${p.txHash}`);
        }
        return;
      }
    }

    // ── Batch Commands ──
    if (command === "batch") {
      if (subcommand === "create") {
        const csvPath = flags["csv"] || flags["file"];
        const name = flags["name"];
        const sourceAccountId = flags["source"] || flags["source-account"];
        const description = flags["desc"] || flags["description"];
        const failOnRejected = flags["fail-on-rejected"] !== false && flags["fail-on-rejected"] !== "false";

        if (!csvPath) {
          logError("Missing --csv <path-to-file>");
          process.exit(1);
        }
        if (!name) {
          logError("Missing --name <batch-name>");
          process.exit(1);
        }
        if (!sourceAccountId) {
          logError("Missing --source <source-account-id>");
          process.exit(1);
        }

        const resolvedPath = path.resolve(process.cwd(), csvPath);
        if (!fs.existsSync(resolvedPath)) {
          logError(`CSV file not found: ${resolvedPath}`);
          process.exit(1);
        }

        const csvContent = fs.readFileSync(resolvedPath, "utf8");
        const recipients = parsePaymentCsv(csvContent);
        logInfo(`Parsed ${recipients.length} recipients from ${csvPath}`);

        const res = await apiRequest("/api/batches", {
          method: "POST",
          body: JSON.stringify({
            name,
            description,
            sourceAccountId,
            recipients,
          }),
        }, config);

        const batch = res.data || res;
        const items = batch.items || batch.payments || [];
        const failedItems = items.filter((item) => item.status === "failed" || item.status === "FAILED");
        const isBatchFailed = batch.status === "FAILED" || (batch.progress && batch.progress.failed > 0) || failedItems.length > 0;

        if (flags["json"]) {
          console.log(JSON.stringify(res, null, 2));
        } else {
          logSuccess(`Batch payout registered! ID: ${bold}${batch.id}${reset}`);
          console.log(`  Name: ${batch.name}`);
          console.log(`  Status: ${batch.status}`);
          console.log(`  Recipients: ${recipients.length}`);
          if (batch.progress) {
            console.log(`  Progress: ${batch.progress.sent}/${batch.progress.total} sent (${batch.progress.failed} failed)`);
          }
        }

        // CI gate: fail job if any payment was rejected or failed
        if (failOnRejected && isBatchFailed) {
          logError(`Batch completed with rejected/failed payments (${failedItems.length} failed)`);
          process.exit(1);
        }

        return;
      }

      if (subcommand === "get" || subcommand === "status") {
        const id = positionals[2] || flags["id"];
        if (!id) {
          logError("Missing batch ID (e.g. ophirpay batch get <id>)");
          process.exit(1);
        }

        const res = await apiRequest(`/api/batches/${encodeURIComponent(id)}`, { method: "GET" }, config);
        if (flags["json"]) {
          console.log(JSON.stringify(res, null, 2));
        } else {
          const b = res.data || res;
          logInfo(`Batch ${bold}${b.id}${reset}`);
          console.log(`  Name: ${b.name}`);
          console.log(`  Status: ${b.status}`);
          if (b.progress) {
            console.log(`  Progress: ${b.progress.sent}/${b.progress.total} sent (${b.progress.failed} failed, ${b.progress.pending} pending)`);
          }
        }
        return;
      }
    }

    // ── Status Retrieval Command ──
    if (command === "status") {
      const id = positionals[1] || flags["id"];
      if (!id) {
        logError("Missing ID (e.g. ophirpay status <id>)");
        process.exit(1);
      }

      const type = flags["type"]?.toLowerCase();

      // If type specified, fetch directly
      if (type === "batch") {
        const res = await apiRequest(`/api/batches/${encodeURIComponent(id)}`, { method: "GET" }, config);
        console.log(JSON.stringify(res, null, 2));
        return;
      }

      if (type === "payment") {
        const res = await apiRequest(`/api/payments/${encodeURIComponent(id)}`, { method: "GET" }, config);
        console.log(JSON.stringify(res, null, 2));
        return;
      }

      // Auto-detect by attempting payment first, then batch
      try {
        const res = await apiRequest(`/api/payments/${encodeURIComponent(id)}`, { method: "GET" }, config);
        if (flags["json"]) {
          console.log(JSON.stringify(res, null, 2));
        } else {
          const p = res.data || res;
          logInfo(`Payment status: ${bold}${p.status}${reset} (ID: ${p.id})`);
        }
        return;
      } catch (err) {
        if (err.status === 404) {
          const res = await apiRequest(`/api/batches/${encodeURIComponent(id)}`, { method: "GET" }, config);
          if (flags["json"]) {
            console.log(JSON.stringify(res, null, 2));
          } else {
            const b = res.data || res;
            logInfo(`Batch status: ${bold}${b.status}${reset} (ID: ${b.id})`);
          }
          return;
        }
        throw err;
      }
    }

    // ── Webhook Verification Command ──
    if (command === "webhook") {
      if (subcommand === "verify") {
        const payloadInput = flags["payload"] || flags["p"] || flags["body"];
        const signature = flags["signature"] || flags["sig"] || flags["s"];
        const secret = flags["secret"] || process.env.OPHIRPAY_WEBHOOK_SECRET;

        if (!payloadInput) {
          logError("Missing --payload <path-or-json>");
          process.exit(1);
        }
        if (!signature) {
          logError("Missing --signature <hex-signature>");
          process.exit(1);
        }
        if (!secret) {
          logError("Missing --secret <webhook-signing-secret> (or OPHIRPAY_WEBHOOK_SECRET env)");
          process.exit(1);
        }

        let bodyString = payloadInput;
        if (fs.existsSync(payloadInput)) {
          bodyString = fs.readFileSync(payloadInput, "utf8");
        }

        const result = verifyWebhook(bodyString, signature, secret);
        if (result.valid) {
          logSuccess("Webhook signature is VALID and authentic.");
          process.exit(0);
        } else {
          logError(`Webhook signature verification FAILED: ${result.reason}`);
          process.exit(1);
        }
      }
    }

    // ── Health Check ──
    if (command === "health") {
      const res = await apiRequest("/api/health", { method: "GET" }, config);
      if (flags["json"]) {
        console.log(JSON.stringify(res, null, 2));
      } else {
        logSuccess(`OphirPay API is healthy (${res.status || "OK"})`);
        if (res.version) console.log(`  Version: ${res.version}`);
        if (res.timestamp) console.log(`  Timestamp: ${res.timestamp}`);
      }
      return;
    }

    printHelp();
    process.exit(1);
  } catch (err) {
    logError(err.message || String(err));
    if (flags["debug"] && err.stack) {
      console.error(err.stack);
    }
    process.exit(1);
  }
}

import { fileURLToPath } from "url";

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main();
}
