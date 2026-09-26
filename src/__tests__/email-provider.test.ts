// SPDX-License-Identifier: MIT
//
// Issue #800 — transactional email must actually reach the provider, and
// neither a provider failure nor a missing key may look like success.
//
// Every test stubs `fetch`, so no request ever leaves the process and no
// real message is ever sent.

import { describe, it, expect, vi, afterEach } from "vitest";
import { logger } from "@/lib/logger";
import {
  DEFAULT_EMAIL_FROM,
  EMAIL_TEMPLATES,
  EmailConfigurationError,
  EmailSendError,
  sendEmail,
  type EmailPayload,
} from "@/lib/email";

vi.mock("@/lib/logger", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    request: vi.fn(),
    metric: vi.fn(),
    timing: vi.fn(),
  },
}));

const RESEND_API_URL = "https://api.resend.com/emails";

const payload: EmailPayload = {
  to: "recipient@example.com",
  subject: "Payment of 10 XLM sent on Stellar",
  html: "<p>Your payment has been sent.</p>",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** Stub `fetch` with a fixed list of responses consumed one call at a time. */
function stubFetch(...results: (Response | Error)[]): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn();
  for (const result of results) {
    if (result instanceof Error) fetchMock.mockRejectedValueOnce(result);
    else fetchMock.mockResolvedValueOnce(result);
  }
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

/** Run `sendEmail` and return the rejection instead of failing the test. */
async function captureRejection(p: EmailPayload): Promise<unknown> {
  try {
    await sendEmail(p);
  } catch (error) {
    return error;
  }
  throw new Error("expected sendEmail() to reject, but it resolved");
}

function requestBody(fetchMock: ReturnType<typeof vi.fn>, call = 0): Record<string, unknown> {
  const [, init] = fetchMock.mock.calls[call] as [string, RequestInit];
  return JSON.parse(init.body as string) as Record<string, unknown>;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("sendEmail — provider accepted", () => {
  it("posts the message to Resend and returns true", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test_key");
    const fetchMock = stubFetch(jsonResponse({ id: "email_123" }));

    await expect(sendEmail(payload)).resolves.toBe(true);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(RESEND_API_URL);
    expect(init.method).toBe("POST");
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer re_test_key");
    expect(headers["Content-Type"]).toBe("application/json");
    expect(requestBody(fetchMock)).toEqual({
      from: DEFAULT_EMAIL_FROM,
      to: payload.to,
      subject: payload.subject,
      html: payload.html,
    });
    expect(vi.mocked(logger.info)).toHaveBeenCalledWith(
      "Email accepted by provider",
      expect.objectContaining({ attempts: 1 })
    );
  });

  it("uses EMAIL_FROM and forwards the optional text part", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test_key");
    vi.stubEnv("EMAIL_FROM", "OphirPay <billing@ophirpay.example>");
    const fetchMock = stubFetch(jsonResponse({ id: "email_456" }, 201));

    await expect(
      sendEmail({ ...payload, text: "Your payment has been sent." })
    ).resolves.toBe(true);

    expect(requestBody(fetchMock)).toMatchObject({
      from: "OphirPay <billing@ophirpay.example>",
      text: "Your payment has been sent.",
    });
  });

  it("sends the existing EMAIL_TEMPLATES output unchanged", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test_key");
    const fetchMock = stubFetch(jsonResponse({ id: "email_789" }));

    const template = EMAIL_TEMPLATES.paymentSent("10 XLM", "STELLAR_TX_HASH");
    await expect(sendEmail({ to: payload.to, ...template })).resolves.toBe(true);

    expect(requestBody(fetchMock)).toMatchObject({
      subject: template.subject,
      html: template.html,
    });
  });
});

describe("sendEmail — provider failure", () => {
  it("retries a transient 5xx with backoff, bounded to 3 attempts", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test_key");
    const fetchMock = stubFetch(
      jsonResponse({ message: "oops" }, 500),
      jsonResponse({ message: "oops" }, 500),
      jsonResponse({ message: "oops" }, 500)
    );

    const started = Date.now();
    const error = await captureRejection(payload);
    const elapsed = Date.now() - started;

    expect(error).toBeInstanceOf(EmailSendError);
    const sendError = error as EmailSendError;
    expect(sendError.providerStatus).toBe(500);
    expect(sendError.attempts).toBe(3);
    expect(sendError.message).toContain("HTTP 500");
    // Bounded and real: exactly three calls, separated by exponential backoff.
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(elapsed).toBeGreaterThanOrEqual(700);
    expect(vi.mocked(logger.warn)).toHaveBeenCalledTimes(2);
    expect(vi.mocked(logger.error)).toHaveBeenCalledWith(
      "Email delivery failed after retries",
      expect.objectContaining({ attempts: 3 })
    );
  });

  it("retries rate limits (429) up to 3 attempts", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test_key");
    const fetchMock = stubFetch(
      jsonResponse({ message: "Too many requests" }, 429),
      jsonResponse({ message: "Too many requests" }, 429),
      jsonResponse({ message: "Too many requests" }, 429)
    );

    const error = await captureRejection(payload);

    expect(error).toBeInstanceOf(EmailSendError);
    const sendError = error as EmailSendError;
    expect(sendError.providerStatus).toBe(429);
    expect(sendError.attempts).toBe(3);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("does not retry a permanent 4xx rejection", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test_key");
    const fetchMock = stubFetch(
      jsonResponse({ message: "API key is invalid" }, 401)
    );

    const error = await captureRejection(payload);

    expect(error).toBeInstanceOf(EmailSendError);
    const sendError = error as EmailSendError;
    expect(sendError.providerStatus).toBe(401);
    expect(sendError.attempts).toBe(1);
    expect(sendError.message).toContain("HTTP 401");
    // Fails fast: non-retryable 4xx returns immediately without retrying
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(vi.mocked(logger.warn)).not.toHaveBeenCalled();
    expect(vi.mocked(logger.error)).toHaveBeenCalledWith(
      "Email rejected by provider",
      expect.objectContaining({ status: 401, attempts: 1 })
    );
  });

  it("retries network transport failures up to 3 attempts", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test_key");
    const fetchMock = stubFetch(
      new Error("Network connection reset"),
      new Error("Network connection reset"),
      new Error("Network connection reset")
    );

    const error = await captureRejection(payload);

    expect(error).toBeInstanceOf(EmailSendError);
    const sendError = error as EmailSendError;
    expect(sendError.providerStatus).toBeUndefined();
    expect(sendError.attempts).toBe(3);
    expect(sendError.message).toContain("Could not reach the email provider");
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(vi.mocked(logger.warn)).toHaveBeenCalledTimes(2);
    expect(vi.mocked(logger.error)).toHaveBeenCalledWith(
      "Email delivery failed after retries",
      expect.objectContaining({ attempts: 3 })
    );
  });
});

describe("sendEmail — missing configuration", () => {
  it("throws EmailConfigurationError when RESEND_API_KEY is missing", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const error = await captureRejection(payload);

    expect(error).toBeInstanceOf(EmailConfigurationError);
    expect((error as EmailConfigurationError).message).toContain("RESEND_API_KEY");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("throws EmailConfigurationError when RESEND_API_KEY is whitespace", async () => {
    vi.stubEnv("RESEND_API_KEY", "   ");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const error = await captureRejection(payload);

    expect(error).toBeInstanceOf(EmailConfigurationError);
    expect((error as EmailConfigurationError).message).toContain("RESEND_API_KEY");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
