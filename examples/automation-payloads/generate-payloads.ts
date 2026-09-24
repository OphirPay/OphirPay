// SPDX-License-Identifier: MIT
/**
 * Generates sample webhook payloads for every lifecycle stage of an OphirPay payment.
 * Used by documentation and automation platforms (n8n, Zapier, Make).
 */

import fs from "node:fs";
import path from "node:path";

export interface LifecyclePayload {
  event: string;
  timestamp: string;
  idempotency_key: string;
  data: {
    id: string;
    amount: number;
    asset: string;
    sender: string;
    recipient: string;
    status: string;
    memo?: string;
    tx_hash?: string;
    error_code?: string;
    error_message?: string;
  };
  signature: string;
}

export const LIFECYCLE_PAYLOADS: Record<string, LifecyclePayload> = {
  created: {
    event: "payment.created",
    timestamp: "2026-09-24T10:00:00Z",
    idempotency_key: "idem_pay_8f29d102",
    data: {
      id: "pay_01HF9A7BC001",
      amount: 100.0,
      asset: "USDC",
      sender: "GBEXAMPLE...SENDER1",
      recipient: "GCRECEIVER...ORG2",
      status: "pending_signature",
      memo: "Invoice #1042",
    },
    signature: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  },
  signed: {
    event: "payment.signed",
    timestamp: "2026-09-24T10:01:15Z",
    idempotency_key: "idem_pay_8f29d102",
    data: {
      id: "pay_01HF9A7BC001",
      amount: 100.0,
      asset: "USDC",
      sender: "GBEXAMPLE...SENDER1",
      recipient: "GCRECEIVER...ORG2",
      status: "signed",
      memo: "Invoice #1042",
    },
    signature: "a1b2c3d4e5f67890123456789abcdef0123456789abcdef0123456789abcdef0",
  },
  submitted: {
    event: "payment.submitted",
    timestamp: "2026-09-24T10:01:20Z",
    idempotency_key: "idem_pay_8f29d102",
    data: {
      id: "pay_01HF9A7BC001",
      amount: 100.0,
      asset: "USDC",
      sender: "GBEXAMPLE...SENDER1",
      recipient: "GCRECEIVER...ORG2",
      status: "submitted",
      tx_hash: "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
      memo: "Invoice #1042",
    },
    signature: "7c98b6b19a3b8d1d8a4f9b2c3e4d5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f",
  },
  confirmed: {
    event: "payment.confirmed",
    timestamp: "2026-09-24T10:01:25Z",
    idempotency_key: "idem_pay_8f29d102",
    data: {
      id: "pay_01HF9A7BC001",
      amount: 100.0,
      asset: "USDC",
      sender: "GBEXAMPLE...SENDER1",
      recipient: "GCRECEIVER...ORG2",
      status: "confirmed",
      tx_hash: "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
      memo: "Invoice #1042",
    },
    signature: "647945219590e65b3f903bdd28baeabdc5ce3915cc9a8a497bfcba9ed2802b64",
  },
  failed: {
    event: "payment.failed",
    timestamp: "2026-09-24T10:01:30Z",
    idempotency_key: "idem_pay_8f29d102",
    data: {
      id: "pay_01HF9A7BC001",
      amount: 100.0,
      asset: "USDC",
      sender: "GBEXAMPLE...SENDER1",
      recipient: "GCRECEIVER...ORG2",
      status: "failed",
      error_code: "INSUFFICIENT_BALANCE",
      error_message: "Sender account does not hold sufficient trustline balance",
      memo: "Invoice #1042",
    },
    signature: "f4b5e6d7c8b9a0123456789abcdef0123456789abcdef0123456789abcdef012",
  },
};

export function writePayloadFiles(outputDir: string) {
  fs.mkdirSync(outputDir, { recursive: true });
  for (const [stage, payload] of Object.entries(LIFECYCLE_PAYLOADS)) {
    const filePath = path.join(outputDir, `payment.${stage}.json`);
    fs.writeFileSync(filePath, JSON.stringify(payload, null, 2) + "\n");
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  writePayloadFiles(path.resolve(process.cwd(), "examples/automation-payloads"));
  console.log("Generated all lifecycle payload examples.");
}
