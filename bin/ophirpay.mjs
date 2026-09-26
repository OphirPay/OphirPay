#!/usr/bin/env node
// SPDX-License-Identifier: MIT
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createHmac, timingSafeEqual } from "node:crypto";

function parseBatchCsv(csvText) {
  const lines = csvText.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (lines.length === 0) {
    throw new Error("CSV file is empty");
  }

  const recipients = [];
  const firstLine = lines[0].toLowerCase();
  const isHeader = firstLine.startsWith("address,") || firstLine.startsWith('"address"') || firstLine === "address";
  const startIndex = isHeader ? 1 : 0;

  for (let i = startIndex; i < lines.length; i++) {
    const parts = lines[i].split(",").map(p => p.trim().replace(/^["']|["']$/g, ""));
    if (parts.length < 2) {
      continue;
    }
    const [address, amountStr, assetCode, memo] = parts;
    const amount = Number(amountStr);
    if (isNaN(amount) || amount <= 0) {
      throw new Error(`Invalid payment amount '${amountStr}' on line ${i + 1}`);
    }
    if (!address.startsWith("G") || address.length !== 56) {
      throw new Error(`Invalid Stellar address '${address}' on line ${i + 1}`);
    }

    recipients.push({
      address,
      amount,
      assetCode: assetCode || "XLM",
      memo: memo || undefined,
    });
  }

  if (recipients.length === 0) {
    throw new Error("No valid payment rows found in CSV");
  }

  return recipients;
}

function canonicalizeWebhookBody(body) {
  const parsed = JSON.parse(body);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("Webhook body must be a JSON object");
  }
  return JSON.stringify({ ...parsed, signature: "" });
}

function verifyWebhookSignature({ body, signature, secret, timestamp, maxAgeSeconds = 300, now = new Date() }) {
  if (!body || !signature || !secret) {
    return false;
  }

  let effectiveTimestamp = timestamp;
  if (!effectiveTimestamp) {
    try {
      const parsed = JSON.parse(body);
      effectiveTimestamp = parsed.timestamp;
    } catch {
      return false;
    }
  }

  if (!effectiveTimestamp) {
    return false;
  }

  if (maxAgeSeconds > 0) {
    const eventTime = new Date(effectiveTimestamp).getTime();
    if (isNaN(eventTime)) {
      return false;
    }
    const diffSeconds = Math.abs(now.getTime() - eventTime) / 1000;
    if (diffSeconds > maxAgeSeconds) {
      return false;
    }
  }

  try {
    const canonical = canonicalizeWebhookBody(body);
    const expected = createHmac("sha256", secret)
      .update(`${effectiveTimestamp}.${canonical}`)
      .digest("hex");

    if (expected.length !== signature.length) {
      return false;
    }

    return timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(signature, "hex"));
  } catch {
    return false;
  }
}

class OphirPayClient {
  constructor(config) {
    this.baseUrl = (config.baseUrl || "http://localhost:3000").replace(/\/$/, "");
    this.apiKey = config.apiKey || "";
  }

  async request(endpoint, options = {}) {
    const url = `${this.baseUrl}${endpoint.startsWith("/") ? "" : "/"}${endpoint}`;
    const headers = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${this.apiKey}`,
      ...options.headers,
    };

    const res = await fetch(url, {
      ...options,
      headers,
    });

    const data = await res.json().catch(() => null);
    if (!res.ok) {
      const msg = data?.message || data?.error || `Request failed with status ${res.status}`;
      throw new Error(msg);
    }
    return data?.data ?? data;
  }

  async createPayment(payload) {
    return this.request("/api/payments", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }

  async getPayment(id) {
    return this.request(`/api/payments/${encodeURIComponent(id)}`, { method: "GET" });
  }

  async createBatch(payload) {
    return this.request("/api/batches", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }

  async getBatch(id) {
    return this.request(`/api/batches/${encodeURIComponent(id)}`, { method: "GET" });
  }

  async health() {
    return this.request("/api/health", { method: "GET" });
  }
}

function printUsage() {
  console.log(`
OphirPay CLI — Programmatic Stellar Payments & CI Automation

Usage:
  ophirpay <command> [subcommand] [options]

Commands:
  payment create       Create a single payment
    --dest <address>     Recipient Stellar account address
    --amount <number>    Payment amount
    --source <address>   Source account (defaults to OPHIRPAY_SOURCE_ACCOUNT)
    [--asset <code>]     Asset code (default: XLM)
    [--memo <text>]      Transaction memo
    [--desc <text>]      Payment description

  payment get <id>     Retrieve payment details by ID

  batch submit         Submit batch payments from a CSV file
    --file <path>        Path to CSV file (columns: address,amount,[assetCode],[memo])
    --name <string>      Name for the batch run
    --source <address>   Source account
    [--fail-on-rejected] Exit code 1 if any child payment fails/is rejected (for CI)

  batch get <id>       Retrieve batch status and child payment ledger

  status <id>          Generic status lookup for payment or batch

  webhook verify       Validate HMAC-SHA256 signature for incoming webhooks
    --secret <key>       Webhook signing secret
    --signature <hex>    Value of X-OphirPay-Signature header
    [--body <json>]      Raw JSON payload string
    [--file <path>]      Path to payload JSON file
    [--timestamp <iso>]  Timestamp from header (or parsed from payload)

  health               Ping OphirPay API health endpoint

Global Options:
  --api-key <key>      API key (or set OPHIRPAY_API_KEY)
  --base-url <url>     Base URL (default: http://localhost:3000 or OPHIRPAY_BASE_URL)
  --json               Output machine-readable JSON
  --help, -h           Show this help message
`);
}

function parseCliArgs(args) {
  const parsed = {
    _: [],
    flags: {},
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      if (i + 1 < args.length && !args[i + 1].startsWith("--")) {
        parsed.flags[key] = args[i + 1];
        i++;
      } else {
        parsed.flags[key] = true;
      }
    } else if (arg.startsWith("-")) {
      const key = arg.slice(1);
      parsed.flags[key] = true;
    } else {
      parsed._.push(arg);
    }
  }

  return parsed;
}

async function main() {
  const args = process.argv.slice(2);
  const parsed = parseCliArgs(args);

  if (parsed.flags.help || parsed.flags.h || parsed._.length === 0) {
    printUsage();
    process.exit(0);
  }

  const apiKey = parsed.flags["api-key"] || process.env.OPHIRPAY_API_KEY || "mock-ci-key";
  const baseUrl = parsed.flags["base-url"] || process.env.OPHIRPAY_BASE_URL || "http://localhost:3000";
  const isJson = Boolean(parsed.flags.json);

  const command = parsed._[0];
  const subcommand = parsed._[1];

  if (command === "health") {
    const client = new OphirPayClient({ baseUrl, apiKey });
    try {
      const res = await client.health();
      if (isJson) {
        console.log(JSON.stringify(res));
      } else {
        console.log(`[OK] OphirPay Health: ${res.status || "healthy"}`);
      }
      process.exit(0);
    } catch (err) {
      console.error(`[ERROR] Health check failed: ${err.message}`);
      process.exit(1);
    }
  }

  if (command === "webhook" && subcommand === "verify") {
    const secret = parsed.flags.secret;
    const signature = parsed.flags.signature;
    if (!secret || !signature) {
      console.error("[ERROR] Missing required flags: --secret and --signature");
      process.exit(1);
    }

    let body = parsed.flags.body;
    if (!body && parsed.flags.file) {
      try {
        body = readFileSync(resolve(process.cwd(), parsed.flags.file), "utf8");
      } catch (e) {
        console.error(`[ERROR] Failed to read body file: ${e.message}`);
        process.exit(1);
      }
    }

    if (!body) {
      console.error("[ERROR] Must provide --body or --file for webhook verification");
      process.exit(1);
    }

    const valid = verifyWebhookSignature({
      body,
      signature,
      secret,
      timestamp: parsed.flags.timestamp,
    });

    if (isJson) {
      console.log(JSON.stringify({ valid }));
    } else {
      console.log(valid ? "VALID" : "INVALID: Signature verification failed");
    }
    process.exit(valid ? 0 : 1);
  }

  const client = new OphirPayClient({ baseUrl, apiKey });

  if (command === "payment") {
    if (subcommand === "create") {
      const dest = parsed.flags.dest;
      const amount = Number(parsed.flags.amount);
      const source = parsed.flags.source || process.env.OPHIRPAY_SOURCE_ACCOUNT;

      if (!dest || !amount || !source) {
        console.error("[ERROR] Missing required parameters: --dest, --amount, --source");
        process.exit(1);
      }

      try {
        const payment = await client.createPayment({
          destAddress: dest,
          amount,
          sourceAccountId: source,
          assetCode: parsed.flags.asset || "XLM",
          memo: parsed.flags.memo,
          description: parsed.flags.desc,
        });

        if (isJson) {
          console.log(JSON.stringify(payment));
        } else {
          console.log(`[SUCCESS] Payment created: ID=${payment.id} Status=${payment.status}`);
        }
        process.exit(0);
      } catch (err) {
        console.error(`[ERROR] Payment creation failed: ${err.message}`);
        process.exit(1);
      }
    }

    if (subcommand === "get") {
      const id = parsed._[2];
      if (!id) {
        console.error("[ERROR] Missing payment ID: ophirpay payment get <id>");
        process.exit(1);
      }

      try {
        const payment = await client.getPayment(id);
        if (isJson) {
          console.log(JSON.stringify(payment));
        } else {
          console.log(`Payment ${payment.id}:`);
          console.log(`  Status:    ${payment.status}`);
          console.log(`  Amount:    ${payment.amount} ${payment.assetCode}`);
          console.log(`  Recipient: ${payment.destAddress}`);
          console.log(`  TxHash:    ${payment.txHash || "N/A"}`);
        }
        process.exit(0);
      } catch (err) {
        console.error(`[ERROR] Failed to get payment: ${err.message}`);
        process.exit(1);
      }
    }
  }

  if (command === "batch") {
    if (subcommand === "submit") {
      const filePath = parsed.flags.file;
      const name = parsed.flags.name || "CI Batch Run";
      const source = parsed.flags.source || process.env.OPHIRPAY_SOURCE_ACCOUNT;
      const failOnRejected = Boolean(parsed.flags["fail-on-rejected"]);

      if (!filePath || !source) {
        console.error("[ERROR] Missing required flags: --file and --source");
        process.exit(1);
      }

      let csvText = "";
      try {
        csvText = readFileSync(resolve(process.cwd(), filePath), "utf8");
      } catch (e) {
        console.error(`[ERROR] Could not read CSV file: ${e.message}`);
        process.exit(1);
      }

      try {
        const recipients = parseBatchCsv(csvText);
        const batch = await client.createBatch({
          name,
          sourceAccountId: source,
          description: parsed.flags.desc,
          recipients,
        });

        const hasRejected =
          batch.status === "FAILED" ||
          batch.status === "PARTIAL" ||
          (batch.payments && batch.payments.some(p => p.status === "FAILED" || p.status === "CANCELLED"));

        if (isJson) {
          console.log(JSON.stringify(batch));
        } else {
          console.log(`[SUCCESS] Batch submitted: ID=${batch.id}`);
          console.log(`  Status:     ${batch.status}`);
          console.log(`  Recipients: ${batch.totalRecipients}`);
          console.log(`  Total:      ${batch.totalAmount}`);
        }

        if (failOnRejected && hasRejected) {
          console.error(`::error::Batch ${batch.id} contained rejected or failed payments`);
          process.exit(1);
        }

        process.exit(0);
      } catch (err) {
        console.error(`[ERROR] Batch submission failed: ${err.message}`);
        if (failOnRejected) {
          console.error(`::error::CI Payment Job failed: ${err.message}`);
        }
        process.exit(1);
      }
    }

    if (subcommand === "get") {
      const id = parsed._[2];
      if (!id) {
        console.error("[ERROR] Missing batch ID: ophirpay batch get <id>");
        process.exit(1);
      }

      try {
        const batch = await client.getBatch(id);
        if (isJson) {
          console.log(JSON.stringify(batch));
        } else {
          console.log(`Batch ${batch.id}:`);
          console.log(`  Name:       ${batch.name}`);
          console.log(`  Status:     ${batch.status}`);
          console.log(`  Recipients: ${batch.totalRecipients}`);
          console.log(`  Total:      ${batch.totalAmount}`);
        }
        process.exit(0);
      } catch (err) {
        console.error(`[ERROR] Failed to get batch: ${err.message}`);
        process.exit(1);
      }
    }
  }

  if (command === "status") {
    const id = parsed._[1];
    if (!id) {
      console.error("[ERROR] Missing ID: ophirpay status <id>");
      process.exit(1);
    }

    try {
      if (parsed.flags.type === "batch" || id.startsWith("b_")) {
        const batch = await client.getBatch(id);
        console.log(isJson ? JSON.stringify(batch) : `Batch ${id} Status: ${batch.status}`);
      } else {
        const payment = await client.getPayment(id);
        console.log(isJson ? JSON.stringify(payment) : `Payment ${id} Status: ${payment.status}`);
      }
      process.exit(0);
    } catch (err) {
      console.error(`[ERROR] Status lookup failed: ${err.message}`);
      process.exit(1);
    }
  }

  console.error(`[ERROR] Unknown command: ${command}`);
  printUsage();
  process.exit(1);
}

main().catch(err => {
  console.error(`[FATAL] ${err.message}`);
  process.exit(1);
});
