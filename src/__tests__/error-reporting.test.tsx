// SPDX-License-Identifier: MIT

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  sanitizeRoute,
  reportRenderedError,
  _resetErrorReportState,
  _setTrackFnForTests,
} from "@/lib/analytics-events";

// ── Spy on the internal tracking function ──────────────────────────────────
const trackEventSpy = vi.fn();

// Suppress expected console.error noise in tests
let consoleSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  _resetErrorReportState();
  _setTrackFnForTests(trackEventSpy as never);
  consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  // Ensure window.location is available for route detection
  Object.defineProperty(window, "location", {
    value: { pathname: "/dashboard" },
    writable: true,
  });
});

afterEach(() => {
  consoleSpy.mockRestore();
});

// ── sanitizeRoute ───────────────────────────────────────────────────────────
describe("sanitizeRoute", () => {
  it("returns the pathname without query or hash", () => {
    expect(sanitizeRoute("/payments?tab=history#section")).toBe("/payments");
  });

  it("strips query parameters that may contain secrets", () => {
    expect(sanitizeRoute("/api/auth?token=abc123")).toBe("/api/auth");
  });

  it("redacts Stellar secret keys in the path", () => {
    const secret = "S" + "A".repeat(55);
    expect(sanitizeRoute(`/${secret}/pay`)).toBe("/[REDACTED]/pay");
  });

  it("redacts long hex strings", () => {
    const hex = "a".repeat(64);
    expect(sanitizeRoute(`/tx/${hex}`)).toBe("/tx/[REDACTED]");
  });

  it("normalises trailing slashes", () => {
    expect(sanitizeRoute("/batches/")).toBe("/batches");
  });

  it("keeps root path as-is", () => {
    expect(sanitizeRoute("/")).toBe("/");
  });

  it("returns /unknown for empty or non-string input", () => {
    expect(sanitizeRoute("")).toBe("/unknown");
    // @ts-expect-error testing invalid input
    expect(sanitizeRoute(null)).toBe("/unknown");
    // @ts-expect-error testing invalid input
    expect(sanitizeRoute(undefined)).toBe("/unknown");
  });
});

// ── reportRenderedError ─────────────────────────────────────────────────────
describe("reportRenderedError", () => {
  it("calls trackEvent with sanitized route and error message", () => {
    const err = new Error("Payment failed");
    reportRenderedError(err);

    expect(trackEventSpy).toHaveBeenCalledOnce();
    expect(trackEventSpy).toHaveBeenCalledWith("error_occurred", {
      route: "/dashboard",
      message: "Payment failed",
    });
  });

  it("uses overridePath when provided", () => {
    const err = new Error("Oops");
    reportRenderedError(err, "/settings?tab=security#top");

    expect(trackEventSpy).toHaveBeenCalledWith("error_occurred", {
      route: "/settings",
      message: "Oops",
    });
  });

  it("throttles duplicate reports within the same window", () => {
    const err = new Error("Same error");

    reportRenderedError(err);
    reportRenderedError(err);
    reportRenderedError(err);

    expect(trackEventSpy).toHaveBeenCalledOnce();
  });

  it("allows reports after the throttle window expires", () => {
    vi.useFakeTimers();
    const err = new Error("Timed error");

    reportRenderedError(err);
    expect(trackEventSpy).toHaveBeenCalledOnce();

    vi.advanceTimersByTime(61_000);
    reportRenderedError(err);
    expect(trackEventSpy).toHaveBeenCalledTimes(2);

    vi.useRealTimers();
  });

  it("reports different errors independently", () => {
    reportRenderedError(new Error("Error A"));
    reportRenderedError(new Error("Error B"));

    expect(trackEventSpy).toHaveBeenCalledTimes(2);
  });

  it("does not loop if trackEvent throws", () => {
    trackEventSpy.mockImplementationOnce(() => {
      throw new Error("analytics failure");
    });

    // Should not throw or recurse
    expect(() => reportRenderedError(new Error("trigger"))).not.toThrow();

    // Reset throttle so second call can proceed
    _resetErrorReportState();
    trackEventSpy.mockReset();

    reportRenderedError(new Error("after failure"));
    expect(trackEventSpy).toHaveBeenCalledOnce();
  });

  it("reports fallback error with digest when available", () => {
    const err = new Error("Render crash") as Error & { digest?: string };
    err.digest = "abc-123";

    reportRenderedError(err, "/batches");

    expect(trackEventSpy).toHaveBeenCalledWith("error_occurred", {
      route: "/batches",
      message: "Render crash",
    });
  });
});

// ── Component integration: error.tsx ────────────────────────────────────────
describe("error.tsx – reports on render", () => {
  it("calls reportRenderedError when the fallback renders", async () => {
    const ErrorPage = (await import("@/app/error")).default;

    render(<ErrorPage error={new Error("Page broke")} reset={vi.fn()} />);

    expect(screen.getByText("Something went wrong")).toBeDefined();
    expect(trackEventSpy).toHaveBeenCalledOnce();
    expect(trackEventSpy).toHaveBeenCalledWith("error_occurred", {
      route: "/dashboard",
      message: "Page broke",
    });
  });

  it("renders the Try Again button", async () => {
    const ErrorPage = (await import("@/app/error")).default;
    const reset = vi.fn();

    render(<ErrorPage error={new Error("x")} reset={reset} />);

    const btn = screen.getByText("Try Again");
    expect(btn).toBeDefined();
  });
});

// ── Component integration: global-error.tsx ─────────────────────────────────
describe("global-error.tsx – reports on render", () => {
  it("calls reportRenderedError when the fallback renders", async () => {
    const GlobalError = (await import("@/app/global-error")).default;

    render(
      <GlobalError error={new Error("Global crash")} reset={vi.fn()} />,
    );

    expect(screen.getByText("Something went wrong")).toBeDefined();
    expect(trackEventSpy).toHaveBeenCalledOnce();
    expect(trackEventSpy).toHaveBeenCalledWith("error_occurred", {
      route: "/dashboard",
      message: "Global crash",
    });
  });

  it("shows the digest when present", async () => {
    const GlobalError = (await import("@/app/global-error")).default;
    const err = new Error("fail") as Error & { digest?: string };
    err.digest = "digest-42";

    render(<GlobalError error={err} reset={vi.fn()} />);

    expect(screen.getByText("Error ID: digest-42")).toBeDefined();
  });
});
