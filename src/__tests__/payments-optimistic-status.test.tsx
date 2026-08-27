// SPDX-License-Identifier: MIT

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import PaymentsPage from "@/app/payments/page";
import { ToastProvider } from "@/components/ui/Toast";
import type { Payment, PaymentStatus } from "@/types";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/payments",
  useSearchParams: () => new URLSearchParams(""),
}));

const ID = "cm1234567890123456789012";
const ID_B = "cm9876543210987654321098";

const basePayment = (id: string, status: PaymentStatus = "CREATED"): Payment => ({
  id,
  amount: 250,
  status,
  assetCode: "XLM",
  createdAt: "2026-08-01T12:00:00.000Z",
  updatedAt: "2026-08-01T12:00:00.000Z",
  description: "Invoice #42",
  transactionHash:
    "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
});

function jsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

// The optimistic update flips the badge immediately and the PATCH response
// (or rollback + refetch) reconciles it. The badge is a <span>; the select's
// <option> elements carry the same text, so filter by element tag.
const badgeFor = (text: string) =>
  screen.queryAllByText(text).filter((el) => el.tagName === "SPAN");

const fetchMock = vi.fn();
let serverPayments: Payment[];
let patchResolvers: Record<
  string,
  (value: ReturnType<typeof jsonResponse>) => void
>;

function patchUrl(id: string) {
  return `/api/payments/${id}`;
}

beforeEach(() => {
  serverPayments = [basePayment(ID)];
  patchResolvers = {};

  fetchMock.mockReset();
  fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";

    if (url === "/api/csrf") {
      return Promise.resolve(jsonResponse(200, { token: "test-csrf" }));
    }

    // List endpoint is server-paginated; slice the mutable server state per page.
    if (url.startsWith("/api/payments?page=") && method === "GET") {
      const page = Number(new URLSearchParams(url.split("?")[1]).get("page") ?? "1");
      const start = (page - 1) * 100;
      const data = serverPayments.slice(start, start + 100);
      return Promise.resolve(
        jsonResponse(200, {
          success: true,
          data,
          meta: { page, limit: 100, total: serverPayments.length },
        })
      );
    }

    if (method === "PATCH" && url.startsWith("/api/payments/")) {
      const id = url.replace("/api/payments/", "");
      return new Promise<ReturnType<typeof jsonResponse>>((resolve) => {
        patchResolvers[id] = resolve;
      });
    }

    return Promise.resolve(
      jsonResponse(404, {
        error: { code: "NOT_FOUND", message: "not found" },
      })
    );
  });
  vi.stubGlobal("fetch", fetchMock);
});

function renderPage() {
  const queryClient = new QueryClient({
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

describe("PaymentsPage optimistic status updates", () => {
  it("applies the new status optimistically and keeps it after the PATCH succeeds", async () => {
    renderPage();

    const select = await screen.findByRole("combobox", {
      name: /change status of payment/i,
    });

    expect(badgeFor("CREATED")).toHaveLength(1);

    fireEvent.change(select, { target: { value: "SIGNED" } });

    // Optimistic: badge flips before the server responds.
    await waitFor(() => {
      expect(badgeFor("SIGNED").length).toBeGreaterThan(0);
    });
    expect(fetchMock).toHaveBeenCalledWith(
      patchUrl(ID),
      expect.objectContaining({ method: "PATCH" })
    );

    // Server confirms — reconcile from the response.
    serverPayments = serverPayments.map((p) =>
      p.id === ID ? { ...p, status: "SIGNED" } : p
    );
    await act(async () => {
      patchResolvers[ID]?.(
        jsonResponse(200, { success: true, data: serverPayments[0] })
      );
    });

    await waitFor(() => {
      expect(badgeFor("SIGNED").length).toBeGreaterThan(0);
    });
    expect(badgeFor("CREATED")).toHaveLength(0);
    expect(screen.getByText("Payment status updated")).toBeInTheDocument();
  });

  it("reverts to the previous status and shows a toast when the PATCH fails", async () => {
    renderPage();

    const select = await screen.findByRole("combobox", {
      name: /change status of payment/i,
    });

    fireEvent.change(select, { target: { value: "SIGNED" } });

    await waitFor(() => {
      expect(badgeFor("SIGNED").length).toBeGreaterThan(0);
    });

    await act(async () => {
      patchResolvers[ID]?.(
        jsonResponse(400, {
          error: { code: "INVALID_STATUS", message: "Invalid status transition" },
        })
      );
    });

    await waitFor(() => {
      expect(badgeFor("CREATED").length).toBeGreaterThan(0);
    });
    expect(badgeFor("SIGNED")).toHaveLength(0);
    expect(
      screen.getByText("Failed to update payment status")
    ).toBeInTheDocument();
  });

  it("rolls back only the failed row when two status updates overlap", async () => {
    serverPayments = [basePayment(ID), basePayment(ID_B)];
    renderPage();

    const [selectA, selectB] = await screen.findAllByRole("combobox", {
      name: /change status of payment/i,
    });

    // Update both rows while both requests are in flight.
    fireEvent.change(selectA, { target: { value: "SIGNED" } });
    fireEvent.change(selectB, { target: { value: "SIGNED" } });

    await waitFor(() => {
      expect(badgeFor("SIGNED").length).toBeGreaterThan(0);
    });

    // Row A fails — only its badge should revert; row B keeps its optimistic state.
    await act(async () => {
      patchResolvers[ID]?.(
        jsonResponse(400, {
          error: { code: "INVALID_STATUS", message: "Invalid status transition" },
        })
      );
    });

    await waitFor(() => {
      expect(
        screen.getAllByText("CREATED").filter((el) => el.tagName === "SPAN")
      ).toHaveLength(1);
    });
    expect(badgeFor("SIGNED").length).toBeGreaterThan(0);
    expect(
      screen.getByText("Failed to update payment status")
    ).toBeInTheDocument();

    // Row B still succeeds and keeps its status.
    serverPayments = serverPayments.map((p) =>
      p.id === ID_B ? { ...p, status: "SIGNED" } : p
    );
    await act(async () => {
      patchResolvers[ID_B]?.(
        jsonResponse(200, {
          success: true,
          data: serverPayments.find((p) => p.id === ID_B)!,
        })
      );
    });

    await waitFor(() => {
      expect(badgeFor("SIGNED").length).toBeGreaterThan(0);
    });
  });

  it("does not offer transitions for terminal statuses", async () => {
    serverPayments = [basePayment(ID, "COMPLETED")];
    renderPage();

    await screen.findByText("COMPLETED");
    expect(
      screen.queryByRole("combobox", { name: /change status of payment/i })
    ).not.toBeInTheDocument();
  });

  it("disables the status control while an update is pending", async () => {
    renderPage();

    const select = await screen.findByRole("combobox", {
      name: /change status of payment/i,
    });

    fireEvent.change(select, { target: { value: "SIGNED" } });

    await waitFor(() => {
      expect(
        screen.getByRole("combobox", { name: /change status of payment/i })
      ).toBeDisabled();
    });
  });
});

describe("PaymentsPage full payment history", () => {
  it("loads every server page so older payments are reachable", async () => {
    serverPayments = Array.from({ length: 250 }, (_, i) =>
      basePayment(`cm${String(i + 1).padStart(18, "0")}`)
    );
    renderPage();

    // All 250 records are loaded and counted, not just the first server page.
    await waitFor(() => {
      expect(screen.getByText("250 payments")).toBeInTheDocument();
    });

    // The last (oldest) record from page 3 is searchable client-side.
    const lastId = `cm${String(250).padStart(18, "0")}`;
    const search = screen.getByPlaceholderText(
      /search by id, description, hash, or status/i
    );
    fireEvent.change(search, { target: { value: lastId } });

    await waitFor(() => {
      expect(
        screen.getByText(`#${lastId.slice(0, 9)}...${lastId.slice(-8)}`)
      ).toBeInTheDocument();
    });
  });
});
