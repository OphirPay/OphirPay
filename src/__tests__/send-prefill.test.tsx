// SPDX-License-Identifier: MIT

import type React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import SendPage from "@/app/send/page";

const VALID_ADDRESS = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

const { mockUseSearchParams } = vi.hoisted(() => ({
  mockUseSearchParams: vi.fn(() => new URLSearchParams("")),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/send",
  useSearchParams: mockUseSearchParams,
}));

vi.mock("@/hooks/useMultiWallet", () => ({
  useWallet: () => ({
    wallet: {
      connected: true,
      publicKey: "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
      network: "TESTNET",
    },
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
  useToast: () => ({
    success: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock("@/components/ui/CopyButton", () => ({
  CopyButton: () => null,
}));

vi.mock("@/hooks/useApiQuery", () => ({
  useApiMutation: () => ({
    mutateAsync: vi.fn(),
    isPending: false,
  }),
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

function renderPage(searchParams: string) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  // Override the mocked useSearchParams for this render.
  mockUseSearchParams.mockReturnValue(new URLSearchParams(searchParams));
  return render(
    <QueryClientProvider client={queryClient}>
      <SendPage />
    </QueryClientProvider>
  );
}

describe("SendPage prefill", () => {
  it("pre-fills the destination from a payment link", async () => {
    renderPage(`dest=${VALID_ADDRESS}&amount=10.5&memo=invoice-42`);
    const destInput = await screen.findByPlaceholderText(/G\.\.\./i);
    expect(destInput).toHaveValue(VALID_ADDRESS);
  });

  it("pre-fills the amount from a payment link", async () => {
    renderPage(`dest=${VALID_ADDRESS}&amount=10.5`);
    const amountInput = await screen.findByPlaceholderText("0.00");
    expect(amountInput).toHaveValue(10.5);
  });

  it("shows a clear error for an invalid address in the link", async () => {
    renderPage("dest=not-a-valid-address");
    const error = await screen.findByText(/invalid stellar address in payment link/i);
    expect(error).toBeTruthy();
  });
});
