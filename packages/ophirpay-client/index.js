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

/**
 * RFC 7807 Problem Details
 * @typedef {Object} ProblemDetails
 * @property {string} [type]
 * @property {string} title
 * @property {number} status
 * @property {string} [detail]
 * @property {string} [instance]
 * @property {Record<string, string[]>} [errors]
 */

/** Error raised for any non-2xx API response or transport failure. */
export class OphirPayError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = "OphirPayError";
    this.status = options.status?? options.problem?.status?? null;
    this.code = options.code?? null;
    this.details = options.details?? null;
    // RFC 7807
    this.type = options.type?? options.problem?.type?? null;
    this.title = options.title?? options.problem?.title?? null;
    this.instance = options.instance?? options.problem?.instance?? null;
    this.errors = options.errors?? options.problem?.errors?? null;
    /** @type {ProblemDetails | null} */
    this.problem = options.problem?? null;
  }
}

/**
 * The canonical string the server signs: `<timestamp>.<body without the
 * signature field>`.
 */
export function canonicalizeWebhookBody(rawBody) {
  const parsed = typeof rawBody === "string"? JSON.parse(rawBody) : rawBody;
  return JSON.stringify({...parsed, signature: "" });
}

/** The exact message HMAC'd for a webhook. */
export function webhookSignedInput(timestamp, canonicalBody) {
  return `${timestamp}.${canonicalBody}`;
}

/**
 * Verify an incoming webhook.
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

  if (!rawBody ||!signature ||!timestamp ||!secret) return false;
  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) return false;
  const skewSeconds = Math.abs(now / 1000 - ts);
  if (skewSeconds > toleranceSeconds) return false;

  let expected;
  try {
    expected = crypto
     .createHmac("sha256", secret)
     .update(webhookSignedInput(timestamp, canonicalizeWebhookBody(rawBody)))
     .digest("hex");
  } catch {
    return false;
  }

  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(String(signature), "utf8");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function buildUrl(baseUrl, path, pathParams, query) {
  let resolved = path;
  for (const [key, value] of Object.entries(pathParams?? {})) {
    resolved = resolved.replace(`{${key}}`, encodeURIComponent(String(value)));
  }
  const url = new URL(resolved.replace(/^\//, ""), baseUrl.endsWith("/")? baseUrl : `${baseUrl}/`);
  for (const [key, value] of Object.entries(query?? {})) {
    if (value!== undefined && value!== null && value!== "") {
      url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

export class OphirPayClient {
  constructor(options = {}) {
    const baseUrl = options.baseUrl?? process.env.OPHIRPAY_BASE_URL?? "http://localhost:3000";
    const apiKey = options.apiKey?? process.env.OPHIRPAY_API_KEY;
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.apiKey = apiKey;
    this.timeoutMs = options.timeoutMs?? DEFAULT_TIMEOUT_MS;
    this.fetchImpl = options.fetchImpl?? globalThis.fetch;
    this.defaultHeaders = options.headers?? {};
  }

  operation(name) {
    const op = OPERATION_BY_NAME[name];
    if (!op) throw new OphirPayError(`Unknown operation: ${name}`);
    return op;
  }

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
          Accept: "application/json, application/problem+json",
         ...(body!== undefined? { "Content-Type": "application/json" } : {}),
         ...(this.apiKey? { Authorization: `Bearer ${this.apiKey}` } : {}),
         ...(idempotencyKey? { "Idempotency-Key": idempotencyKey } : {}),
         ...this.defaultHeaders,
         ...headers,
        },
        body: body!== undefined? JSON.stringify(body) : undefined,
      });
    } catch (err) {
      if (err && err.name === "AbortError") {
        throw new OphirPayError(`Request timed out after ${this.timeoutMs}ms`, { code: "TIMEOUT" });
      }
      throw new OphirPayError(err instanceof Error? err.message : String(err));
    } finally {
      clearTimeout(timer);
    }

    const text = await res.text();
    let json = {};
    try { json = text? JSON.parse(text) : {}; } catch { json = {}; }

    const contentType = res.headers?.get?.("content-type")?? "";
    const isProblem = contentType.includes("application/problem+json") || (json && json.title && json.status);

    if (!res.ok || json.success === false || isProblem) {
      if (isProblem) {
        /** @type {ProblemDetails} */
        const problem = json;
        throw new OphirPayError(problem.detail?? problem.title?? `Request failed with status ${res.status}`, {
          status: problem.status?? res.status,
          problem,
          errors: problem.errors,
          title: problem.title,
          type: problem.type,
          instance: problem.instance,
        });
      }
      const error = json.error?? {};
      throw new OphirPayError(error.message?? `Request failed with status ${res.status}`, {
        status: res.status,
        code: error.code?? null,
        details: error.details?? null,
      });
    }

    return json.data;
  }

  createPayment(input, options = {}) {
    return this.request("POST", this.operation("postApiPayments").path, {
      body: input,
      idempotencyKey: options.idempotencyKey,
    });
  }

  listPayments(query = {}) {
    return this.request("GET", this.operation("getApiPayments").path, { query });
  }

  getPayment(id) {
    return this.request("GET", this.operation("getApiPaymentsId").path, {
      pathParams: { id },
    });
  }

  createBatch(input, options = {}) {
    return this.request("POST", this.operation("postApiBatches").path, {
      body: input,
      idempotencyKey: options.idempotencyKey,
    });
  }

  getBatch(id) {
    return this.request("GET", this.operation("getApiBatchesId").path, {
      pathParams: { id },
    });
  }

  getStats() {
    return this.request("GET", this.operation("getApiStats").path);
  }
}