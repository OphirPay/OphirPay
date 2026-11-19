#!/usr/bin/env node
// SPDX-License-Identifier: MIT
//
// OphirPay CLI — the first-party client for CI and scheduled jobs (issue #822).
//
//   ophirpay payment:create --to G... --amount 25 [--asset XLM] [--memo hi]
//   ophirpay status --id <paymentId>
//   ophirpay batch:submit --file recipients.csv [--name payroll]
//   ophirpay webhook:verify --secret S --body-file body.json \
//                           --signature <hex> --timestamp <unix>
//
// Configuration comes from the environment:
//   OPHIRPAY_BASE_URL   API origin (default http://localhost:3000)
//   OPHIRPAY_API_KEY    API key (Bearer)
//
// Exit code is non-zero when a payment is rejected, so a CI job fails loudly
// instead of silently dropping a payout.

import { readFileSync } from "node:fs";
import { OphirPayClient, OphirPayError, verifyWebhookSignature } from "../packages/ophirpay-client/index.js";

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) {
        args[key] = true;
      } else {
        args[key] = next;
        i += 1;
      }
    } else {
      args._.push(arg);
    }
  }
  return args;
}

/** Minimal CSV reader: header row + `address,amount[,memo]` records. */
export function parseBatchCsv(text) {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l !== "" && !l.startsWith("#"));
  if (lines.length === 0) return [];

  const header = lines[0].toLowerCase().split(",").map((h) => h.trim());
  const hasHeader = header.includes("address") || header.includes("destination");
  const rows = hasHeader ? lines.slice(1) : lines;

  const addrIdx = hasHeader
    ? Math.max(header.indexOf("address"), header.indexOf("destination"))
    : 0;
  const amountIdx = hasHeader ? header.indexOf("amount") : 1;
  const memoIdx = hasHeader ? header.indexOf("memo") : 2;

  return rows.map((row) => {
    const cells = row.split(",").map((c) => c.trim());
    return {
      address: cells[addrIdx] ?? "",
      amount: Number(cells[amountIdx] ?? "0"),
      ...(memoIdx >= 0 && cells[memoIdx] ? { memo: cells[memoIdx] } : {}),
    };
  });
}

function requireArg(args, key, usage) {
  const value = args[key];
  if (value === undefined || value === true) {
    console.error(`Missing --${key}. Usage: ${usage}`);
    process.exit(2);
  }
  return value;
}

async function paymentCreate(args, client) {
  const usage = "ophirpay payment:create --to <address> --amount <n> [--asset CODE] [--issuer G...] [--memo text]";
  const to = requireArg(args, "to", usage);
  const amount = Number(requireArg(args, "amount", usage));
  if (!Number.isFinite(amount) || amount <= 0) {
    console.error("--amount must be a positive number");
    process.exit(2);
  }

  const payment = await client.createPayment({
    recipient: to,
    destAddress: to,
    amount,
    assetCode: typeof args.asset === "string" ? args.asset : "XLM",
    ...(typeof args.issuer === "string" ? { assetIssuer: args.issuer } : {}),
    ...(typeof args.memo === "string" ? { memo: args.memo } : {}),
    ...(typeof args.description === "string" ? { description: args.description } : {}),
  });

  console.log(`✅ payment created: ${payment.id} (status ${payment.status})`);
  return payment;
}

async function status(args, client) {
  const id = requireArg(args, "id", "ophirpay status --id <paymentId>");
  const payment = await client.getPayment(id);
  console.log(JSON.stringify(payment, null, 2));
  return payment;
}

async function batchSubmit(args, client) {
  const file = requireArg(
    args,
    "file",
    "ophirpay batch:submit --file <recipients.csv> [--name label]"
  );
  const recipients = parseBatchCsv(readFileSync(file, "utf8")).filter(
    (r) => r.address && Number.isFinite(r.amount) && r.amount > 0
  );

  if (recipients.length === 0) {
    console.error("No valid recipients found in the CSV (expected address,amount[,memo]).");
    process.exit(1);
  }

  const batch = await client.createBatch(
    {
      ...(typeof args.name === "string" ? { name: args.name } : {}),
      recipients,
    },
    // Deterministic per-invocation key keeps a retried CI job idempotent.
    { idempotencyKey: `cli-${file}-${recipients.length}-${Date.now()}` }
  );

  const rejected = (batch.payments ?? []).filter((p) =>
    ["FAILED", "CANCELLED"].includes(p.status)
  );
  console.log(
    `✅ batch ${batch.id}: ${batch.payments?.length ?? recipients.length} payments, ${rejected.length} rejected`
  );

  if (rejected.length > 0) {
    for (const p of rejected) {
      console.error(`::error::payment ${p.id} (${p.status}) was rejected`);
    }
    // Fail the job — a CI payout must not silently drop recipients.
    process.exit(1);
  }
  return batch;
}

function webhookVerify(args) {
  const usage =
    "ophirpay webhook:verify --secret S --body-file body.json --signature <hex> --timestamp <unix>";
  const secret = requireArg(args, "secret", usage);
  const signature = requireArg(args, "signature", usage);
  const timestamp = requireArg(args, "timestamp", usage);
  const bodyFile = requireArg(args, "body-file", usage);
  const rawBody = readFileSync(bodyFile, "utf8");

  const valid = verifyWebhookSignature({ rawBody, signature, timestamp, secret });
  if (!valid) {
    console.error("❌ webhook signature INVALID");
    process.exit(1);
  }
  console.log("✅ webhook signature valid");
}

const COMMANDS = {
  "payment:create": paymentCreate,
  status,
  "batch:submit": batchSubmit,
  "webhook:verify": (args) => webhookVerify(args),
};

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const args = parseArgs(rest);

  if (!command || command === "--help" || command === "help") {
    console.log(
      [
        "ophirpay — OphirPay API CLI",
        "",
        "Commands:",
        "  payment:create --to <address> --amount <n> [--asset CODE] [--memo text]",
        "  status --id <paymentId>",
        "  batch:submit --file <recipients.csv> [--name label]",
        "  webhook:verify --secret S --body-file <f> --signature <hex> --timestamp <unix>",
        "",
        "Environment: OPHIRPAY_BASE_URL, OPHIRPAY_API_KEY",
      ].join("\n")
    );
    return;
  }

  const handler = COMMANDS[command];
  if (!handler) {
    console.error(`Unknown command: ${command}`);
    process.exit(2);
  }

  const client = new OphirPayClient();
  try {
    await handler(args, client);
  } catch (err) {
    if (err instanceof OphirPayError) {
      console.error(`::error::${err.code ? `[${err.code}] ` : ""}${err.message}`);
    } else {
      console.error(`::error::${err instanceof Error ? err.message : String(err)}`);
    }
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  main();
}
