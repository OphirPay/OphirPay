// SPDX-License-Identifier: MIT

/**
 * @ophirpay/client — a small, dependency-free client for the OphirPay API.
 *
 * The operation catalogue (`./operations.generated.js`) is generated from the
 * committed `docs/openapi.yaml`, so the wire contract in this client and the
 * published spec cannot drift. Webhook signature verification mirrors the
 * server's signing scheme (HMAC-SHA256 over `<timestamp>.<canonical body>`).
 */

import crypto from "node:crypto";
import { OPERATION_BY_NAME } from "./operations.generated.js";

/** Default request budget, in milliseconds. */
export const DEFAULT_TIMEOUT_MS = 30_000;

/** Webhook signatures older/newer than this are rejected (seconds). */
export const DEFAULT_SIGNATURE_TOLERANCE_SECONDS = 300;

/** Error raised for any non-2xx API response or transport failure. */
export class OphirPayError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = "OphirPayError";
    this.status = options.status ?? null;
    this.code = options.code ?? null;
    this.details = options.details ?? null;
  }
}

/**
 * The canonical string the server signs: `<timestamp>.<body without the
 * signature field>`.
 */
export function canonicalizeWebhookBody(rawBody) {
  const parsed = typeof rawBody === "string" ? JSON.parse(rawBody) : rawBody;
  return JSON.stringify({ ...parsed, signature: "" });
}

/** The exact message HMAC'd for a webhook. */
export function webhookSignedInput(timestamp, canonicalBody) {
  return `${timestamp}.${canonicalBody}`;
}

/**
 * Verify an incoming webhook.
 *
 * @param {object} params
 * @param {string} params.rawBody   Raw request body as received.
 * @param {string} params.signature `X-OphirPay-Signature` header.
 * @param {string} params.timestamp `X-OphirPay-Timestamp` header.
 * @param {string} params.secret    The webhook's signing secret.
 * @param {number} [params.toleranceSeconds] Replay window (default 300).
 * @param {number} [params.now]     Clock override, milliseconds (tests).
 * @returns {boolean} true only when the signature is valid and fresh.
 */
export function verifyWebhookSignature(params) {
  const {
    rawBody,
    signature,
    timestamp,
    secret,
    toleranceSeconds = DEFAULT_SIGNATURE_TOLERANCE_SECONDS,
    now = Date.now(),
  } = params;

  if (!rawBody || !signature || !timestamp || !secret) return false;

  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) return false;

  // Replay protection: reject a timestamp outside the tolerance window.
  const skewSeconds = Math.abs(now / 1000 - ts);
  if (skewSeconds > toleranceSeconds) return false;

  let expected;
  try {
    expected = crypto
      .createHmac("sha256", secret)
      .update(webhookSignedInput(timestamp, canonicalizeWebhookBody(rawBody)))
      .digest("hex");
  } catch {
    // Malformed JSON body — cannot be a valid signature.
    return false;
  }

  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(String(signature), "utf8");
  // Constant-time compare; length mismatch short-circuits safely.
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** Build a URL from a path template plus path params and query values. */
function buildUrl(baseUrl, path, pathParams, query) {
  let resolved = path;
  for (const [key, value] of Object.entries(pathParams ?? {})) {
    resolved = resolved.replace(`{${key}}`, encodeURIComponent(String(value)));
  }
  const url = new URL(resolved.replace(/^\//, ""), baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

/**
 * Minimal typed client. `baseUrl` defaults to `OPHIRPAY_BASE_URL` and
 * `apiKey` to `OPHIRPAY_API_KEY`, so CI only needs to set the environment.
 */
export class OphirPayClient {
  constructor(options = {}) {
    const baseUrl = options.baseUrl ?? process.env.OPHIRPAY_BASE_URL ?? "http://localhost:3000";
    const apiKey = options.apiKey ?? process.env.OPHIRPAY_API_KEY;
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.apiKey = apiKey;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
    this.defaultHeaders = options.headers ?? {};
  }

  /** Look up an operation from the generated OpenAPI catalogue. */
  operation(name) {
    const op = OPERATION_BY_NAME[name];
    if (!op) throw new OphirPayError(`Unknown operation: ${name}`);
    return op;
  }

  /** Raw request against the API, unwrapping the response envelope. */
  async request(method, path, options = {}) {
    const { pathParams, query, body, headers = {}, idempotencyKey } = options;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    let res;
    try {
      res = await this.fetchImpl(buildUrl(this.baseUrl, path, pathParams, query), {
        method,
        signal: controller.signal,
        headers: {
          Accept: "application/json",
          ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
          ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
          ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
          ...this.defaultHeaders,
          ...headers,
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch (err) {
      if (err && err.name === "AbortError") {
        throw new OphirPayError(`Request timed out after ${this.timeoutMs}ms`, {
          code: "TIMEOUT",
        });
      }
      throw new OphirPayError(err instanceof Error ? err.message : String(err));
    } finally {
      clearTimeout(timer);
    }

    const text = await res.text();
    const json = text ? JSON.parse(text) : {};

    if (!res.ok || json.success === false) {
      const error = json.error ?? {};
      throw new OphirPayError(
        error.message ?? `Request failed with status ${res.status}`,
        { status: res.status, code: error.code ?? null, details: error.details ?? null }
      );
    }

    return json.data;
  }

  // ── Convenience wrappers over the generated catalogue ────────

  /** POST /api/payments */
  createPayment(input, options = {}) {
    return this.request("POST", this.operation("postApiPayments").path, {
      body: input,
      idempotencyKey: options.idempotencyKey,
    });
  }

  /** GET /api/payments */
  listPayments(query = {}) {
    return this.request("GET", this.operation("getApiPayments").path, { query });
  }

  /** GET /api/payments/{id} */
  getPayment(id) {
    return this.request("GET", this.operation("getApiPaymentsId").path, {
      pathParams: { id },
    });
  }

  /** POST /api/batches */
  createBatch(input, options = {}) {
    return this.request("POST", this.operation("postApiBatches").path, {
      body: input,
      idempotencyKey: options.idempotencyKey,
    });
  }

  /** GET /api/batches/{id} */
  getBatch(id) {
    return this.request("GET", this.operation("getApiBatchesId").path, {
      pathParams: { id },
    });
  }

  /** GET /api/stats */
  getStats() {
    return this.request("GET", this.operation("getApiStats").path);
  }
}

