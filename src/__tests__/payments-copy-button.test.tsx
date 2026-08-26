// SPDX-License-Identifier: MIT

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import PaymentsPage from "@/app/payments/page";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/payments",
  useSearchParams: () => new URLSearchParams(""),
}));

// The real app wraps every page in MultiWalletProvider (see AppShell), but the
// provider performs async wallet detection and session setup. Mocking the hook
// keeps this test focused and deterministic. Disconnected is the default here.
const walletState = { publicKey: null as string | null };
vi.mock("@/hooks/useMultiWallet", () => ({
  useWallet: () => ({ wallet: walletState, fetchBalance: vi.fn() }),
}));

vi.mock("@/lib/contracts", () => ({
  fetchOnChainPayments: vi.fn().mockResolvedValue({
    payments: [
      {
        id: 1,
        payer: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
        payee: "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
        amountStroops: 10000000,
        txHash:
          "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
        timestamp: 1700000000,
      },
    ],
    total: 1,
  }),
}));

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <PaymentsPage />
    </QueryClientProvider>
  );
}

describe("PaymentsPage", () => {
  it("renders a copy button next to each transaction hash", async () => {
    renderPage();

    const copyButtons = await screen.findAllByRole("button", {
      name: /copy hash/i,
    });

    expect(copyButtons.length).toBeGreaterThan(0);
  });

  it("renders a page size selector defaulting to 25", async () => {
    renderPage();

    const select = await screen.findByRole("combobox", { name: /page size/i });
    expect(select).toHaveValue("25");
  });
});

describe("PaymentsPage CSV export", () => {
  it("offers a client-side export button when no wallet is connected", async () => {
    // The export endpoint is authenticated; pointing an anonymous visitor at it
    // would return 401 where they previously got a file.
    walletState.publicKey = null;
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={client}>
        <PaymentsPage />
      </QueryClientProvider>
    );
    const control = await screen.findByTitle(/export the payments shown here/i);
    expect(control.tagName).toBe("BUTTON");
  });

  it("links to the server-side export when a wallet is connected", async () => {
    walletState.publicKey = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={client}>
        <PaymentsPage />
      </QueryClientProvider>
    );
    const control = await screen.findByTitle(/export all payments/i);
    expect(control.tagName).toBe("A");
    expect(control.getAttribute("href")).toContain("/api/payments/export");
    walletState.publicKey = null;
  });
});
