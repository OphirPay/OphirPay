// SPDX-License-Identifier: MIT

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import PaymentsPage from "@/app/payments/page";
import { ToastProvider } from "@/components/ui/Toast";
import type { Payment } from "@/types";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/payments",
  useSearchParams: () => new URLSearchParams(""),
}));

const ID = "cm1234567890123456789012";

const basePayment: Payment = {
  id: ID,
  amount: 250,
  status: "CREATED",
  assetCode: "XLM",
  createdAt: "2026-08-01T12:00:00.000Z",
  updatedAt: "2026-08-01T12:00:00.000Z",
  description: "Invoice #42",
  transactionHash:
    "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
};

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
  screen
    .queryAllByText(text)
    .filter((el) => el.tagName === "SPAN");

const fetchMock = vi.fn();
let serverPayment: Payment;
let resolvePatch:
  | ((value: ReturnType<typeof jsonResponse>) => void)
  | null = null;

beforeEach(() => {
  serverPayment = { ...basePayment };
  resolvePatch = null;

  fetchMock.mockReset();
  fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    if (url === "/api/csrf") {
      return Promise.resolve(
        jsonResponse(200, { token: "test-csrf" })
      );
    }
    if (url === "/api/payments?limit=100" && method === "GET") {
      return Promise.resolve(
        jsonResponse(200, { success: true, data: [serverPayment] })
      );
    }
    if (url === `/api/payments/${ID}` && method === "PATCH") {
      return new Promise<ReturnType<typeof jsonResponse>>((resolve) => {
        resolvePatch = resolve;
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

    // Row starts in CREATED; SIGNED is a safe transition offered by the control.
    expect(badgeFor("CREATED")).toHaveLength(1);

    fireEvent.change(select, { target: { value: "SIGNED" } });

    // Optimistic: the badge flips to SIGNED before the server responds.
    await waitFor(() => {
      expect(badgeFor("SIGNED").length).toBeGreaterThan(0);
    });
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/payments/${ID}`,
      expect.objectContaining({ method: "PATCH" })
    );

    // Server confirms — reconcile from the response.
    serverPayment = { ...basePayment, status: "SIGNED" };
    await act(async () => {
      resolvePatch?.(
        jsonResponse(200, { success: true, data: serverPayment })
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

    // Optimistic: badge flips immediately.
    await waitFor(() => {
      expect(badgeFor("SIGNED").length).toBeGreaterThan(0);
    });

    // Server rejects the transition — roll back to CREATED.
    await act(async () => {
      resolvePatch?.(
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

  it("does not offer transitions for terminal statuses", async () => {
    serverPayment = { ...basePayment, status: "COMPLETED" };
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

    // While the PATCH is in flight the control is disabled, preventing a
    // duplicate submission for the same row.
    await waitFor(() => {
      expect(
        screen.getByRole("combobox", { name: /change status of payment/i })
      ).toBeDisabled();
    });
  });
});
