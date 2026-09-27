// SPDX-License-Identifier: MIT

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  sendEmail,
  EMAIL_TEMPLATES,
  RESEND_API_URL,
  DEFAULT_MAX_RETRIES,
  type EmailPayload,
} from "@/lib/email";
import {
  assertResendApiKey,
  resendApiKeyProblem,
  getEmailConfig,
  validateEnv,
  DEFAULT_EMAIL_FROM,
} from "@/lib/env";
import { logger } from "@/lib/logger";

describe("Transactional Email Service (Issue #800)", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    for (const key of Object.keys(process.env)) {
      if (!(key in originalEnv)) {
        delete process.env[key];
      }
    }
    Object.assign(process.env, originalEnv);
  });

  // ─────────────────────────────────────────────────────────────
  // 1. Configuration & Validation
  // ─────────────────────────────────────────────────────────────
  describe("Configuration & Environment Validation", () => {
    it("resendApiKeyProblem detects missing, short, and placeholder keys", () => {
      expect(resendApiKeyProblem(undefined)).toContain("not set");
      expect(resendApiKeyProblem(null)).toContain("not set");
      expect(resendApiKeyProblem("")).toContain("not set");
      expect(resendApiKeyProblem("   ")).toContain("not set");
      expect(resendApiKeyProblem("short")).toContain("at least 8 characters");
      expect(resendApiKeyProblem("re_placeholder_12345")).toContain("looks like a placeholder");
      expect(resendApiKeyProblem("re_replace-with-key")).toContain("looks like a placeholder");
      expect(resendApiKeyProblem("re_live_valid_api_key_123456")).toBeNull();
    });

    it("assertResendApiKey returns trimmed key on success", () => {
      const validKey = "  re_live_valid_api_key_123456  ";
      expect(assertResendApiKey(validKey)).toBe("re_live_valid_api_key_123456");
    });

    it("assertResendApiKey throws descriptive error on invalid key", () => {
      expect(() => assertResendApiKey("")).toThrow(/RESEND_API_KEY is required in production/);
      expect(() => assertResendApiKey("short")).toThrow(/at least 8 characters/);
      expect(() => assertResendApiKey("re_placeholder_key")).toThrow(/looks like a placeholder/);
    });

    it("getEmailConfig provides configured key and default from address", () => {
      vi.stubEnv("RESEND_API_KEY", "re_test_key_12345678");
      vi.stubEnv("EMAIL_FROM", "Custom Sender <custom@ophirpay.com>");

      const config = getEmailConfig();
      expect(config.apiKey).toBe("re_test_key_12345678");
      expect(config.from).toBe("Custom Sender <custom@ophirpay.com>");
    });

    it("getEmailConfig falls back to default sender when EMAIL_FROM is unset", () => {
      delete process.env.EMAIL_FROM;
      const config = getEmailConfig();
      expect(config.from).toBe(DEFAULT_EMAIL_FROM);
    });

    it("validateEnv validates RESEND_API_KEY and provides default EMAIL_FROM", () => {
      vi.stubEnv("DATABASE_URL", "postgresql://localhost:5432/ophirpay");
      vi.stubEnv("NEXT_PUBLIC_CONTRACT_ID", "CCQGGUJRRVXMHNEX2RYPODGJE2YRMYY4Y7A3KTJH3QP2LWZLTCOPRPET");
      vi.stubEnv("NEXT_PUBLIC_EMITTER_CONTRACT_ID", "CDAVU2XJ7C2Y52GRJZKRG3HDI7AJ2K2FHAFH5FPDTSUQAV7XNBQNNVAN");
      vi.stubEnv("RESEND_API_KEY", "re_live_test_key_12345");
      delete process.env.EMAIL_FROM;

      const env = validateEnv();
      expect(env.RESEND_API_KEY).toBe("re_live_test_key_12345");
      expect(env.EMAIL_FROM).toBe("OphirPay <payments@ophirpay.com>");
    });

    it("validateEnv rejects invalid RESEND_API_KEY that is too short", () => {
      vi.stubEnv("DATABASE_URL", "postgresql://localhost:5432/ophirpay");
      vi.stubEnv("NEXT_PUBLIC_CONTRACT_ID", "CCQGGUJRRVXMHNEX2RYPODGJE2YRMYY4Y7A3KTJH3QP2LWZLTCOPRPET");
      vi.stubEnv("NEXT_PUBLIC_EMITTER_CONTRACT_ID", "CDAVU2XJ7C2Y52GRJZKRG3HDI7AJ2K2FHAFH5FPDTSUQAV7XNBQNNVAN");
      vi.stubEnv("RESEND_API_KEY", "short");

      expect(() => validateEnv()).toThrow(/RESEND_API_KEY must be at least 8 characters/);
    });
  });

  // ─────────────────────────────────────────────────────────────
  // 2. Development Mode
  // ─────────────────────────────────────────────────────────────
  describe("Development Mode", () => {
    it("logs recipient and subject to console and returns true without calling network", async () => {
      vi.stubEnv("NODE_ENV", "development");
      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      const fetchSpy = vi.fn();

      const payload: EmailPayload = {
        to: "developer@example.com",
        subject: "Development Test Email",
        html: "<p>Test Content</p>",
      };

      const result = await sendEmail(payload, { fetchFn: fetchSpy as unknown as typeof fetch });

      expect(result).toBe(true);
      expect(consoleSpy).toHaveBeenCalledWith("[Email Dev]", {
        to: "developer@example.com",
        subject: "Development Test Email",
      });
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });

  // ─────────────────────────────────────────────────────────────
  // 3. Production Mode Missing Configuration
  // ─────────────────────────────────────────────────────────────
  describe("Production Mode Validation", () => {
    it("throws loud error when RESEND_API_KEY is missing in production", async () => {
      vi.stubEnv("NODE_ENV", "production");
      delete process.env.RESEND_API_KEY;

      const payload: EmailPayload = {
        to: "user@example.com",
        subject: "Production Alert",
        html: "<p>Hello</p>",
      };

      await expect(sendEmail(payload)).rejects.toThrow(
        /RESEND_API_KEY is required in production: RESEND_API_KEY is not set/
      );
    });

    it("throws loud error when RESEND_API_KEY is a placeholder in production", async () => {
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("RESEND_API_KEY", "re_placeholder_key_example");

      const payload: EmailPayload = {
        to: "user@example.com",
        subject: "Production Alert",
        html: "<p>Hello</p>",
      };

      await expect(sendEmail(payload)).rejects.toThrow(
        /RESEND_API_KEY looks like a placeholder/
      );
    });

    it("throws loud error when RESEND_API_KEY is shorter than 8 characters in production", async () => {
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("RESEND_API_KEY", "short");

      const payload: EmailPayload = {
        to: "user@example.com",
        subject: "Production Alert",
        html: "<p>Hello</p>",
      };

      await expect(sendEmail(payload)).rejects.toThrow(
        /RESEND_API_KEY must be at least 8 characters/
      );
    });
  });

  // ─────────────────────────────────────────────────────────────
  // 4. Successful Email Delivery
  // ─────────────────────────────────────────────────────────────
  describe("Successful Email Delivery", () => {
    it("sends email via Resend REST API and returns true", async () => {
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("RESEND_API_KEY", "re_live_valid_secret_key_12345");
      vi.stubEnv("EMAIL_FROM", "OphirPay <payments@ophirpay.com>");

      let capturedUrl = "";
      let capturedInit: RequestInit | undefined;

      const mockFetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
        capturedUrl = url;
        capturedInit = init;
        return new Response(JSON.stringify({ id: "email_msg_123456" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      });

      const payload: EmailPayload = {
        to: "recipient@example.com",
        subject: "Payment Confirmation",
        html: "<p>Payment succeeded</p>",
        text: "Payment succeeded",
      };

      const result = await sendEmail(payload, {
        fetchFn: mockFetch as unknown as typeof fetch,
        initialDelayMs: 1,
      });

      expect(result).toBe(true);
      expect(capturedUrl).toBe(RESEND_API_URL);
      expect(capturedInit?.method).toBe("POST");

      const headers = capturedInit?.headers as Record<string, string>;
      expect(headers["Authorization"]).toBe("Bearer re_live_valid_secret_key_12345");
      expect(headers["Content-Type"]).toBe("application/json");

      const body = JSON.parse(capturedInit?.body as string);
      expect(body).toEqual({
        from: "OphirPay <payments@ophirpay.com>",
        to: "recipient@example.com",
        subject: "Payment Confirmation",
        html: "<p>Payment succeeded</p>",
        text: "Payment succeeded",
      });
    });

    it("respects custom from address passed in payload or options", async () => {
      vi.stubEnv("RESEND_API_KEY", "re_live_valid_secret_key_12345");

      let sentBody: Record<string, unknown> = {};
      const mockFetch = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
        sentBody = JSON.parse(init?.body as string);
        return new Response(JSON.stringify({ id: "msg_custom_from" }), { status: 200 });
      });

      await sendEmail(
        {
          to: "user@example.com",
          subject: "Custom Sender Test",
          html: "<p>Custom</p>",
          from: "Billing <billing@ophirpay.com>",
        },
        { fetchFn: mockFetch as unknown as typeof fetch, initialDelayMs: 1 }
      );

      expect(sentBody.from).toBe("Billing <billing@ophirpay.com>");
    });
  });

  // ─────────────────────────────────────────────────────────────
  // 5. Transient Errors and Exponential Backoff Retries
  // ─────────────────────────────────────────────────────────────
  describe("Transient Errors & Exponential Backoff Retries", () => {
    it("retries on HTTP 429 Rate Limit and succeeds on retry", async () => {
      vi.stubEnv("RESEND_API_KEY", "re_live_valid_secret_key_12345");
      let callCount = 0;

      const mockFetch = vi.fn().mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          return new Response(JSON.stringify({ message: "Rate limit exceeded" }), {
            status: 429,
            statusText: "Too Many Requests",
          });
        }
        return new Response(JSON.stringify({ id: "msg_success_retry" }), { status: 200 });
      });

      const result = await sendEmail(
        {
          to: "user@example.com",
          subject: "Rate Limit Test",
          html: "<p>Content</p>",
        },
        { fetchFn: mockFetch as unknown as typeof fetch, initialDelayMs: 5 }
      );

      expect(result).toBe(true);
      expect(callCount).toBe(2);
    });

    it("retries on HTTP 500 / 503 Server Errors and succeeds on retry", async () => {
      vi.stubEnv("RESEND_API_KEY", "re_live_valid_secret_key_12345");
      let callCount = 0;

      const mockFetch = vi.fn().mockImplementation(async () => {
        callCount++;
        if (callCount < 3) {
          return new Response(JSON.stringify({ message: "Internal server error" }), {
            status: 503,
            statusText: "Service Unavailable",
          });
        }
        return new Response(JSON.stringify({ id: "msg_success_server_retry" }), { status: 200 });
      });

      const result = await sendEmail(
        {
          to: "user@example.com",
          subject: "Server Error Test",
          html: "<p>Content</p>",
        },
        { fetchFn: mockFetch as unknown as typeof fetch, initialDelayMs: 5 }
      );

      expect(result).toBe(true);
      expect(callCount).toBe(3); // Initial + 2 retries = 3 attempts
    });

    it("retries on network fetch failure and succeeds on retry", async () => {
      vi.stubEnv("RESEND_API_KEY", "re_live_valid_secret_key_12345");
      let callCount = 0;

      const mockFetch = vi.fn().mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          throw new TypeError("fetch failed: connection reset");
        }
        return new Response(JSON.stringify({ id: "msg_network_retry" }), { status: 200 });
      });

      const result = await sendEmail(
        {
          to: "user@example.com",
          subject: "Network Failure Test",
          html: "<p>Content</p>",
        },
        { fetchFn: mockFetch as unknown as typeof fetch, initialDelayMs: 5 }
      );

      expect(result).toBe(true);
      expect(callCount).toBe(2);
    });

    it("returns false after exhausting all retries on persistent transient error", async () => {
      vi.stubEnv("RESEND_API_KEY", "re_live_valid_secret_key_12345");
      const loggerSpy = vi.spyOn(logger, "error").mockImplementation(() => {});
      let callCount = 0;

      const mockFetch = vi.fn().mockImplementation(async () => {
        callCount++;
        return new Response(JSON.stringify({ message: "Service Unavailable" }), {
          status: 503,
          statusText: "Service Unavailable",
        });
      });

      const result = await sendEmail(
        {
          to: "user@example.com",
          subject: "Exhausted Retries Test",
          html: "<p>Content</p>",
        },
        { fetchFn: mockFetch as unknown as typeof fetch, initialDelayMs: 5 }
      );

      expect(result).toBe(false);
      // 1 initial attempt + 2 retries = 3 attempts total
      expect(callCount).toBe(DEFAULT_MAX_RETRIES + 1);
      expect(loggerSpy).toHaveBeenCalledWith(
        "Failed to send transactional email after max retries",
        expect.objectContaining({
          recipient: "user@example.com",
          subject: "Exhausted Retries Test",
          status: 503,
          attempts: 3,
        })
      );
    });
  });

  // ─────────────────────────────────────────────────────────────
  // 6. Permanent Errors Fail Fast Without Retrying
  // ─────────────────────────────────────────────────────────────
  describe("Permanent Errors Fail Fast", () => {
    it("returns false immediately on HTTP 401 Unauthorized without retrying", async () => {
      vi.stubEnv("RESEND_API_KEY", "re_invalid_api_key_12345");
      const loggerSpy = vi.spyOn(logger, "error").mockImplementation(() => {});
      let callCount = 0;

      const mockFetch = vi.fn().mockImplementation(async () => {
        callCount++;
        return new Response(JSON.stringify({ message: "Invalid API key" }), {
          status: 401,
          statusText: "Unauthorized",
        });
      });

      const result = await sendEmail(
        {
          to: "user@example.com",
          subject: "Unauthorized Test",
          html: "<p>Content</p>",
        },
        { fetchFn: mockFetch as unknown as typeof fetch, initialDelayMs: 5 }
      );

      expect(result).toBe(false);
      expect(callCount).toBe(1); // No retries for permanent errors
      expect(loggerSpy).toHaveBeenCalledWith(
        "Failed to send transactional email (permanent failure)",
        expect.objectContaining({
          status: 401,
          attempt: 1,
        })
      );
    });

    it("returns false immediately on HTTP 422 Unprocessable Entity without retrying", async () => {
      vi.stubEnv("RESEND_API_KEY", "re_live_valid_secret_key_12345");
      const loggerSpy = vi.spyOn(logger, "error").mockImplementation(() => {});
      let callCount = 0;

      const mockFetch = vi.fn().mockImplementation(async () => {
        callCount++;
        return new Response(JSON.stringify({ message: "The to field is invalid" }), {
          status: 422,
          statusText: "Unprocessable Entity",
        });
      });

      const result = await sendEmail(
        {
          to: "invalid-email-address",
          subject: "Validation Test",
          html: "<p>Content</p>",
        },
        { fetchFn: mockFetch as unknown as typeof fetch, initialDelayMs: 5 }
      );

      expect(result).toBe(false);
      expect(callCount).toBe(1); // No retries for validation error
      expect(loggerSpy).toHaveBeenCalledWith(
        "Failed to send transactional email (permanent failure)",
        expect.objectContaining({
          status: 422,
          recipient: "invalid-email-address",
        })
      );
    });
  });

  // ─────────────────────────────────────────────────────────────
  // 7. EMAIL_TEMPLATES Formatting
  // ─────────────────────────────────────────────────────────────
  describe("EMAIL_TEMPLATES Formatting", () => {
    it("formats paymentSent template with amount and transaction hash", () => {
      const template = EMAIL_TEMPLATES.paymentSent("250 XLM", "0xabc123def456");
      expect(template.subject).toBe("Payment of 250 XLM sent on Stellar");
      expect(template.html).toContain("<strong>250 XLM</strong>");
      expect(template.html).toContain("TX: 0xabc123def456");
      expect(template.text).toContain("250 XLM");
      expect(template.text).toContain("0xabc123def456");
    });

    it("formats paymentReceived template with amount and sender address", () => {
      const template = EMAIL_TEMPLATES.paymentReceived("50 USDC", "GBBD...WXYZ");
      expect(template.subject).toBe("You received 50 USDC on Stellar");
      expect(template.html).toContain("<strong>50 USDC</strong>");
      expect(template.html).toContain("GBBD...WXYZ");
      expect(template.text).toContain("50 USDC");
      expect(template.text).toContain("GBBD...WXYZ");
    });

    it("formats webhookFailed template with URL and event name", () => {
      const template = EMAIL_TEMPLATES.webhookFailed(
        "https://api.merchant.com/webhook",
        "payment.completed"
      );
      expect(template.subject).toBe("Webhook delivery failed: payment.completed");
      expect(template.html).toContain("<strong>payment.completed</strong>");
      expect(template.html).toContain("https://api.merchant.com/webhook");
      expect(template.text).toContain("payment.completed");
      expect(template.text).toContain("https://api.merchant.com/webhook");
    });
  });
});
