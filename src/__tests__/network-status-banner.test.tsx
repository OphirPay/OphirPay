// SPDX-License-Identifier: MIT
// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import {
  DEGRADED_LATENCY_THRESHOLD_MS,
  evaluateRpcHealthSnapshot,
  useRpcHealth,
} from "@/hooks/useRpcHealth";
import { NetworkStatusBanner } from "@/components/NetworkStatusBanner";

describe("RPC health status evaluator and banner (#1295)", () => {

  describe("evaluateRpcHealthSnapshot", () => {
    it("marks RPC healthy when latency is <= 3000ms and HTTP 200", () => {
      const status = evaluateRpcHealthSnapshot({
        latencyMs: 420,
        httpStatus: 200,
        activeEndpoint: "https://soroban-testnet.stellar.org:443",
        usingFallback: false,
      });

      expect(status.degraded).toBe(false);
      expect(status.reason).toBeNull();
      expect(status.activeEndpoint).toBe("https://soroban-testnet.stellar.org:443");
      expect(status.latencyMs).toBe(420);
    });

    it("marks RPC degraded when response latency exceeds 3000ms", () => {
      const status = evaluateRpcHealthSnapshot({
        latencyMs: DEGRADED_LATENCY_THRESHOLD_MS + 450,
        httpStatus: 200,
        activeEndpoint: "https://soroban-testnet.stellar.org:443",
      });

      expect(status.degraded).toBe(true);
      expect(status.reason).toContain("High RPC latency (3450ms)");
    });

    it("marks RPC degraded on HTTP 429 rate limiting and HTTP 503 service errors", () => {
      const rateLimited = evaluateRpcHealthSnapshot({
        latencyMs: 120,
        httpStatus: 429,
        activeEndpoint: "https://soroban-testnet.stellar.org:443",
      });
      expect(rateLimited.degraded).toBe(true);
      expect(rateLimited.reason).toContain("HTTP 429");

      const unavailable = evaluateRpcHealthSnapshot({
        latencyMs: 250,
        httpStatus: 503,
        activeEndpoint: "https://soroban-testnet.stellar.org:443",
      });
      expect(unavailable.degraded).toBe(true);
      expect(unavailable.reason).toContain("HTTP 503");
    });

    it("marks RPC degraded when serving from a failover provider", () => {
      const status = evaluateRpcHealthSnapshot({
        latencyMs: 310,
        httpStatus: 200,
        activeEndpoint: "https://rpc-fallback.stellar.org:443",
        usingFallback: true,
      });

      expect(status.degraded).toBe(true);
      expect(status.usingFallback).toBe(true);
      expect(status.reason).toContain("Failover RPC provider active");
    });
  });

  describe("NetworkStatusBanner component", () => {
    it("renders nothing when RPC health is normal", () => {
      const { container } = render(
        <NetworkStatusBanner
          healthOverride={{
            degraded: false,
            activeEndpoint: "https://soroban-testnet.stellar.org:443",
            latencyMs: 180,
            httpStatus: 200,
            usingFallback: false,
            reason: null,
          }}
        />,
      );

      expect(container.firstChild).toBeNull();
      expect(screen.queryByTestId("network-status-banner")).toBeNull();
    });

    it("renders warning banner with active provider and latency when degraded, and clears when healthy", () => {
      const { rerender } = render(
        <NetworkStatusBanner
          healthOverride={{
            degraded: true,
            activeEndpoint: "https://rpc-backup.stellar.org:443",
            latencyMs: 3820,
            httpStatus: 200,
            usingFallback: true,
            reason: "High RPC latency (3820ms)",
          }}
        />,
      );

      const banner = screen.getByTestId("network-status-banner");
      expect(banner).toBeDefined();
      expect(screen.getByTestId("rpc-active-endpoint").textContent).toContain(
        "https://rpc-backup.stellar.org:443",
      );
      expect(screen.getByTestId("rpc-estimated-latency").textContent).toContain("3820ms");
      expect(banner.textContent).toContain("High RPC latency (3820ms)");

      // Automatically clears when healthy responses resume
      rerender(
        <NetworkStatusBanner
          healthOverride={{
            degraded: false,
            activeEndpoint: "https://soroban-testnet.stellar.org:443",
            latencyMs: 210,
            httpStatus: 200,
            usingFallback: false,
            reason: null,
          }}
        />,
      );

      expect(screen.queryByTestId("network-status-banner")).toBeNull();
    });

    it("allows manual dismissal of the warning banner", () => {
      render(
        <NetworkStatusBanner
          healthOverride={{
            degraded: true,
            activeEndpoint: "https://soroban-testnet.stellar.org:443",
            latencyMs: 4100,
            httpStatus: 503,
            usingFallback: false,
            reason: "RPC endpoint error (HTTP 503)",
          }}
        />,
      );

      expect(screen.getByTestId("network-status-banner")).toBeDefined();
      fireEvent.click(screen.getByRole("button", { name: /dismiss network status warning/i }));
      expect(screen.queryByTestId("network-status-banner")).toBeNull();
    });

    it("polls /api/health via useRpcHealth and updates banner on degraded vs healthy responses", async () => {
      let respondDegraded = true;
      const mockFetch = vi.fn().mockImplementation(async () => ({
        status: respondDegraded ? 503 : 200,
        json: async () => ({
          data: {
            status: respondDegraded ? "degraded" : "ok",
            services: {
              stellar: {
                rpcUrl: "https://soroban-testnet.stellar.org:443",
                rpc: {
                  status: respondDegraded ? "error" : "ok",
                  latencyMs: respondDegraded ? 3600 : 190,
                },
              },
            },
          },
        }),
      })) as unknown as typeof fetch;

      function ProbeHarness() {
        const health = useRpcHealth({
          pollIntervalMs: 50,
          fetchImpl: mockFetch,
        });
        return <NetworkStatusBanner healthOverride={health} />;
      }

      render(<ProbeHarness />);

      await waitFor(() => {
        expect(screen.getByTestId("network-status-banner")).toBeDefined();
      });
      expect(screen.getByTestId("rpc-estimated-latency").textContent).toContain("3600ms");

      respondDegraded = false;

      await waitFor(() => {
        expect(screen.queryByTestId("network-status-banner")).toBeNull();
      });
    });
  });
});
