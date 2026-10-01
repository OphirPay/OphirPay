// SPDX-License-Identifier: MIT

/**
 * Type declarations for @ophirpay/client.
 *
 * The operation catalogue is generated from `docs/openapi.yaml`
 * (`operations.generated.d.ts`); the request/response shapes below mirror the
 * component schemas documented there.
 */

import type { ApiOperation, ApiOperationName } from "./operations.generated.d.ts";

export type { ApiOperation, ApiOperationName };

export type PaymentStatus =
  | "CREATED"
  | "PENDING"
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED";

export interface Payment {
  id: string;
  amount: number;
  assetCode: string;
  assetIssuer: string | null;
  description: string | null;
  memo: string | null;
  status: PaymentStatus;
  transactionHash: string | null;
  idempotencyKey: string | null;
}

export interface CreatePaymentInput {
  amount: number;
  assetCode?: string;
  assetIssuer?: string;
  destAddress?: string;
  recipient?: string;
  description?: string;
  memo?: string;
}

export interface BatchRecipient {
  address: string;
  amount: number;
  memo?: string;
}

export interface CreateBatchInput {
  name?: string;
  description?: string;
  recipients: BatchRecipient[];
}

export interface Batch {
  id: string;
  name?: string | null;
  status?: string;
  payments?: Payment[];
}

export interface Paginated<T> {
  records: T[];
  meta?: Record<string, unknown>;
}

export class OphirPayError extends Error {
  status: number | null;
  code: string | null;
  details: unknown;
}

export interface OphirPayClientOptions {
  /** API origin; defaults to `OPHIRPAY_BASE_URL` or http://localhost:3000. */
  baseUrl?: string;
  /** API key; defaults to `OPHIRPAY_API_KEY`. */
  apiKey?: string;
  /** Per-request timeout in milliseconds (default 30000). */
  timeoutMs?: number;
  /** Injectable fetch (tests). */
  fetchImpl?: typeof fetch;
  /** Extra headers applied to every request. */
  headers?: Record<string, string>;
}

export class OphirPayClient {
  constructor(options?: OphirPayClientOptions);
  baseUrl: string;
  apiKey?: string;
  timeoutMs: number;
  /** Resolve an operation from the generated OpenAPI catalogue. */
  operation(name: ApiOperationName): ApiOperation;
  /** Raw request, unwrapping the `{ success, data }` envelope. */
  request<T = unknown>(
    method: string,
    path: string,
    options?: {
      pathParams?: Record<string, string | number>;
      query?: Record<string, string | number | boolean | undefined | null>;
      body?: unknown;
      headers?: Record<string, string>;
      idempotencyKey?: string;
    }
  ): Promise<T>;

  createPayment(input: CreatePaymentInput, options?: { idempotencyKey?: string }): Promise<Payment>;
  listPayments(query?: Record<string, string | number | boolean>): Promise<Paginated<Payment>>;
  getPayment(id: string): Promise<Payment>;
  createBatch(input: CreateBatchInput, options?: { idempotencyKey?: string }): Promise<Batch>;
  getBatch(id: string): Promise<Batch>;
  getStats(): Promise<Record<string, unknown>>;
}

export interface VerifyWebhookParams {
  rawBody: string;
  signature: string;
  timestamp: string;
  secret: string;
  toleranceSeconds?: number;
  now?: number;
}

export function verifyWebhookSignature(params: VerifyWebhookParams): boolean;
export function canonicalizeWebhookBody(rawBody: string | Record<string, unknown>): string;
export function webhookSignedInput(timestamp: string, canonicalBody: string): string;

export const DEFAULT_TIMEOUT_MS: number;
export const DEFAULT_SIGNATURE_TOLERANCE_SECONDS: number;
