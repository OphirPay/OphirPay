// SPDX-License-Identifier: MIT

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ToastProvider } from "@/components/ui/Toast";
import BatchesPage from "@/app/batches/page";
import RecurringPage from "@/app/recurring/page";
import * as priceModule from "@/lib/price";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/batches",
  useSearchParams: () => new URLSearchParams(""),
  useParams: () => ({ id: "batch-123" }),
}));

vi.mock("@/lib/events/event-client", () => ({
  connectLiveEvents: vi.fn().mockReturnValue(() => {}),
}));

vi.mock("@/hooks/useMultiWallet", () => ({
  useWallet: () => ({
    wallet: {
      connected: true,
      publicKey: "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
      network: "TESTNET",
      balance: "50.00",
      balanceLoading: false,
    },
    fetchBalance: vi.fn(),
  }),
}));

function renderWithProviders(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        {ui}
      </ToastProvider>
    </QueryClientProvider>
  );
}

describe("Batches and Recurring Views - Currency Toggle & Conversion", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  describe("BatchesPage Currency Toggle", () => {
    it("renders CurrencyToggle and toggles currency preference", async () => {
      vi.spyOn(priceModule, "fetchXlmPrice").mockResolvedValue({
        price: 0.15,
        source: "coingecko",
      });

      // Mock batches fetch
      global.fetch = vi.fn().mockImplementation((url: string) => {
        if (url.includes("/api/batches/summary")) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({
              counts: { total: 0, CREATED: 0, PROCESSING: 0, PARTIALLY_COMPLETED: 0, COMPLETED: 0, FAILED: 0 },
              progress: { total: 0, completed: 0, failed: 0, pending: 0 },
              batches: [],
            }),
          });
        }
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            data: [],
            meta: { total: 0 },
          }),
        });
      });

      renderWithProviders(<BatchesPage />);

      const xlmBtn = await screen.findByRole("button", {
        name: /display amounts in xlm/i,
      });
      const usdBtn = await screen.findByRole("button", {
        name: /display amounts in usd/i,
      });

      expect(xlmBtn).toHaveAttribute("aria-pressed", "true");
      expect(usdBtn).toHaveAttribute("aria-pressed", "false");

      fireEvent.click(usdBtn);

      await waitFor(() => {
        expect(usdBtn).toHaveAttribute("aria-pressed", "true");
      });

      expect(JSON.parse(window.localStorage.getItem("ophirpay-currency-display") || '""')).toBe("USD");
    });
  });

  describe("RecurringPage Currency Toggle & Amount Conversion", () => {
    it("renders amounts in XLM and converts to USD when toggle is clicked", async () => {
      vi.spyOn(priceModule, "fetchXlmPrice").mockResolvedValue({
        price: 0.20, // 100 XLM * $0.20 = $20.00
        source: "coinbase",
      });

      global.fetch = vi.fn().mockImplementation((url: string) => {
        if (url.includes("/api/recurring")) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({
              data: [
                {
                  id: "rec-1",
                  name: "Weekly Dev Salary",
                  frequency: "WEEKLY",
                  amount: "100",
                  assetCode: "XLM",
                  destAddress: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
                  description: "Dev stipend",
                  isActive: true,
                  nextRunAt: new Date(Date.now() + 86400000).toISOString(),
                  lastRunAt: null,
                  createdAt: new Date().toISOString(),
                },
              ],
            }),
          });
        }
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ data: [] }),
        });
      });

      renderWithProviders(<RecurringPage />);

      // Verify raw XLM amount is visible initially
      expect(await screen.findByText("100.00 XLM")).toBeInTheDocument();

      const usdBtn = await screen.findByRole("button", {
        name: /display amounts in usd/i,
      });

      fireEvent.click(usdBtn);

      await waitFor(() => {
        expect(screen.getByText("~$20.00")).toBeInTheDocument();
        expect(screen.getByText("100.00 XLM")).toBeInTheDocument();
      });
    });

    it("displays graceful fallback when price is unavailable in USD mode", async () => {
      vi.spyOn(priceModule, "fetchXlmPrice").mockResolvedValue({
        price: null,
        source: null,
        error: "Feeds down",
      });

      // Preset localStorage to USD
      window.localStorage.setItem("ophirpay-currency-display", JSON.stringify("USD"));

      global.fetch = vi.fn().mockImplementation((url: string) => {
        if (url.includes("/api/recurring")) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({
              data: [
                {
                  id: "rec-2",
                  name: "DAO Reward",
                  frequency: "MONTHLY",
                  amount: "50",
                  assetCode: "XLM",
                  destAddress: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
                  isActive: true,
                  nextRunAt: new Date(Date.now() + 86400000).toISOString(),
                  lastRunAt: null,
                  createdAt: new Date().toISOString(),
                },
              ],
            }),
          });
        }
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ data: [] }),
        });
      });

      renderWithProviders(<RecurringPage />);

      await waitFor(() => {
        expect(screen.getByText("50.00 XLM")).toBeInTheDocument();
        expect(screen.getByText("(USD unavailable)")).toBeInTheDocument();
      });
    });
  });
});
