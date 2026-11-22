// SPDX-License-Identifier: MIT

/**
 * OphirPay Batch Payment Submission Example (TypeScript SDK / Fetch).
 *
 * Demonstrates how to submit an atomic batch payment request to the
 * OphirPay REST API (POST /api/batches) using standard Fetch and TypeScript types.
 *
 * Usage:
 *   npx tsx docs/examples/create-batch.ts
 *
 * Environment variables:
 *   OPHIRPAY_API_URL - Base URL (default: http://localhost:3000)
 *   OPHIRPAY_API_KEY - Secret API key with 'batches:create' scope
 */

export interface BatchRecipient {
  address: string;
  amount: number;
  assetCode?: string;
  memo?: string;
  memoType?: "text" | "id" | "hash" | "return";
}

export interface CreateBatchRequest {
  name: string;
  description?: string;
  sourceAccountId: string;
  recipients: BatchRecipient[];
  idempotencyKey?: string;
}

export interface BatchPaymentItem {
  id: string;
  batchId: string;
  userId: string;
  amount: number;
  assetCode: string;
  memo: string;
  status: "CREATED" | "PENDING" | "SUBMITTED" | "SUCCESS" | "FAILED";
  createdAt: string;
  updatedAt: string;
}

export interface BatchRecord {
  id: string;
  name: string;
  description?: string | null;
  status: "PENDING" | "PROCESSING" | "COMPLETED" | "PARTIAL" | "FAILED" | "CANCELLED";
  userId: string;
  idempotencyKey?: string | null;
  createdAt: string;
  updatedAt: string;
  payments: BatchPaymentItem[];
}

export interface ApiResponse<T> {
  success: boolean;
  data: T;
  meta?: {
    timestamp?: string;
    deduplicated?: boolean;
    [key: string]: unknown;
  };
}

export interface CreateBatchOptions {
  apiUrl?: string;
  apiKey?: string;
  idempotencyKey?: string;
}

/**
 * Submits a new batch payment request to the OphirPay API.
 */
export async function createBatch(
  payload: CreateBatchRequest,
  options: CreateBatchOptions = {}
): Promise<ApiResponse<BatchRecord>> {
  const apiUrl = (options.apiUrl || process.env.OPHIRPAY_API_URL || "http://localhost:3000").replace(/\/+$/, "");
  const apiKey = options.apiKey || process.env.OPHIRPAY_API_KEY || "ophir_live_demo_test_key_0123456789";
  const idempotencyKey =
    options.idempotencyKey ||
    payload.idempotencyKey ||
    `idem_batch_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

  const response = await fetch(`${apiUrl}/api/batches`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      "Idempotency-Key": idempotencyKey,
    },
    body: JSON.stringify(payload),
  });

  const body = await response.json();

  if (!response.ok) {
    const errorDetails = JSON.stringify(body, null, 2);
    throw new Error(`OphirPay Batch API Error (${response.status} ${response.statusText}):\n${errorDetails}`);
  }

  return body as ApiResponse<BatchRecord>;
}

// Runnable example
async function main() {
  const sampleBatch: CreateBatchRequest = {
    name: "Contributor Rewards - March 2026",
    description: "Monthly developer compensation and grant disbursement",
    sourceAccountId: "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
    recipients: [
      {
        address: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
        amount: 250.50,
        assetCode: "XLM",
        memo: "Dev reward #101",
        memoType: "text",
      },
      {
        address: "GCGNWKCJ3KHRLPM3TMVCUIYKAQUTVCC52UKNO5ZXOSIWBZMLGLBKIA21",
        amount: 175.00,
        assetCode: "USDC",
        memo: "Grant payout #42",
        memoType: "text",
      },
    ],
  };

  console.log("Submitting sample batch payment...");
  try {
    const result = await createBatch(sampleBatch);
    console.log("Batch submitted successfully!");
    console.log("Batch ID:", result.data.id);
    console.log("Status:", result.data.status);
    console.log("Number of payments:", result.data.payments.length);
    console.log("Response JSON:", JSON.stringify(result, null, 2));
  } catch (err) {
    console.error("Error creating batch:", (err as Error).message);
  }
}

if (process.env.NODE_ENV !== "test" && typeof require !== "undefined" && require.main === module) {
  main().catch(console.error);
}
