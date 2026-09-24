// SPDX-License-Identifier: MIT

// Resend provider paths for src/lib/email.ts: success, retries,
// non-retryable rejections, and missing-configuration fail-loud behavior.

import { describe, it, expect, vi, afterEach } from "vitest";
import {
  sendEmail,
  EmailConfigurationError,
  EmailSendError,
} from "@/lib/email";

const payload = { to: "user@example.com", subject: "s", html: "<p>x</p>" };

function mockFetchOnce(response: Response | Error) {
  const stub =
    response instanceof Error
      ? vi.fn().mockRejectedValue(response)
      : vi.fn().mockResolvedValue(response);
  vi.stubGlobal("fetch", stub);
  return stub;
}

function okResponse() {
  return new Response(JSON.stringify({ id: "email_123" }), { status: 200 });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("sendEmail provider", () => {
  it("returns true and posts to Resend when the provider accepts", async () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("RESEND_API_KEY", "re_test_key");
    const fetchStub = mockFetchOnce(okResponse());

    await expect(sendEmail(payload)).resolves.toBe(true);

    expect(fetchStub).toHaveBeenCalledTimes(1);
    const [url, init] = fetchStub.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.resend.com/emails");
    expect((init.headers as Record<string, string>)["Authorization"]).toBe(
      "Bearer re_test_key"
    );
    expect(JSON.parse(init.body as string)).toMatchObject({
      to: payload.to,
      subject: payload.subject,
    });
  });

  it("retries provider 500s and throws EmailSendError after 3 attempts", async () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("RESEND_API_KEY", "re_test_key");
    const fetchStub = vi
      .fn()
      .mockResolvedValue(new Response("oops", { status: 500 }));
    vi.stubGlobal("fetch", fetchStub);

    const error = await sendEmail(payload).catch((e) => e);
    expect(error).toBeInstanceOf(EmailSendError);
    expect((error as EmailSendError).providerStatus).toBe(500);
    expect((error as EmailSendError).attempts).toBe(3);
    expect(fetchStub).toHaveBeenCalledTimes(3);
  }, 10000);

  it("does not retry provider 400s", async () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("RESEND_API_KEY", "re_test_key");
    const fetchStub = mockFetchOnce(new Response("bad", { status: 400 }));

    const error = await sendEmail(payload).catch((e) => e);
    expect(error).toBeInstanceOf(EmailSendError);
    expect((error as EmailSendError).providerStatus).toBe(400);
    expect(fetchStub).toHaveBeenCalledTimes(1);
  });

  it("throws EmailConfigurationError when the key is missing", async () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("RESEND_API_KEY", "");
    const fetchStub = mockFetchOnce(okResponse());

    await expect(sendEmail(payload)).rejects.toBeInstanceOf(
      EmailConfigurationError
    );
    expect(fetchStub).not.toHaveBeenCalled();
  });
});
