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
import { ToastProvider } from "@/components/ui/Toast";
import PaymentsPage from "@/app/payments/page";
import {
  parsePaymentQueryParams,
  buildShareablePaymentQuery,
} from "@/lib/payment-filters";
import type { OnChainPayment } from "@/lib/contracts";

const replaceMock = vi.fn();
const fetchOnChainPaymentsMock = vi.fn();
let mockSearchParams: URLSearchParams;

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    replace: replaceMock,
    push: vi.fn(),
    prefetch: vi.fn(),
  }),
  usePathname: () => "/payments",
  useSearchParams: () => mockSearchParams,
}));

vi.mock("@/lib/contracts", () => ({
  fetchOnChainPayments: (...args: unknown[]) => fetchOnChainPaymentsMock(...args),
}));

const mockPaymentsData: { payments: OnChainPayment[]; total: number } = {
  payments: [
    {
      id: 1,
      payer: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      payee: "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
      amountStroops: 30000000, // 3 XLM
      txHash: "a".repeat(64),
      timestamp: 1700000000,
      metadata: "RECORDED",
      assetCode: "XLM",
    },
    {
      id: 2,
      payer: "GCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC",
      payee: "GDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD",
      amountStroops: 10000000, // 1 XLM
      txHash: "b".repeat(64),
      timestamp: 1600000000,
      metadata: "CANCELLED",
      assetCode: "USDC",
    },
    {
      id: 3,
      payer: "GEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEE",
      payee: "GFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF",
      amountStroops: 20000000, // 2 XLM
      txHash: "c".repeat(64),
      timestamp: 1650000000,
      metadata: "RECORDED",
      assetCode: "XLM",
    },
  ],
  total: 3,
};

let queryClient: QueryClient;

function renderPage(): RenderResult {
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <PaymentsPage />
      </ToastProvider>
    </QueryClientProvider>
  );
}

function rerenderPage(view: RenderResult) {
  view.rerender(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <PaymentsPage />
      </ToastProvider>
    </QueryClientProvider>
  );
}

async function getVisibleRowIds(): Promise<string[]> {
  await waitFor(() => {
    const rows = screen.getAllByRole("row");
    expect(rows.length).toBeGreaterThan(1);
  });
  const rows = await screen.findAllByRole("row");
  const bodyRows = rows.slice(1);
  return bodyRows
    .map((row) => {
      const firstCell = within(row).queryAllByRole("cell")[0];
      return firstCell?.querySelector("p")?.textContent ?? "";
    })
    .filter(Boolean);
}

beforeEach(() => {
  replaceMock.mockClear();
  fetchOnChainPaymentsMock.mockClear();
  fetchOnChainPaymentsMock.mockResolvedValue(mockPaymentsData);
  mockSearchParams = new URLSearchParams("");
});

describe("Payment Query Params Parsing & Validation (Issue #792)", () => {
  it("extracts search from either ?search= or legacy ?q=", () => {
    const fromSearch = parsePaymentQueryParams(new URLSearchParams("search=stellar"));
    expect(fromSearch.search).toBe("stellar");

    const fromQ = parsePaymentQueryParams(new URLSearchParams("q=crypto"));
    expect(fromQ.search).toBe("crypto");

    const searchPrecedence = parsePaymentQueryParams(new URLSearchParams("search=primary&q=fallback"));
    expect(searchPrecedence.search).toBe("primary");
  });

  it("validates status and catches invalid values with fallback and warning", () => {
    const valid = parsePaymentQueryParams(new URLSearchParams("status=CANCELLED"));
    expect(valid.status).toBe("CANCELLED");
    expect(valid.invalidParams).toHaveLength(0);

    const invalid = parsePaymentQueryParams(new URLSearchParams("status=UNKNOWN_STATUS"));
    expect(invalid.status).toBe("");
    expect(invalid.invalidParams).toContainEqual(
      expect.objectContaining({ param: "status", value: "UNKNOWN_STATUS" })
    );
  });

  it("validates asset and catches invalid values", () => {
    const valid = parsePaymentQueryParams(new URLSearchParams("asset=USDC"));
    expect(valid.asset).toBe("USDC");
    expect(valid.invalidParams).toHaveLength(0);

    const invalid = parsePaymentQueryParams(new URLSearchParams("asset=TOO_LONG_AND_INVALID_$$$"));
    expect(invalid.asset).toBe("");
    expect(invalid.invalidParams).toContainEqual(
      expect.objectContaining({ param: "asset" })
    );
  });

  it("validates dateFrom and dateTo formats", () => {
    const valid = parsePaymentQueryParams(
      new URLSearchParams("dateFrom=2026-01-01&dateTo=2026-12-31")
    );
    expect(valid.dateFrom).toBe("2026-01-01");
    expect(valid.dateTo).toBe("2026-12-31");
    expect(valid.invalidParams).toHaveLength(0);

    const invalid = parsePaymentQueryParams(
      new URLSearchParams("dateFrom=not-a-date&dateTo=invalid-date")
    );
    expect(invalid.dateFrom).toBe("");
    expect(invalid.dateTo).toBe("");
    expect(invalid.invalidParams).toHaveLength(2);
  });

  it("validates page and pageSize bounds", () => {
    const valid = parsePaymentQueryParams(new URLSearchParams("page=3&pageSize=50"));
    expect(valid.page).toBe(3);
    expect(valid.pageSize).toBe(50);
    expect(valid.invalidParams).toHaveLength(0);

    const invalid = parsePaymentQueryParams(new URLSearchParams("page=-5&pageSize=999"));
    expect(invalid.page).toBe(1);
    expect(invalid.pageSize).toBe(25);
    expect(invalid.invalidParams).toHaveLength(2);
  });

  it("validates cursor token and flags malformed cursor", () => {
    const invalid = parsePaymentQueryParams(new URLSearchParams("cursor=not-a-valid-cursor"));
    expect(invalid.cursor).toBeNull();
    expect(invalid.invalidParams).toContainEqual(
      expect.objectContaining({ param: "cursor" })
    );
  });

  it("buildShareablePaymentQuery strips pagination cursors and default page/size", () => {
    const shareable = buildShareablePaymentQuery({
      search: "test-query",
      status: "RECORDED",
      asset: "XLM",
      page: 1,
      pageSize: 25,
      cursor: "token-should-be-omitted",
      sort: { key: "amount", dir: "desc" },
    });

    const str = shareable.toString();
    expect(str).toContain("search=test-query");
    expect(str).toContain("status=RECORDED");
    expect(str).toContain("asset=XLM");
    expect(str).toContain("sort=amount");
    expect(str).toContain("dir=desc");
    expect(str).not.toContain("cursor");
    expect(str).not.toContain("page");
    expect(str).not.toContain("pageSize");
  });
});

describe("PaymentsPage URL Hydration and Filter State Persistence (Issue #792)", () => {
  it("hydrates search and filters from URL on initial load", async () => {
    mockSearchParams = new URLSearchParams("search=GCCCC&status=CANCELLED&asset=USDC");
    renderPage();

    await waitFor(() => {
      expect(screen.getByLabelText(/filter by status/i)).toHaveValue("CANCELLED");
      expect(screen.getByLabelText(/filter by asset/i)).toHaveValue("USDC");
    });
    expect(screen.getByPlaceholderText(/search by address/i)).toHaveValue("GCCCC");
    // Only payment #2 matches GCCCC, CANCELLED, and USDC
    const ids = await getVisibleRowIds();
    expect(ids).toEqual(["#2"]);
  });

  it("displays a clear notification when invalid query parameters are supplied without blanking the table", async () => {
    mockSearchParams = new URLSearchParams("status=BOGUS_STATUS&sort=fake_key");
    renderPage();

    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeInTheDocument();
    });

    expect(screen.getByText(/Invalid filter parameter\(s\) ignored/i)).toBeInTheDocument();
    expect(screen.getByText(/BOGUS_STATUS/)).toBeInTheDocument();

    // Table falls back to defaults (all 3 payments visible) rather than an empty page
    const ids = await getVisibleRowIds();
    expect(ids).toHaveLength(3);
  });

  it("allows clearing invalid parameters through the notification banner", async () => {
    mockSearchParams = new URLSearchParams("status=BOGUS_STATUS");
    const view = renderPage();

    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeInTheDocument();
    });

    const clearButton = screen.getByRole("button", { name: /clear invalid parameters/i });
    fireEvent.click(clearButton);

    expect(replaceMock).toHaveBeenCalledWith("/payments", { scroll: false });
  });

  it("updates URL on status filter change and resets page", async () => {
    mockSearchParams = new URLSearchParams("page=2");
    renderPage();

    await screen.findAllByRole("row");
    const statusSelect = screen.getByLabelText(/filter by status/i);
    fireEvent.change(statusSelect, { target: { value: "RECORDED" } });

    expect(replaceMock).toHaveBeenCalledWith("/payments?status=RECORDED", {
      scroll: false,
    });
  });

  it("updates URL on asset filter change", async () => {
    renderPage();
    await screen.findAllByRole("row");

    const assetSelect = screen.getByLabelText(/filter by asset/i);
    fireEvent.change(assetSelect, { target: { value: "USDC" } });

    expect(replaceMock).toHaveBeenCalledWith("/payments?asset=USDC", {
      scroll: false,
    });
  });

  it("clears all filters when 'Reset filters' button is clicked", async () => {
    mockSearchParams = new URLSearchParams("status=RECORDED&asset=XLM&search=pay");
    renderPage();

    await screen.findAllByRole("row");
    const resetButton = screen.getByRole("button", { name: /reset filters/i });
    fireEvent.click(resetButton);

    expect(replaceMock).toHaveBeenCalledWith("/payments", { scroll: false });
  });

  it("copies a shareable link without cursor or default pagination when Share is clicked", async () => {
    mockSearchParams = new URLSearchParams("status=RECORDED&page=1&pageSize=25&cursor=abc");
    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText: writeTextMock } });

    renderPage();
    await screen.findAllByRole("row");

    const shareButton = screen.getByRole("button", { name: /share/i });
    fireEvent.click(shareButton);

    expect(writeTextMock).toHaveBeenCalled();
    const copiedUrl = writeTextMock.mock.calls[0][0] as string;
    expect(copiedUrl).toContain("status=RECORDED");
    expect(copiedUrl).not.toContain("cursor");
    expect(copiedUrl).not.toContain("page");
  });

  it("synchronizes search draft when URL changes externally (back/forward)", async () => {
    mockSearchParams = new URLSearchParams("search=initial");
    const view = renderPage();

    await screen.findAllByRole("row");
    expect(screen.getByPlaceholderText(/search by address/i)).toHaveValue("initial");

    // Simulate browser navigation
    mockSearchParams = new URLSearchParams("search=restored-state");
    rerenderPage(view);

    await waitFor(() => {
      expect(screen.getByPlaceholderText(/search by address/i)).toHaveValue("restored-state");
    });
  });
});
