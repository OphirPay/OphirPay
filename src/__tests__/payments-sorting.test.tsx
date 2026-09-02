// SPDX-License-Identifier: MIT

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
  type RenderResult,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import PaymentsPage from "@/app/payments/page";
import type { OnChainPayment } from "@/lib/contracts";

const replaceMock = vi.fn();
const fetchOnChainPaymentsMock = vi.fn();

let searchParams: URLSearchParams;

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    replace: replaceMock,
    push: vi.fn(),
    prefetch: vi.fn(),
  }),
  usePathname: () => "/payments",
  useSearchParams: () => searchParams,
}));

vi.mock("@/lib/contracts", () => ({
  // Lazy wrapper — vi.mock factories are hoisted, so the mock itself must be
  // referenced only when the mocked module is imported (at test time).
  fetchOnChainPayments: (...args: unknown[]) => fetchOnChainPaymentsMock(...args),
}));

const mockPayments = {
  payments: [
    {
      id: 1,
      payer: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      payee: "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
      amountStroops: 30000000, // 3 XLM
      txHash: "a".repeat(64),
      timestamp: 3000,
      metadata: "RECORDED",
    },
    {
      id: 2,
      payer: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      payee: "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
      amountStroops: 10000000, // 1 XLM
      txHash: "b".repeat(64),
      timestamp: 1000,
      metadata: "CANCELLED",
    },
    {
      id: 3,
      payer: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      payee: "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
      amountStroops: 20000000, // 2 XLM
      txHash: "c".repeat(64),
      timestamp: 2000,
      metadata: "RECORDED",
    },
  ] as OnChainPayment[],
  total: 3,
};

let queryClient: QueryClient;

function renderPage(): RenderResult {
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <PaymentsPage />
    </QueryClientProvider>
  );
}

function rerender(view: RenderResult) {
  view.rerender(
    <QueryClientProvider client={queryClient}>
      <PaymentsPage />
    </QueryClientProvider>
  );
}

/**
 * Click a sort header and simulate the resulting navigation: the real app
 * re-renders with the new URL search params, so we sync the mock params from
 * the `router.replace` call and re-render the tree.
 */
async function clickAndNavigate(view: RenderResult, button: HTMLElement) {
  fireEvent.click(button);
  const url = replaceMock.mock.calls.at(-1)?.[0] as string;
  searchParams = new URLSearchParams(url.split("?")[1] ?? "");
  rerender(view);
  await waitFor(() => expect(replaceMock.mock.calls.length).toBeGreaterThan(0));
}

async function rowIds(): Promise<string[]> {
  // Wait until the on-chain data has rendered — the loading skeleton row
  // has no "#<id>" cell.
  await waitFor(() => {
    const rows = screen.getAllByRole("row");
    const firstCell = within(rows[1]).queryAllByRole("cell")[0];
    expect(firstCell?.textContent).toMatch(/#\d+/);
  });
  const rows = await screen.findAllByRole("row");
  // Skip the header row; the first cell of each body row is "#<id>"
  const bodyRows = rows.slice(1);
  return bodyRows.map((row) => {
    const firstCell = within(row).getAllByRole("cell")[0];
    return firstCell.querySelector("p")?.textContent ?? "";
  });
}

beforeEach(() => {
  replaceMock.mockClear();
  fetchOnChainPaymentsMock.mockClear();
  fetchOnChainPaymentsMock.mockResolvedValue(mockPayments);
  searchParams = new URLSearchParams("");
});

describe("PaymentsPage sorting", () => {
  it("fetches the full on-chain dataset so sorting covers every record", async () => {
    renderPage();
    await screen.findAllByRole("row");

    // Sorting/pagination are client-side — a recent-slice fetch would exclude
    // older records from sorted views.
    expect(fetchOnChainPaymentsMock).toHaveBeenCalledWith(
      Number.MAX_SAFE_INTEGER
    );
  });

  it("sorts by amount ascending on first header click and persists to the URL", async () => {
    const view = renderPage();
    await screen.findAllByRole("row");

    await clickAndNavigate(view, screen.getByRole("button", { name: /sort by amount/i }));

    expect(replaceMock).toHaveBeenCalledWith("/payments?sort=amount&dir=asc", {
      scroll: false,
    });
    // Sorted asc: 1 XLM (id 2), 2 XLM (id 3), 3 XLM (id 1)
    expect(await rowIds()).toEqual(["#2", "#3", "#1"]);
  });

  it("toggles to descending on the second click", async () => {
    const view = renderPage();
    await screen.findAllByRole("row");

    const button = screen.getByRole("button", { name: /sort by amount/i });
    await clickAndNavigate(view, button);
    await clickAndNavigate(view, button);

    expect(replaceMock).toHaveBeenLastCalledWith(
      "/payments?sort=amount&dir=desc",
      { scroll: false }
    );
    expect(await rowIds()).toEqual(["#1", "#3", "#2"]);
  });

  it("clears the sort on the third click", async () => {
    const view = renderPage();
    await screen.findAllByRole("row");

    const button = screen.getByRole("button", { name: /sort by amount/i });
    await clickAndNavigate(view, button);
    await clickAndNavigate(view, button);
    await clickAndNavigate(view, button);

    expect(replaceMock).toHaveBeenLastCalledWith("/payments", { scroll: false });
  });

  it("switching columns starts at ascending", async () => {
    const view = renderPage();
    await screen.findAllByRole("row");

    const amount = screen.getByRole("button", { name: /sort by amount/i });
    await clickAndNavigate(view, amount);
    await clickAndNavigate(view, amount); // amount desc

    await clickAndNavigate(view, screen.getByRole("button", { name: /sort by date/i }));
    expect(replaceMock).toHaveBeenLastCalledWith("/payments?sort=date&dir=asc", {
      scroll: false,
    });
  });

  it("sorts by status", async () => {
    const view = renderPage();
    await screen.findAllByRole("row");

    await clickAndNavigate(view, screen.getByRole("button", { name: /sort by status/i }));

    expect(await rowIds()).toEqual(["#2", "#1", "#3"]);
  });

  it("round-trips sort params from the URL on initial render", async () => {
    searchParams = new URLSearchParams("sort=amount&dir=desc&page=1");
    renderPage();

    // Amount desc: 3 XLM (id 1), 2 XLM (id 3), 1 XLM (id 2)
    expect(await rowIds()).toEqual(["#1", "#3", "#2"]);

    // Header reflects the active descending state
    expect(screen.getByRole("columnheader", { name: /amount/i })).toHaveAttribute(
      "aria-sort",
      "descending"
    );
  });

  it("resets to page 1 when the sort changes", async () => {
    searchParams = new URLSearchParams("page=2");
    const view = renderPage();
    await screen.findAllByRole("row");

    await clickAndNavigate(view, screen.getByRole("button", { name: /sort by date/i }));

    expect(replaceMock).toHaveBeenCalledWith("/payments?sort=date&dir=asc", {
      scroll: false,
    });
  });

  it("ignores an invalid sort key in the URL", async () => {
    searchParams = new URLSearchParams("sort=payer&dir=desc");
    renderPage();

    // Falls back to the original insertion order
    expect(await rowIds()).toEqual(["#1", "#2", "#3"]);
  });
});
