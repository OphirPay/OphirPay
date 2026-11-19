// SPDX-License-Identifier: MIT

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NetworkStatusBanner } from "@/components/NetworkStatusBanner";

const PRIMARY = "https://soroban-testnet.stellar.org:443";
const FALLBACK = "https://rpc-futurenet.stellar.org:443";

function healthPayload({
  latencyMs = 120,
  activeEndpoint = PRIMARY,
  usingFallback = false,
}: {
  latencyMs?: number;
  activeEndpoint?: string;
  usingFallback?: boolean;
} = {}) {
  return {
    success: true,
    data: {
      services: {
        stellar: {
          rpcUrl: PRIMARY,
          rpc: { status: "ok", latencyMs },
        },
      },
      rpcFailover: {
        activeEndpoint,
        primaryEndpoint: PRIMARY,
        activeProviderName: new URL(activeEndpoint).host,
        usingFallback,
      },
    },
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("NetworkStatusBanner", () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  it("stays hidden while RPC is healthy", async () => {
    fetchMock.mockResolvedValue(jsonResponse(healthPayload()));

    render(<NetworkStatusBanner />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(screen.queryByTestId("network-status-banner")).toBeNull();
  });

  it("shows the active provider and measured latency when slow", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(healthPayload({ latencyMs: 5200 }))
    );

    render(<NetworkStatusBanner />);

    const banner = await screen.findByTestId("network-status-banner");
    expect(banner).toHaveTextContent("Stellar network is slow");
    expect(screen.getByTestId("network-status-endpoint")).toHaveTextContent(
      "soroban-testnet.stellar.org"
    );
    expect(screen.getByTestId("network-status-latency")).toHaveTextContent(
      "~5,200 ms"
    );
    expect(banner).toHaveAttribute("role", "status");
  });

  it("shows the failover provider when a fallback endpoint is active", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(
        healthPayload({
          latencyMs: 4800,
          activeEndpoint: FALLBACK,
          usingFallback: true,
        })
      )
    );

    render(<NetworkStatusBanner />);

    const banner = await screen.findByTestId("network-status-banner");
    expect(banner).toHaveTextContent("rpc-futurenet.stellar.org");
    expect(banner).toHaveTextContent("failover provider active");
    expect(banner).toHaveAttribute("data-using-fallback", "true");
  });

  it("shows an unavailable state on 429 and clears after recovery", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ success: false }, 429))
      .mockResolvedValue(jsonResponse(healthPayload({ latencyMs: 75 })));

    const user = userEvent.setup();
    render(<NetworkStatusBanner />);

    const banner = await screen.findByTestId("network-status-banner");
    expect(banner).toHaveTextContent("Stellar RPC is unavailable");

    await user.click(
      screen.getByRole("button", { name: "Recheck RPC health" })
    );

    await waitFor(() =>
      expect(screen.queryByTestId("network-status-banner")).toBeNull()
    );
  });
});
