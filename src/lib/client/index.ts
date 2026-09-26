// SPDX-License-Identifier: MIT
import { createHmac, timingSafeEqual } from "node:crypto";

export interface ClientConfig {
  baseUrl?: string;
  apiKey: string;
  timeoutMs?: number;
}

export interface CreatePaymentRequest {
  amount: number;
  sourceAccountId: string;
  destAddress: string;
  assetCode?: string;
  assetIssuer?: string;
  description?: string;
  memo?: string;
}

export interface PaymentResponse {
  id: string;
  amount: number;
  assetCode: string;
  assetIssuer?: string | null;
  sourceAccountId: string;
  destAddress: string;
  status: "CREATED" | "PENDING" | "COMPLETED" | "FAILED" | "CANCELLED";
  description?: string | null;
  memo?: string | null;
  txHash?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface BatchRecipient {
  address: string;
  amount: number;
  assetCode?: string;
  memo?: string;
}

export interface CreateBatchRequest {
  name: string;
  sourceAccountId: string;
  description?: string;
  idempotencyKey?: string;
  recipients: BatchRecipient[];
}

export interface BatchChildPayment {
  id: string;
  destAddress: string;
  amount: number;
  assetCode: string;
  status: "CREATED" | "PENDING" | "COMPLETED" | "FAILED" | "CANCELLED";
  errorReason?: string | null;
}

export interface BatchResponse {
  id: string;
  name: string;
  description?: string | null;
  status: "CREATED" | "PENDING" | "PROCESSING" | "COMPLETED" | "PARTIAL" | "FAILED";
  sourceAccountId: string;
  totalRecipients: number;
  totalAmount: number;
  createdAt: string;
  payments?: BatchChildPayment[];
}

export interface WebhookVerifyOptions {
  body: string;
  signature: string;
  secret: string;
  timestamp?: string;
  maxAgeSeconds?: number;
  now?: Date;
}

export class OphirPayApiError extends Error {
  public readonly statusCode: number;
  public readonly data?: unknown;

  constructor(message: string, statusCode: number, data?: unknown) {
    super(message);
    this.name = "OphirPayApiError";
    this.statusCode = statusCode;
    this.data = data;
  }
}

export function parseBatchCsv(csvText: string): BatchRecipient[] {
  const lines = csvText.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (lines.length === 0) {
    throw new Error("CSV file is empty");
  }

  const recipients: BatchRecipient[] = [];
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

export function canonicalizeWebhookBody(body: string): string {
  const parsed = JSON.parse(body);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("Webhook body must be a JSON object");
  }
  return JSON.stringify({ ...parsed, signature: "" });
}

export function verifyWebhookSignature({
  body,
  signature,
  secret,
  timestamp,
  maxAgeSeconds = 300,
  now = new Date(),
}: WebhookVerifyOptions): boolean {
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

export class OphirPayClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly timeoutMs: number;

  constructor(config: ClientConfig) {
    if (!config.apiKey) {
      throw new Error("API key is required to initialize OphirPayClient");
    }
    this.baseUrl = (config.baseUrl || "http://localhost:3000").replace(/\/$/, "");
    this.apiKey = config.apiKey;
    this.timeoutMs = config.timeoutMs || 15000;
  }

  private async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const url = `${this.baseUrl}${endpoint.startsWith("/") ? "" : "/"}${endpoint}`;
    const headers = new Headers(options.headers);
    headers.set("Authorization", `Bearer ${this.apiKey}`);
    headers.set("Content-Type", "application/json");

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const res = await fetch(url, {
        ...options,
        headers,
        signal: controller.signal,
      });

      const responseData = await res.json().catch(() => null);

      if (!res.ok) {
        const errorMsg =
          responseData?.message ||
          responseData?.error ||
          `OphirPay API request failed with status ${res.status}`;
        throw new OphirPayApiError(errorMsg, res.status, responseData);
      }

      return (responseData?.data ?? responseData) as T;
    } finally {
      clearTimeout(timer);
    }
  }

  public async createPayment(data: CreatePaymentRequest): Promise<PaymentResponse> {
    return this.request<PaymentResponse>("/api/payments", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  public async getPayment(id: string): Promise<PaymentResponse> {
    return this.request<PaymentResponse>(`/api/payments/${encodeURIComponent(id)}`, {
      method: "GET",
    });
  }

  public async createBatch(data: CreateBatchRequest, idempotencyKey?: string): Promise<BatchResponse> {
    const headers: Record<string, string> = {};
    if (idempotencyKey) {
      headers["Idempotency-Key"] = idempotencyKey;
    }
    return this.request<BatchResponse>("/api/batches", {
      method: "POST",
      headers,
      body: JSON.stringify(data),
    });
  }

  public async createBatchFromCsv(
    csvText: string,
    metadata: { name: string; sourceAccountId: string; description?: string },
    idempotencyKey?: string
  ): Promise<BatchResponse> {
    const recipients = parseBatchCsv(csvText);
    return this.createBatch(
      {
        name: metadata.name,
        sourceAccountId: metadata.sourceAccountId,
        description: metadata.description,
        recipients,
      },
      idempotencyKey
    );
  }

  public async getBatch(id: string): Promise<BatchResponse> {
    return this.request<BatchResponse>(`/api/batches/${encodeURIComponent(id)}`, {
      method: "GET",
    });
  }

  public async health(): Promise<{ status: string; timestamp?: string }> {
    return this.request<{ status: string; timestamp?: string }>("/api/health", {
      method: "GET",
    });
  }

  public verifyWebhook(options: WebhookVerifyOptions): boolean {
    return verifyWebhookSignature(options);
  }
}
