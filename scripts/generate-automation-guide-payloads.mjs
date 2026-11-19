// SPDX-License-Identifier: MIT
// One-shot generator for the signed example payloads in
// docs/AUTOMATION_PLATFORMS.md (issue #817). Not shipped — run ad hoc:
//   node scripts/generate-automation-guide-payloads.mjs
//
// Signs each example with the documentation secret so the guide's payloads
// are byte-correct, and emits one JSON file per event under examples/automation-payloads/.
import { createHmac } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const SECRET = "test-secret-0123456789";
const OUT_DIR = join(fileURLToPath(new URL(".", import.meta.url)), "..", "examples", "automation-payloads");

/** Sign exactly like `buildSignedPayload` (src/lib/webhook-deliver.ts). */
function signedEnvelope(event, timestamp, data) {
  const canonical = JSON.stringify({ event, timestamp, data, signature: "" });
  const signature = createHmac("sha256", SECRET)
    .update(`${timestamp}.${canonical}`)
    .digest("hex");
  return { event, timestamp, data, signature };
}

// One realistic payload per lifecycle stage. Field names mirror what
// dispatchWebhookEventAsync actually sends (see src/app/api/payments/[id]/route.ts).
const examples = [
  ["payment.created", "2026-09-01T10:00:00.000Z", {
    paymentId: "p_9f2c81ab34d74e0f",
    amount: "25.50",
    assetCode: "USDC",
    status: "CREATED",
    createdAt: "2026-09-01T10:00:00.000Z",
  }],
  ["payment.signed", "2026-09-01T10:00:04.000Z", {
    paymentId: "p_9f2c81ab34d74e0f",
    amount: "25.50",
    assetCode: "USDC",
    status: "SIGNED",
    signedAt: "2026-09-01T10:00:04.000Z",
  }],
  ["payment.submitted", "2026-09-01T10:00:06.000Z", {
    paymentId: "p_9f2c81ab34d74e0f",
    amount: "25.50",
    assetCode: "USDC",
    transactionHash: "a1b2c3d4e5f60718293a4b5c6d7e8f90112233445566778899aabbccddeeff00",
    submittedAt: "2026-09-01T10:00:06.000Z",
  }],
  ["payment.confirmed", "2026-09-01T10:00:11.000Z", {
    paymentId: "p_9f2c81ab34d74e0f",
    amount: "25.50",
    assetCode: "USDC",
    transactionHash: "a1b2c3d4e5f60718293a4b5c6d7e8f90112233445566778899aabbccddeeff00",
    confirmedAt: "2026-09-01T10:00:11.000Z",
  }],
  ["payment.completed", "2026-09-01T10:00:12.000Z", {
    paymentId: "p_9f2c81ab34d74e0f",
    amount: "25.50",
    assetCode: "USDC",
    transactionHash: "a1b2c3d4e5f60718293a4b5c6d7e8f90112233445566778899aabbccddeeff00",
    completedAt: "2026-09-01T10:00:12.000Z",
  }],
  ["payment.failed", "2026-09-01T10:00:09.000Z", {
    paymentId: "p_9f2c81ab34d74e0f",
    amount: "25.50",
    assetCode: "USDC",
    errorMessage: "Transaction simulation failed: insufficient trustline for USDC",
    failedAt: "2026-09-01T10:00:09.000Z",
  }],
  ["batch.created", "2026-09-01T09:30:00.000Z", {
    batchId: "b_71c0aa9e55d2",
    itemCount: 25,
    totalAmount: "612.25",
    assetCode: "USDC",
    status: "PROCESSING",
    createdAt: "2026-09-01T09:30:00.000Z",
  }],
  ["batch.completed", "2026-09-01T09:31:44.000Z", {
    batchId: "b_71c0aa9e55d2",
    itemCount: 25,
    succeeded: 24,
    failed: 1,
    totalAmount: "612.25",
    assetCode: "USDC",
    status: "COMPLETED",
    completedAt: "2026-09-01T09:31:44.000Z",
  }],
  ["batch.failed", "2026-09-01T09:31:02.000Z", {
    batchId: "b_71c0aa9e55d2",
    itemCount: 25,
    succeeded: 3,
    failed: 22,
    assetCode: "USDC",
    errorMessage: "Batch aborted: 88% of items failed validation",
    failedAt: "2026-09-01T09:31:02.000Z",
  }],
  ["recurrence.triggered", "2026-09-01T08:00:00.000Z", {
    recurrenceId: "r_5d31ee77b2c9",
    paymentId: "p_7a11cc02f9e8",
    amount: "10.00",
    assetCode: "XLM",
    interval: "monthly",
    triggeredAt: "2026-09-01T08:00:00.000Z",
  }],
  ["recurrence.completed", "2026-09-01T08:00:14.000Z", {
    recurrenceId: "r_5d31ee77b2c9",
    paymentId: "p_7a11cc02f9e8",
    amount: "10.00",
    assetCode: "XLM",
    transactionHash: "b2c3d4e5f60718293a4b5c6d7e8f90112233445566778899aabbccddeeff0011",
    completedAt: "2026-09-01T08:00:14.000Z",
  }],
  ["recurrence.failed", "2026-09-01T08:00:07.000Z", {
    recurrenceId: "r_5d31ee77b2c9",
    paymentId: "p_7a11cc02f9e8",
    amount: "10.00",
    assetCode: "XLM",
    errorMessage: "Source account balance below scheduled amount",
    failedAt: "2026-09-01T08:00:07.000Z",
  }],
  ["request.created", "2026-09-01T12:00:00.000Z", {
    requestId: "q_2b7d9c4f11aa",
    amount: "100.00",
    assetCode: "USDC",
    description: "Invoice #402 — September retainer",
    status: "PENDING",
    createdAt: "2026-09-01T12:00:00.000Z",
  }],
  ["request.paid", "2026-09-02T09:15:32.000Z", {
    requestId: "q_2b7d9c4f11aa",
    amount: "100.00",
    assetCode: "USDC",
    paymentId: "p_44e0b8ac91d3",
    transactionHash: "c3d4e5f60718293a4b5c6d7e8f90112233445566778899aabbccddeeff001122",
    paidAt: "2026-09-02T09:15:32.000Z",
  }],
  ["request.expired", "2026-09-08T12:00:00.000Z", {
    requestId: "q_2b7d9c4f11aa",
    amount: "100.00",
    assetCode: "USDC",
    description: "Invoice #402 — September retainer",
    status: "EXPIRED",
    expiredAt: "2026-09-08T12:00:00.000Z",
  }],
];

mkdirSync(OUT_DIR, { recursive: true });
for (const [event, timestamp, data] of examples) {
  const envelope = signedEnvelope(event, timestamp, data);
  writeFileSync(join(OUT_DIR, `${event}.json`), JSON.stringify(envelope, null, 2) + "\n");
  console.log(`${event}: ${envelope.signature}`);
}
console.log(`\nWrote ${examples.length} payloads to ${OUT_DIR}`);
