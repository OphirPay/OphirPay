// SPDX-License-Identifier: MIT

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { NetworkStatusBanner } from "@/components/NetworkStatusBanner";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { reportGlobalRpcMetric } from "@/hooks/useRpcHealth";

describe("NetworkStatusBanner component (issue #1295)", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("is hidden when RPC condition is healthy", () => {
    render(<NetworkStatusBanner options={{ enabled: false }} />);
    expect(screen.queryByTestId("network-status-banner")).toBeNull();
  });

  it("renders warning banner with active endpoint and estimated latency when degraded", () => {
    render(
      <NetworkStatusBanner
        forceDegraded={true}
        forceActiveEndpoint="https://soroban-testnet.stellar.org:443"
        forceLatencyMs={3450}
        forceStatusReason="High response time (3450ms > 3000ms)"
      />
    );

    const banner = screen.getByTestId("network-status-banner");
    expect(banner).toBeDefined();
    expect(banner.getAttribute("role")).toBe("status");
    expect(banner.getAttribute("aria-live")).toBe("polite");

    const endpointEl = screen.getByTestId("active-endpoint");
    expect(endpointEl.textContent).toContain("soroban-testnet");

    const latencyEl = screen.getByTestId("estimated-latency");
    expect(latencyEl.textContent).toContain("3450ms");

    expect(screen.getByText(/High response time/i)).toBeDefined();
  });

  it("renders warning when rate limited (HTTP 429)", () => {
    render(
      <NetworkStatusBanner
        forceDegraded={true}
        forceActiveEndpoint="https://soroban.stellar.org:443"
        forceLatencyMs={150}
        forceStatusReason="Rate limited (HTTP 429)"
      />
    );

    expect(screen.getByText(/Rate limited \(HTTP 429\)/i)).toBeDefined();
    expect(screen.getByTestId("active-endpoint")).toBeDefined();
  });

  it("auto-clears banner when healthy response resumes via hook updates", () => {
    render(<NetworkStatusBanner options={{ enabled: false }} />);
    expect(screen.queryByTestId("network-status-banner")).toBeNull();

    // Trigger degradation
    act(() => {
      reportGlobalRpcMetric({
        endpoint: "https://soroban.stellar.org:443",
        latencyMs: 3800,
        status: 200,
      });
    });

    expect(screen.getByTestId("network-status-banner")).toBeDefined();
    expect(screen.getByTestId("estimated-latency").textContent).toContain("3800ms");

    // Healthy response resumes
    act(() => {
      reportGlobalRpcMetric({
        endpoint: "https://soroban.stellar.org:443",
        latencyMs: 120,
        status: 200,
      });
    });

    // Auto-clears
    expect(screen.queryByTestId("network-status-banner")).toBeNull();
  });

  it("allows user to dismiss the banner via dismiss button", () => {
    render(
      <NetworkStatusBanner
        options={{
          enabled: false,
          initialState: {
            isDegraded: true,
            statusReason: "Transient error",
            activeEndpoint: "https://soroban.stellar.org:443",
            latencyMs: 3100,
          },
        }}
      />
    );

    expect(screen.getByTestId("network-status-banner")).toBeDefined();

    const dismissBtn = screen.getByTestId("banner-dismiss-btn");
    fireEvent.click(dismissBtn);

    expect(screen.queryByTestId("network-status-banner")).toBeNull();
  });

  it("does not interfere with ErrorBoundary", () => {
    // Suppress console.error from intentional error in child component
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    function FaultyComponent(): React.ReactNode {
      throw new Error("Simulated page crash");
    }

    render(
      <div>
        <NetworkStatusBanner
          forceDegraded={true}
          forceActiveEndpoint="https://soroban.stellar.org:443"
          forceLatencyMs={3200}
        />
        <ErrorBoundary segment="payments">
          <FaultyComponent />
        </ErrorBoundary>
      </div>
    );

    // Both the banner and the error boundary should coexist peacefully
    expect(screen.getByTestId("network-status-banner")).toBeDefined();
    expect(screen.getByText(/Something went wrong/i)).toBeDefined();
    expect(screen.getByText("Simulated page crash")).toBeDefined();

    consoleSpy.mockRestore();
  });
});
