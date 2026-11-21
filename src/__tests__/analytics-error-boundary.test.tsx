// SPDX-License-Identifier: MIT

import { fireEvent,render, screen } from "@testing-library/react";
import { useState } from "react";
import { beforeEach,describe, expect, it, vi } from "vitest";

import { ErrorBoundary, WidgetErrorFallback } from "@/components/ErrorBoundary";

vi.mock("@/lib/sentry", () => ({
  captureError: vi.fn(),
}));

function FailingChartWidget({ shouldFail }: { shouldFail: boolean }) {
  if (shouldFail) {
    throw new Error("Chart data corruption");
  }
  return <div data-testid="chart-content">Daily Volume Chart OK</div>;
}

describe("Granular ErrorBoundary for analytics widgets (#1911)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("isolates a failing chart widget with a localized fallback card and Retry button while sibling widgets remain interactive", () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    function DashboardHarness() {
      const [failChart, setFailChart] = useState(true);
      const [counter, setCounter] = useState(0);

      return (
        <div>
          <ErrorBoundary
            segment="analytics-daily-volume"
            onRetry={() => setFailChart(false)}
            fallback={({ error, reset }) => (
              <WidgetErrorFallback
                title="Daily Volume Chart Unavailable"
                error={error}
                onRetry={reset}
              />
            )}
          >
            <FailingChartWidget shouldFail={failChart} />
          </ErrorBoundary>

          <ErrorBoundary segment="analytics-summary">
            <div data-testid="sibling-widget">
              <span>Summary Widget Active ({counter})</span>
              <button
                type="button"
                onClick={() => setCounter((c) => c + 1)}
              >
                Interact With Summary
              </button>
            </div>
          </ErrorBoundary>
        </div>
      );
    }

    render(<DashboardHarness />);

    // Failing chart renders isolated fallback card with Retry button
    const fallback = screen.getByTestId("widget-error-fallback");
    expect(fallback).toHaveTextContent("Daily Volume Chart Unavailable");
    expect(fallback).toHaveTextContent("Chart data corruption");
    expect(screen.queryByTestId("chart-content")).toBeNull();

    // Rest of dashboard remains mounted and interactive
    expect(screen.getByTestId("sibling-widget")).toHaveTextContent(
      "Summary Widget Active (0)"
    );
    fireEvent.click(screen.getByRole("button", { name: "Interact With Summary" }));
    expect(screen.getByTestId("sibling-widget")).toHaveTextContent(
      "Summary Widget Active (1)"
    );

    // Clicking Retry resets the localized boundary and renders the recovered chart
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(screen.getByTestId("chart-content")).toHaveTextContent(
      "Daily Volume Chart OK"
    );

    consoleErrorSpy.mockRestore();
  });
});
