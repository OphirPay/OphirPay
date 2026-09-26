// SPDX-License-Identifier: MIT

/**
 * Options for configuring the OphirPay client.
 */
export interface ClientOptions {
  /**
   * Base URL of the OphirPay API server.
   * Defaults to process.env.OPHIRPAY_BASE_URL or "https://api.ophirpay.com" (or "http://localhost:3000" in dev).
   */
  baseUrl?: string;

  /**
   * API Key for authenticating with OphirPay.
   * Can also be passed via the OPHIRPAY_API_KEY environment variable.
   */
  apiKey?: string;

  /**
   * Custom fetch implementation (defaults to global fetch).
   */
  fetch?: typeof fetch;

  /**
   * Request timeout in milliseconds (default: 30000).
   */
  timeoutMs?: number;
}

/**
 * Core payment entity in OphirPay.
 */
export interface Payment {
  id: string;
  amount: number;
  assetCode: string;
  assetIssuer?: string | null;
  destAddress: string;
  sourceAccountId: string;
  status: "CREATED" | "PENDING" | "COMPLETED" | "FAILED" | "CANCELLED";
  description?: string | null;
  memo?: string | null;
  txHash?: string | null;
  createdAt?: string;
  updatedAt?: string;
  errorMessage?: string | null;
}

/**
 * Request payload for creating a single payment.
 */
export interface CreatePaymentRequest {
  /**
   * Payment amount in decimal units (e.g. 10.5 for 10.5 XLM).
   */
  amount: number;

  /**
   * Destination Stellar address (56 characters starting with 'G').
   */
  destAddress: string;

  /**
   * Source Stellar account ID initiating the payment.
   */
  sourceAccountId: string;

  /**
   * Asset code (defaults to "XLM").
   */
  assetCode?: string;

  /**
   * Stellar asset issuer account (for custom non-XLM assets).
   */
  assetIssuer?: string;

  /**
   * Human-readable description (max 200 characters).
   */
  description?: string;

  /**
   * Optional transaction memo (max 28 characters).
   */
  memo?: string;
}

/**
 * API response envelope for payment requests.
 */
export interface PaymentResponse {
  success: boolean;
  data: Payment;
  meta?: Record<string, unknown>;
}

/**
 * Paginated list of payments.
 */
export interface PaginatedPayments {
  success: boolean;
  data: Payment[];
  meta?: {
    page?: number;
    limit?: number;
    total?: number;
    nextCursor?: string | null;
    hasMore?: boolean;
    timestamp?: string;
  };
}

/**
 * Recipient entry within a batch payout.
 */
export interface BatchRecipient {
  address: string;
  amount: number;
  assetCode?: string;
  memo?: string;
}

/**
 * Request payload for creating a batch payout.
 */
export interface CreateBatchRequest {
  /**
   * Human-readable label for the batch (e.g. "Monthly Payroll - Sep 2026").
   */
  name: string;

  /**
   * Optional description.
   */
  description?: string;

  /**
   * Source Stellar account funding the batch.
   */
  sourceAccountId: string;

  /**
   * List of recipient disbursements (1 to 100 entries).
   */
  recipients: BatchRecipient[];

  /**
   * Optional idempotency key to prevent double submissions.
   */
  idempotencyKey?: string;
}

/**
 * Progress indicator for a batch payout.
 */
export interface BatchProgress {
  total: number;
  sent: number;
  pending: number;
  failed: number;
  percentage: number;
}

/**
 * Child item summary in a batch payment.
 */
export interface BatchItem {
  id: string;
  amount: number;
  assetCode: string;
  status: "pending" | "sent" | "failed";
  memo?: string;
  errorMessage?: string;
}

/**
 * Batch payment record.
 */
export interface BatchDetails {
  id: string;
  userId?: string;
  name: string;
  description?: string | null;
  status: string;
  createdAt: string;
  updatedAt?: string;
  items?: BatchItem[];
  progress?: BatchProgress;
  payments?: Payment[];
}

/**
 * API response envelope for batch requests.
 */
export interface BatchResponse {
  success: boolean;
  data: BatchDetails;
  meta?: {
    deduplicated?: boolean;
    resumed?: boolean;
    timestamp?: string;
    total?: number;
  };
}

/**
 * Filter parameters for listing payments.
 */
export interface ListPaymentsParams {
  limit?: number;
  cursor?: string;
  page?: number;
  status?: "CREATED" | "PENDING" | "COMPLETED" | "FAILED" | "CANCELLED";
  search?: string;
}

/**
 * Standard health check response.
 */
export interface HealthResponse {
  status: string;
  version?: string;
  timestamp?: string;
  database?: string;
  rpc?: string;
  [key: string]: unknown;
}

/**
 * Incoming webhook payload.
 */
export interface WebhookPayload {
  event: string;
  timestamp: string;
  data: Record<string, unknown>;
  signature?: string;
  test?: boolean;
}

/**
 * Webhook signature verification result.
 */
export interface WebhookVerificationResult {
  valid: boolean;
  reason?: string;
}

/**
 * Standard OphirPay API error response shape.
 */
export interface ApiErrorResponse {
  success: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}
