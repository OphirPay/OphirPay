// SPDX-License-Identifier: MIT

import type {
  ClientOptions,
  CreateBatchRequest,
  CreatePaymentRequest,
  BatchDetails,
  BatchRecipient,
  BatchResponse,
  HealthResponse,
  ListPaymentsParams,
  PaginatedPayments,
  Payment,
  PaymentResponse,
  WebhookVerificationResult,
} from "./types.js";
import { parsePaymentCsv } from "./csv.js";
import { verifyWebhookSignature } from "./webhooks.js";

/**
 * Standard typed error thrown on non-2xx responses from the OphirPay API.
 */
export class OphirPayApiError extends Error {
  public readonly statusCode: number;
  public readonly errorCode?: string;
  public readonly details?: unknown;
  public readonly rawBody?: unknown;

  constructor(message: string, statusCode: number, errorCode?: string, details?: unknown, rawBody?: unknown) {
    super(message);
    this.name = "OphirPayApiError";
    this.statusCode = statusCode;
    this.errorCode = errorCode;
    this.details = details;
    this.rawBody = rawBody;
  }
}

/**
 * Primary client for interacting with the OphirPay API.
 */
export class OphirPayClient {
  public readonly baseUrl: string;
  private readonly apiKey?: string;
  private readonly customFetch: typeof fetch;
  private readonly timeoutMs: number;

  constructor(options: ClientOptions = {}) {
    let base = options.baseUrl || (typeof process !== "undefined" ? process.env?.OPHIRPAY_BASE_URL : undefined);
    if (!base) {
      base = "https://api.ophirpay.com";
    }
    // Remove trailing slash
    this.baseUrl = base.replace(/\/+$/, "");

    this.apiKey = options.apiKey || (typeof process !== "undefined" ? process.env?.OPHIRPAY_API_KEY : undefined);
    this.customFetch = options.fetch || globalThis.fetch;
    this.timeoutMs = options.timeoutMs ?? 30000;
  }

  /**
   * Internal HTTP request helper.
   */
  private async request<T>(
    path: string,
    init: RequestInit & { idempotencyKey?: string } = {}
  ): Promise<T> {
    const url = `${this.baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
    const headers = new Headers(init.headers || {});

    headers.set("Accept", "application/json");

    if (this.apiKey) {
      headers.set("Authorization", `Bearer ${this.apiKey}`);
      headers.set("X-API-Key", this.apiKey);
    }

    if (init.idempotencyKey) {
      headers.set("Idempotency-Key", init.idempotencyKey);
    }

    if (init.body && typeof init.body === "string" && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    let response: Response;
    try {
      response = await this.customFetch(url, {
        ...init,
        headers,
        signal: controller.signal,
      });
    } catch (err: unknown) {
      clearTimeout(timeout);
      if (err instanceof Error && err.name === "AbortError") {
        throw new OphirPayApiError(`Request timed out after ${this.timeoutMs}ms`, 408);
      }
      throw err;
    } finally {
      clearTimeout(timeout);
    }

    const contentType = response.headers.get("content-type") || "";
    let data: unknown = null;

    if (contentType.includes("application/json")) {
      data = await response.json();
    } else {
      const text = await response.text();
      data = text ? { message: text } : null;
    }

    if (!response.ok) {
      const errObj = (data && typeof data === "object" && "error" in data) ? (data as { error: unknown }).error : data;
      let message = `API request failed with HTTP ${response.status}`;
      let code: string | undefined;
      let details: unknown = undefined;

      if (errObj && typeof errObj === "object") {
        if ("message" in errObj && typeof (errObj as { message: unknown }).message === "string") {
          message = (errObj as { message: string }).message;
        }
        if ("code" in errObj && typeof (errObj as { code: unknown }).code === "string") {
          code = (errObj as { code: string }).code;
        }
        if ("details" in errObj) {
          details = (errObj as { details: unknown }).details;
        }
      }

      throw new OphirPayApiError(message, response.status, code, details, data);
    }

    return data as T;
  }

  /**
   * Payment operations.
   */
  public readonly payments = {
    /**
     * Create an individual payment.
     */
    create: async (params: CreatePaymentRequest): Promise<Payment> => {
      const resp = await this.request<PaymentResponse>("/api/payments", {
        method: "POST",
        body: JSON.stringify(params),
      });
      return resp.data;
    },

    /**
     * Retrieve status and details of a payment by ID.
     */
    get: async (id: string): Promise<Payment> => {
      const resp = await this.request<PaymentResponse>(`/api/payments/${encodeURIComponent(id)}`, {
        method: "GET",
      });
      return resp.data;
    },

    /**
     * List user payments with optional filters.
     */
    list: async (params: ListPaymentsParams = {}): Promise<PaginatedPayments> => {
      const searchParams = new URLSearchParams();
      if (params.limit) searchParams.set("limit", String(params.limit));
      if (params.cursor) searchParams.set("cursor", params.cursor);
      if (params.page) searchParams.set("page", String(params.page));
      if (params.status) searchParams.set("status", params.status);
      if (params.search) searchParams.set("search", params.search);

      const qs = searchParams.toString();
      return this.request<PaginatedPayments>(`/api/payments${qs ? `?${qs}` : ""}`, {
        method: "GET",
      });
    },
  };

  /**
   * Batch payment operations.
   */
  public readonly batches = {
    /**
     * Create a batch payment with multiple recipients.
     */
    create: async (params: CreateBatchRequest, idempotencyKey?: string): Promise<BatchDetails> => {
      const key = idempotencyKey || params.idempotencyKey;
      const resp = await this.request<BatchResponse>("/api/batches", {
        method: "POST",
        body: JSON.stringify(params),
        idempotencyKey: key,
      });
      return resp.data;
    },

    /**
     * Retrieve batch details and per-item progress.
     */
    get: async (id: string): Promise<BatchDetails> => {
      const resp = await this.request<BatchResponse>(`/api/batches/${encodeURIComponent(id)}`, {
        method: "GET",
      });
      return resp.data;
    },

    /**
     * Parse CSV text into validated batch recipients.
     */
    parseCsv: (csvContent: string): BatchRecipient[] => {
      return parsePaymentCsv(csvContent);
    },

    /**
     * Helper to parse CSV content and immediately submit the batch payout.
     */
    createFromCsv: async (
      csvContent: string,
      meta: {
        name: string;
        sourceAccountId: string;
        description?: string;
        idempotencyKey?: string;
      }
    ): Promise<BatchDetails> => {
      const recipients = parsePaymentCsv(csvContent);
      return this.batches.create(
        {
          name: meta.name,
          sourceAccountId: meta.sourceAccountId,
          description: meta.description,
          recipients,
          idempotencyKey: meta.idempotencyKey,
        },
        meta.idempotencyKey
      );
    },
  };

  /**
   * Webhook verification utilities.
   */
  public readonly webhooks = {
    /**
     * Verify the HMAC-SHA256 signature on an incoming OphirPay webhook delivery.
     */
    verifySignature: (
      rawBody: string | Record<string, unknown>,
      signature: string,
      secret: string,
      options?: { maxClockDriftSeconds?: number }
    ): WebhookVerificationResult => {
      return verifyWebhookSignature(rawBody, signature, secret, options);
    },
  };

  /**
   * System & operational endpoints.
   */
  public readonly system = {
    /**
     * Check API server health.
     */
    health: async (): Promise<HealthResponse> => {
      return this.request<HealthResponse>("/api/health", {
        method: "GET",
      });
    },
  };
}
