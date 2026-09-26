// SPDX-License-Identifier: MIT

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { AsyncLocalStorage } from "node:async_hooks";
import {
  isTracingEnabled,
  setTracingEnabledForTesting,
  withSpan,
  getCompletedSpans,
  clearCompletedSpans,
  getActiveSpan,
  getCurrentTraceId,
  getCurrentSpanId,
  redactTraceAttributes,
  SpanKind,
  SpanStatusCode,
  instrumentFetch,
  restoreFetch,
  registerRequestIdGetter,
} from "../lib/tracing.ts";

const requestIdContext = new AsyncLocalStorage<string>();
registerRequestIdGetter(() => requestIdContext.getStore());

describe("OpenTelemetry Tracing Suite", () => {
  beforeEach(() => {
    clearCompletedSpans();
    setTracingEnabledForTesting(null);
    delete process.env.ENABLE_TRACING;
    delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    delete process.env.OTEL_TRACES_SAMPLER;
    restoreFetch();
  });

  afterEach(() => {
    clearCompletedSpans();
    setTracingEnabledForTesting(null);
    restoreFetch();
  });

  describe("1. Tracing Disabled by Default (Zero Cost)", () => {
    it("reports tracing disabled by default", () => {
      assert.strictEqual(isTracingEnabled(), false);
    });

    it("executes functions with zero span recording overhead when disabled", async () => {
      let executed = false;
      const result = await withSpan("test.operation", async (span) => {
        executed = true;
        span.setAttribute("key", "value");
        return 42;
      });

      assert.strictEqual(executed, true);
      assert.strictEqual(result, 42);
      assert.strictEqual(getCompletedSpans().length, 0);
      assert.strictEqual(getActiveSpan(), undefined);
      assert.strictEqual(getCurrentTraceId(), undefined);
    });

    it("respects ENABLE_TRACING=true or OTEL_EXPORTER_OTLP_ENDPOINT", () => {
      process.env.ENABLE_TRACING = "true";
      assert.strictEqual(isTracingEnabled(), true);

      delete process.env.ENABLE_TRACING;
      process.env.OTEL_EXPORTER_OTLP_ENDPOINT = "http://localhost:4318";
      assert.strictEqual(isTracingEnabled(), true);
    });
  });

  describe("2. PII Redaction Policy", () => {
    it("redacts sensitive field names per logging policy", () => {
      const input = {
        memo: "Dinner payment with friends",
        memos: ["Payment 1", "Payment 2"],
        email: "alice@example.com",
        apiKey: "sec_live_99999",
        secret: "supersecrettoken",
        password: "userpassword123",
        token: "bearer-token-abc",
        auth: "Bearer eyJhbGciOi...",
        safeField: "safe-value",
        amount: 150.25,
        assetCode: "USDC",
      };

      const redacted = redactTraceAttributes(input);

      assert.strictEqual(redacted.memo, "[REDACTED]");
      assert.strictEqual(redacted.memos, "[REDACTED]");
      assert.strictEqual(redacted.email, "[REDACTED]");
      assert.strictEqual(redacted.apiKey, "[REDACTED]");
      assert.strictEqual(redacted.secret, "[REDACTED]");
      assert.strictEqual(redacted.password, "[REDACTED]");
      assert.strictEqual(redacted.token, "[REDACTED]");
      assert.strictEqual(redacted.auth, "[REDACTED]");
      assert.strictEqual(redacted.safeField, "safe-value");
      assert.strictEqual(redacted.amount, 150.25);
      assert.strictEqual(redacted.assetCode, "USDC");
    });

    it("redacts email patterns within strings and objects", () => {
      const input = {
        description: "Payment sent to user bob.smith+test@domain.co.uk yesterday",
        nested: {
          recipient: "charlie@crypto.org",
        },
      };

      const redacted = redactTraceAttributes(input);
      assert.strictEqual(
        redacted.description,
        "Payment sent to user [REDACTED] yesterday"
      );
      assert.ok(
        typeof redacted.nested === "string" &&
        redacted.nested.includes("[REDACTED]") &&
        !redacted.nested.includes("charlie@crypto.org")
      );
    });

    it("redacts Stellar secret keys (S... format)", () => {
      const secretKey = "SBWV6GQWWQG2V3AFL7U3447K7S62L6S5MOU3M2CQY7E4EHL7F2QYCQW2";
      const input = {
        config: `Keypair secret: ${secretKey}`,
      };

      const redacted = redactTraceAttributes(input);
      assert.strictEqual(
        redacted.config,
        "Keypair secret: [REDACTED_SECRET_KEY]"
      );
    });

    it("preserves non-PII protocol identifiers", () => {
      const input = {
        contractId: "CCQGGUJRRVXMHNEX2RYPODGJE2YRMYY4Y7A3KTJH3QP2LWZLTCOPRPET",
        sourcePublicKey: "GBQMIN7KLT4R473IGGFBGUYM2UNPGKZRTX2LZ4M2KQIY2ASYJL6ACBMZ",
        txHash: "7b8f9e6a1d4c2b5e8a7f0d3c6b9e2a5f8d1c4b7e0a3f6d9c2b5e8a1f4d7c0b3e",
        network: "TESTNET",
        amountStroops: 10000000,
      };

      const redacted = redactTraceAttributes(input);
      assert.strictEqual(redacted.contractId, input.contractId);
      assert.strictEqual(redacted.sourcePublicKey, input.sourcePublicKey);
      assert.strictEqual(redacted.txHash, input.txHash);
      assert.strictEqual(redacted.network, input.network);
      assert.strictEqual(redacted.amountStroops, input.amountStroops);
    });
  });

  describe("3. Single Payment Unified Trace Across HTTP, Contract, Horizon, and DB", () => {
    it("produces one trace spanning HTTP, Soroban, Horizon, and Prisma with request.id correlation", async () => {
      setTracingEnabledForTesting(true);

      const requestId = "req-test-uuid-4567";

      // Simulate an incoming HTTP payment request running inside requestIdContext
      await requestIdContext.run(requestId, async () => {
        // 1. Root HTTP Server Span
        await withSpan(
          "HTTP POST /api/payments",
          async (httpSpan) => {
            httpSpan.setAttributes({
              "http.method": "POST",
              "http.target": "/api/payments",
              "http.status_code": 201,
            });

            // 2. Prisma Database Write Child Span
            await withSpan(
              "prisma.Payment.create",
              async (dbSpan) => {
                dbSpan.setAttributes({
                  "db.system": "prisma",
                  "db.operation": "create",
                  "db.model": "Payment",
                  "payment.id": "pay-101",
                  "payment.amount": "250.00",
                });
              },
              { kind: SpanKind.CLIENT }
            );

            // 3. Soroban Smart Contract Invocation Child Span
            await withSpan(
              "soroban.simulate",
              async (contractSpan) => {
                contractSpan.setAttributes({
                  "contract.id": "CCQGGUJRRVXMHNEX2RYPODGJE2YRMYY4Y7A3KTJH3QP2LWZLTCOPRPET",
                  "contract.function": "record_payment",
                  "soroban.source": "GBQMIN7KLT4R473IGGFBGUYM2UNPGKZRTX2LZ4M2KQIY2ASYJL6ACBMZ",
                });
              },
              { kind: SpanKind.CLIENT }
            );

            // 4. Horizon Ledger Interaction Child Span
            await withSpan(
              "horizon.submit_transaction",
              async (horizonSpan) => {
                horizonSpan.setAttributes({
                  "stellar.tx_hash": "deadbeef1234567890abcdef",
                  "horizon.operation": "submit_transaction",
                  "horizon.successful": true,
                });
              },
              { kind: SpanKind.CLIENT }
            );
          },
          { kind: SpanKind.SERVER }
        );
      });

      const completed = getCompletedSpans();
      assert.strictEqual(completed.length, 4);

      const dbSpan = completed.find((s) => s.name === "prisma.Payment.create")!;
      const contractSpan = completed.find((s) => s.name === "soroban.simulate")!;
      const horizonSpan = completed.find((s) => s.name === "horizon.submit_transaction")!;
      const httpSpan = completed.find((s) => s.name === "HTTP POST /api/payments")!;

      assert.ok(dbSpan, "Database span should exist");
      assert.ok(contractSpan, "Contract span should exist");
      assert.ok(horizonSpan, "Horizon span should exist");
      assert.ok(httpSpan, "HTTP span should exist");

      // Verify all spans share the same traceId (single payment = one trace)
      const expectedTraceId = httpSpan.spanContext().traceId;
      assert.ok(expectedTraceId && expectedTraceId.length === 32);
      assert.strictEqual(dbSpan.spanContext().traceId, expectedTraceId);
      assert.strictEqual(contractSpan.spanContext().traceId, expectedTraceId);
      assert.strictEqual(horizonSpan.spanContext().traceId, expectedTraceId);

      // Verify parentSpanId hierarchy: child spans point to root HTTP span
      const rootSpanId = httpSpan.spanContext().spanId;
      assert.strictEqual(dbSpan.parentSpanId, rootSpanId);
      assert.strictEqual(contractSpan.parentSpanId, rootSpanId);
      assert.strictEqual(horizonSpan.parentSpanId, rootSpanId);
      assert.strictEqual(httpSpan.parentSpanId, undefined);

      // Verify request.id correlation across all spans
      assert.strictEqual(httpSpan.attributes["request.id"], requestId);
      assert.strictEqual(dbSpan.attributes["request.id"], requestId);
      assert.strictEqual(contractSpan.attributes["request.id"], requestId);
      assert.strictEqual(horizonSpan.attributes["request.id"], requestId);

      // Verify span status OK
      assert.strictEqual(httpSpan.status.code, SpanStatusCode.OK);
      assert.strictEqual(dbSpan.status.code, SpanStatusCode.OK);
      assert.strictEqual(contractSpan.status.code, SpanStatusCode.OK);
      assert.strictEqual(horizonSpan.status.code, SpanStatusCode.OK);
    });

    it("captures exceptions and marks spans with ERROR status", async () => {
      setTracingEnabledForTesting(true);

      await assert.rejects(async () => {
        await withSpan("contract.failing_call", async (span) => {
          span.setAttribute("contract.id", "CDAVU2XJ");
          throw new Error("RPC timeout connecting to Soroban validator");
        });
      }, /RPC timeout/);

      const completed = getCompletedSpans();
      assert.strictEqual(completed.length, 1);
      const span = completed[0];
      assert.strictEqual(span.status.code, SpanStatusCode.ERROR);
      assert.ok(span.status.message?.includes("RPC timeout"));
      assert.strictEqual(span.events.length, 1);
      assert.strictEqual(span.events[0].name, "exception");
      assert.ok(span.events[0].attributes?.["exception.message"]);
    });
  });

  describe("4. Sampling Policy", () => {
    it("respects OTEL_TRACES_SAMPLER=always_off", async () => {
      setTracingEnabledForTesting(true);
      process.env.OTEL_TRACES_SAMPLER = "always_off";

      await withSpan("test.unsampled", async (span) => {
        span.setAttribute("tag", "dropped");
      });

      assert.strictEqual(getCompletedSpans().length, 0);
    });

    it("respects OTEL_TRACES_SAMPLER=always_on", async () => {
      setTracingEnabledForTesting(true);
      process.env.OTEL_TRACES_SAMPLER = "always_on";

      await withSpan("test.sampled", async (span) => {
        span.setAttribute("tag", "kept");
      });

      assert.strictEqual(getCompletedSpans().length, 1);
      assert.strictEqual(getCompletedSpans()[0].name, "test.sampled");
    });
  });

  describe("5. Outbound Fetch Instrumentation", () => {
    it("injects traceparent and x-request-id into outbound requests", async () => {
      setTracingEnabledForTesting(true);

      let capturedUrl = "";
      const capturedHeaders: Record<string, string> = {};

      // Mock native globalThis.fetch implementation before instrumenting
      const original = globalThis.fetch;
      globalThis.fetch = async (input, init) => {
        capturedUrl = String(input);
        const headers = init?.headers as Headers;
        if (headers) {
          if (typeof headers.forEach === "function") {
            headers.forEach((v, k) => {
              capturedHeaders[k.toLowerCase()] = v;
            });
          } else if (typeof headers.get === "function") {
            const tp = headers.get("traceparent");
            if (tp) capturedHeaders["traceparent"] = tp;
            const rid = headers.get("x-request-id");
            if (rid) capturedHeaders["x-request-id"] = rid;
          }
        }
        return new Response(JSON.stringify({ jsonrpc: "2.0", result: "ok" }), {
          status: 200,
        });
      };

      instrumentFetch();

      const testRequestId = "req-outbound-9999";
      await requestIdContext.run(testRequestId, async () => {
        await withSpan("payment.orchestration", async () => {
          await globalThis.fetch("https://soroban-testnet.stellar.org/rpc", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ method: "getHealth" }),
          });
        });
      });

      restoreFetch();
      globalThis.fetch = original;

      assert.strictEqual(capturedUrl, "https://soroban-testnet.stellar.org/rpc");
      assert.ok(capturedHeaders["traceparent"], "Should include W3C traceparent header");
      assert.ok(capturedHeaders["traceparent"].startsWith("00-"));
      assert.strictEqual(capturedHeaders["x-request-id"], testRequestId);

      const completed = getCompletedSpans();
      const fetchSpan = completed.find((s) => s.name.startsWith("HTTP POST soroban-testnet"));
      assert.ok(fetchSpan, "Should record outbound fetch client span");
      assert.strictEqual(fetchSpan.attributes["http.method"], "POST");
      assert.strictEqual(fetchSpan.attributes["request.id"], testRequestId);
    });
  });
});
