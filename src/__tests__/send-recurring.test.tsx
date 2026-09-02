// SPDX-License-Identifier: MIT

import type React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import SendPage from "@/app/send/page";

const VALID_ADDRESS = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const SENDER = "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";

const { mockUseSearchParams, mockMutateAsync } = vi.hoisted(() => ({
  mockUseSearchParams: vi.fn(() => new URLSearchParams("")),
  mockMutateAsync: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/send",
  useSearchParams: mockUseSearchParams,
}));

vi.mock("@/hooks/useMultiWallet", () => ({
  useWallet: () => ({
    wallet: { connected: true, publicKey: SENDER },
    fetchBalance: vi.fn(),
  }),
}));

vi.mock("@/lib/wallets", () => ({
  getWalletConnector: vi.fn(),
}));

vi.mock("@/lib/stellar", () => ({
  isValidStellarAddress: (addr: string) => /^G[A-Z0-9]{55}$/.test(addr),
  buildPaymentTx: vi.fn(),
  submitSignedTx: vi.fn(),
  getStellarExplorerUrl: vi.fn(),
  NETWORK_PASSPHRASE: "Test SDF Network ; September 2015",
  STELLAR_NETWORK: "TESTNET",
  XLM_STROOPS: 10000000,
}));

vi.mock("@/lib/contracts", () => ({
  recordPaymentOnChain: vi.fn(),
}));

vi.mock("@/lib/fee-estimator", () => ({
  estimateTransactionFee: vi.fn().mockResolvedValue({
    baseFee: "100",
    networkCongestion: "low",
  }),
}));

vi.mock("@/components/ui/Toast", () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}));

vi.mock("@/components/ui/CopyButton", () => ({
  CopyButton: () => null,
}));

vi.mock("@/hooks/useApiQuery", () => ({
  useApiMutation: () => ({ mutateAsync: mockMutateAsync, isPending: false }),
}));

vi.mock("@/components/AssetSelector", () => ({
  AssetSelector: () => null,
}));

vi.mock("next/link", () => {
  const Link = ({
    children,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a {...props}>{children}</a>
  );
  return { __esModule: true, default: Link };
});

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <SendPage />
    </QueryClientProvider>
  );
}

describe("SendPage recurring mode", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMutateAsync.mockResolvedValue({ id: "rec_new", nextRunAt: "2026-10-01T00:00:00.000Z" });
  });

  it("offers a recurring mode with a frequency picker and next-run preview", async () => {
    renderPage();
    fireEvent.click(screen.getByTestId("mode-recurring"));
    fireEvent.change(screen.getByPlaceholderText(/G\.\.\./i), {
      target: { value: VALID_ADDRESS },
    });
    fireEvent.change(screen.getByPlaceholderText("0.00"), {
      target: { value: "50" },
    });
    expect(screen.getByTestId("frequency-input")).toBeTruthy();
    expect(screen.getByTestId("next-run-preview")).toBeTruthy();
    expect(screen.getByText(/Schedule Recurring/i)).toBeTruthy();
  });

  it("creates a DB recurrence when scheduled (not a live one-time send)", async () => {
    renderPage();
    fireEvent.click(screen.getByTestId("mode-recurring"));
    fireEvent.change(screen.getByPlaceholderText(/G\.\.\./i), {
      target: { value: VALID_ADDRESS },
    });
    fireEvent.change(screen.getByPlaceholderText("0.00"), {
      target: { value: "50" },
    });
    fireEvent.change(screen.getByTestId("frequency-input"), {
      target: { value: "WEEKLY" },
    });
    fireEvent.change(screen.getByPlaceholderText(/e\.g\. Payment for services/i), {
      target: { value: "Weekly rent" },
    });

    fireEvent.click(screen.getByTestId("send-btn"));

    await waitFor(() => {
      expect(mockMutateAsync).toHaveBeenCalled();
    });
    const body = mockMutateAsync.mock.calls[0][0];
    expect(body.destAddress).toBe(VALID_ADDRESS);
    expect(body.amount).toBe(50);
    expect(body.frequency).toBe("WEEKLY");
    expect(body.assetCode).toBe("XLM");
    expect(body.sourceAccountId).toBe(SENDER);
    expect(body.description).toBe("Weekly rent");
  });

  it("requires a valid destination before scheduling", async () => {
    renderPage();
    fireEvent.click(screen.getByTestId("mode-recurring"));
    fireEvent.change(screen.getByPlaceholderText(/G\.\.\./i), {
      target: { value: "bad-address" },
    });
    fireEvent.change(screen.getByPlaceholderText("0.00"), {
      target: { value: "50" },
    });
    fireEvent.click(screen.getByTestId("send-btn"));
    expect(screen.getByText(/invalid stellar address/i)).toBeTruthy();
    expect(mockMutateAsync).not.toHaveBeenCalled();
  });
});
