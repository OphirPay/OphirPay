// SPDX-License-Identifier: MIT

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { renderHook } from "@testing-library/react";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { SegmentError } from "@/components/SegmentError";
import PaymentsError from "@/app/payments/error";
import BatchesError from "@/app/batches/error";
import AuditLogError from "@/app/audit-log/error";
import AnalyticsError from "@/app/analytics/error";
import { useErrorTracker } from "@/hooks/useErrorTracker";
import * as sentryModule from "@/lib/sentry";
import {
  _resetErrorReportState,
  _setTrackFnForTests,
} from "@/lib/analytics-events";

// Component that throws
function BrokenComponent({ shouldThrow }: { shouldThrow: boolean }) {
  if (shouldThrow) throw new Error("Test error");
  return <div>Working</div>;
}

describe("ErrorBoundary", () => {
  const trackEventSpy = vi.fn();
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    _resetErrorReportState();
    _setTrackFnForTests(trackEventSpy as never);
    consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    Object.defineProperty(window, "location", {
      value: { pathname: "/payments" },
      writable: true,
    });
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it("renders children when no error", () => {
    render(
      <ErrorBoundary>
        <div>Hello World</div>
      </ErrorBoundary>
    );
    expect(screen.getByText("Hello World")).toBeDefined();
  });

  it("renders custom fallback on error", () => {
    render(
      <ErrorBoundary fallback={<div>Custom Error UI</div>}>
        <BrokenComponent shouldThrow={true} />
      </ErrorBoundary>
    );

    expect(screen.getByText("Custom Error UI")).toBeDefined();
  });

  it("renders default fallback on error", () => {
    render(
      <ErrorBoundary>
        <BrokenComponent shouldThrow={true} />
      </ErrorBoundary>
    );

    expect(screen.getByText("Something went wrong")).toBeDefined();
    expect(screen.getByText("Test error")).toBeDefined();
    expect(screen.getByText("Try Again")).toBeDefined();
  });

  it("renders segment-specific error title and reports with segment", () => {
    const onError = vi.fn();

    render(
      <ErrorBoundary segment="payments" onError={onError}>
        <BrokenComponent shouldThrow={true} />
      </ErrorBoundary>
    );

    expect(screen.getByText("Error in payments")).toBeDefined();
    expect(screen.getByTestId("error-boundary-payments")).toBeDefined();
    expect(onError).toHaveBeenCalled();
    expect(trackEventSpy).toHaveBeenCalledWith(
      "error_occurred",
      expect.objectContaining({
        segment: "payments",
        message: "Test error",
      })
    );
  });

  it("renders without error message when error has no message", () => {
    const ThrowEmpty = () => {
      throw new Error();
    };

    render(
      <ErrorBoundary>
        <ThrowEmpty />
      </ErrorBoundary>
    );

    expect(screen.getByText("An unexpected error occurred.")).toBeDefined();
  });

  it("resets state when Try Again is clicked", () => {
    let shouldThrow = true;
    function Flaky() {
      if (shouldThrow) throw new Error("Temporary crash");
      return <div>Recovered!</div>;
    }

    const { rerender } = render(
      <ErrorBoundary>
        <Flaky />
      </ErrorBoundary>
    );

    expect(screen.getByText("Temporary crash")).toBeDefined();

    shouldThrow = false;
    fireEvent.click(screen.getByText("Try Again"));
    rerender(
      <ErrorBoundary>
        <Flaky />
      </ErrorBoundary>
    );

    expect(screen.getByText("Recovered!")).toBeDefined();
  });
});

describe("SegmentError component", () => {
  const trackEventSpy = vi.fn();
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    _resetErrorReportState();
    _setTrackFnForTests(trackEventSpy as never);
    consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it("renders segment badge, title, message, and links", () => {
    const reset = vi.fn();
    const error = new Error("Failed to load chart data") as Error & {
      digest?: string;
    };
    error.digest = "err-999";

    render(
      <SegmentError
        segment="analytics"
        title="Analytics"
        error={error}
        reset={reset}
      />
    );

    expect(screen.getByTestId("segment-error-analytics")).toBeDefined();
    expect(screen.getByTestId("segment-badge").textContent).toBe("analytics");
    expect(screen.getByText("Failed to load Analytics")).toBeDefined();
    expect(screen.getByText("Failed to load chart data")).toBeDefined();
    expect(screen.getByText("Error digest: err-999")).toBeDefined();
    expect(screen.getByText("Back to Treasury")).toBeDefined();

    expect(trackEventSpy).toHaveBeenCalledWith(
      "error_occurred",
      expect.objectContaining({
        segment: "analytics",
        message: "Failed to load chart data",
      })
    );
  });

  it("invokes reset when Try Again button is clicked", () => {
    const reset = vi.fn();
    render(
      <SegmentError
        segment="batches"
        error={new Error("Batch fetch failed")}
        reset={reset}
      />
    );

    fireEvent.click(screen.getByText("Try Again"));
    expect(reset).toHaveBeenCalledOnce();
  });
});

describe("Route segment error pages", () => {
  const trackEventSpy = vi.fn();
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    _resetErrorReportState();
    _setTrackFnForTests(trackEventSpy as never);
    consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it("renders PaymentsError and tags report with payments segment", () => {
    const reset = vi.fn();
    render(<PaymentsError error={new Error("Payments failed")} reset={reset} />);

    expect(screen.getByTestId("segment-error-payments")).toBeDefined();
    expect(screen.getByText("Failed to load Payments")).toBeDefined();
    expect(trackEventSpy).toHaveBeenCalledWith(
      "error_occurred",
      expect.objectContaining({
        segment: "payments",
        message: "Payments failed",
      })
    );
  });

  it("renders BatchesError and tags report with batches segment", () => {
    const reset = vi.fn();
    render(<BatchesError error={new Error("Batches failed")} reset={reset} />);

    expect(screen.getByTestId("segment-error-batches")).toBeDefined();
    expect(screen.getByText("Failed to load Batches")).toBeDefined();
    expect(trackEventSpy).toHaveBeenCalledWith(
      "error_occurred",
      expect.objectContaining({
        segment: "batches",
        message: "Batches failed",
      })
    );
  });

  it("renders AuditLogError and tags report with audit-log segment", () => {
    const reset = vi.fn();
    render(<AuditLogError error={new Error("Audit log failed")} reset={reset} />);

    expect(screen.getByTestId("segment-error-audit-log")).toBeDefined();
    expect(screen.getByText("Failed to load Audit Log")).toBeDefined();
    expect(trackEventSpy).toHaveBeenCalledWith(
      "error_occurred",
      expect.objectContaining({
        segment: "audit-log",
        message: "Audit log failed",
      })
    );
  });

  it("renders AnalyticsError and tags report with analytics segment", () => {
    const reset = vi.fn();
    render(<AnalyticsError error={new Error("Analytics failed")} reset={reset} />);

    expect(screen.getByTestId("segment-error-analytics")).toBeDefined();
    expect(screen.getByText("Failed to load Analytics")).toBeDefined();
    expect(trackEventSpy).toHaveBeenCalledWith(
      "error_occurred",
      expect.objectContaining({
        segment: "analytics",
        message: "Analytics failed",
      })
    );
  });
});

describe("useErrorTracker hook with segment", () => {
  it("includes segment in error tracking extra payload", () => {
    const captureErrorSpy = vi.spyOn(sentryModule, "captureError").mockImplementation(() => {});

    const { result } = renderHook(() =>
      useErrorTracker("PaymentTable", "payments")
    );

    const err = new Error("Table render error");
    result.current.trackError(err, { rowId: 42 });

    expect(captureErrorSpy).toHaveBeenCalledWith(err, {
      component: "PaymentTable",
      extra: {
        rowId: 42,
        segment: "payments",
      },
    });

    captureErrorSpy.mockRestore();
  });
});
