// SPDX-License-Identifier: MIT

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sentry = vi.hoisted(() => ({
  init: vi.fn(),
  captureException: vi.fn(),
  captureMessage: vi.fn(),
  setUser: vi.fn(),
}));

vi.mock("@sentry/nextjs", () => sentry);

import {
  captureError,
  captureMessage,
  initializeSentry,
  setUserContext,
} from "@/lib/sentry";

describe("Sentry reporting", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("NEXT_PUBLIC_SENTRY_DSN", "");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("does not initialize Sentry when no DSN is configured", () => {
    initializeSentry();
    expect(sentry.init).not.toHaveBeenCalled();
  });

  it("initializes without collecting default PII when configured", () => {
    vi.stubEnv("NEXT_PUBLIC_SENTRY_DSN", "https://public@example.ingest.sentry.io/1");
    initializeSentry();

    expect(sentry.init).toHaveBeenCalledWith({
      dsn: "https://public@example.ingest.sentry.io/1",
      environment: process.env.NODE_ENV,
    });
  });

  it("sends exceptions with component and caller-provided context", () => {
    vi.stubEnv("NEXT_PUBLIC_SENTRY_DSN", "https://public@example.ingest.sentry.io/1");
    const error = new Error("Render failed");
    captureError(error, {
      component: "PaymentForm",
      tags: { feature: "payments" },
      extra: { attempt: 2 },
    });

    expect(sentry.captureException).toHaveBeenCalledWith(error, {
      tags: { feature: "payments", component: "PaymentForm" },
      extra: { attempt: 2 },
    });
  });

  it("forwards message severity and the anonymous wallet context", () => {
    vi.stubEnv("NEXT_PUBLIC_SENTRY_DSN", "https://public@example.ingest.sentry.io/1");
    captureMessage("Wallet disconnected", "warning");
    setUserContext("GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA");

    expect(sentry.captureMessage).toHaveBeenCalledWith("Wallet disconnected", { level: "warning" });
    expect(sentry.setUser).toHaveBeenCalledWith({
      id: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    });
  });
});
