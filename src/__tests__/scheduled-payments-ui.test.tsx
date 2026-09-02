// SPDX-License-Identifier: MIT

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import SendPage from "@/app/send/page";
import ScheduledPaymentsList from "@/components/ScheduledPaymentsList";

const PUBLIC_KEY = "GWT7SDH7366X75RZDMUOCSWWRJUF3IJKJI4FYHZAEQSPI626PO4LZZF4";
const RECIPIENT = "G4XAJTP2AXLVEZ5NQQSULA5L5MVCDML2RWULI2BZC6FGBBWHR3SAXHF3";

// ── Module mocks ───────────────────────────────────────────────

vi.mock("@/hooks/useMultiWallet", () => ({
  useWallet: () => ({
    wallet: {
      connected: true,
      publicKey: PUBLIC_KEY,
      balance: "1000",
      network: "TESTNET",
      activeWalletId: "freighter",
    },
    fetchBalance: vi.fn(),
  }),
}));

vi.mock("@/components/ui/Toast", () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}));

vi.mock("@/lib/wallets", () => ({
  getWalletConnector: vi.fn(),
}));

vi.mock("@/lib/stellar", () => ({
  isValidStellarAddress: vi.fn(() => true),
  buildPaymentTx: vi.fn(),
  submitSignedTx: vi.fn(),
  getStellarExplorerUrl: vi.fn((h: string) => `https://stellar.expert/explorer/testnet/tx/${h}`),
  NETWORK_PASSPHRASE: "Test SDF Network ; September 2015",
  STELLAR_NETWORK: "TESTNET",
  XLM_STROOPS: 1e7,
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

vi.mock("@/components/AssetSelector", () => ({
  AssetSelector: () => <div data-testid="asset-selector" />,
}));

// ── Fetch mock ─────────────────────────────────────────────────

const fetchMock = vi.fn();
let createdBodies: Record<string, unknown>[] = [];
let deletedIds: string[] = [];

function jsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

function renderWithClient(ui: React.ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>
  );
}

beforeEach(() => {
  createdBodies = [];
  deletedIds = [];
  fetchMock.mockReset();
  fetchMock.mockImplementation((url: string, init?: RequestInit) => {
    const u = String(url);
    if (u === "/api/csrf") {
      return Promise.resolve(jsonResponse(200, { token: "test-token" }));
    }
    if (u === "/api/scheduled" && (!init?.method || init.method === "GET")) {
      return Promise.resolve(
        jsonResponse(200, { success: true, data: [], meta: {} })
      );
    }
    if (u === "/api/scheduled" && init?.method === "POST") {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      createdBodies.push(body);
      return Promise.resolve(
        jsonResponse(201, { success: true, data: { id: "sched_1", ...body } })
      );
    }
    if (u.startsWith("/api/scheduled?id=") && init?.method === "DELETE") {
      deletedIds.push(u.split("id=")[1]);
      return Promise.resolve(
        jsonResponse(200, {
          success: true,
          data: { id: "sched_1", status: "CANCELLED" },
        })
      );
    }
    return Promise.resolve(
      jsonResponse(200, { success: true, data: [], meta: {} })
    );
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ── Send page: schedule flow ───────────────────────────────────

describe("SendPage scheduling", () => {
  it("shows the immediate send button by default", () => {
    renderWithClient(<SendPage />);
    expect(
      screen.getByRole("button", { name: /send xlm/i })
    ).toBeInTheDocument();
  });

  it("schedules a payment and shows the scheduled confirmation", async () => {
    renderWithClient(<SendPage />);

    fireEvent.change(screen.getByPlaceholderText("G..."), {
      target: { value: RECIPIENT },
    });
    fireEvent.change(screen.getByPlaceholderText("0.00"), {
      target: { value: "100" },
    });
    fireEvent.change(screen.getByPlaceholderText("e.g. Payment for services"), {
      target: { value: "September payout" },
    });

    fireEvent.click(
      screen.getByLabelText("Schedule this payment for later")
    );
    fireEvent.change(screen.getByLabelText("Send on"), {
      target: { value: "2099-01-01T10:00" },
    });

    fireEvent.click(screen.getByRole("button", { name: /schedule payment/i }));

    expect(
      await screen.findByRole("heading", { name: /payment scheduled/i })
    ).toBeInTheDocument();

    await waitFor(() => {
      expect(createdBodies).toHaveLength(1);
    });
    expect(createdBodies[0]).toMatchObject({
      amount: 100,
      assetCode: "XLM",
      destAddress: RECIPIENT,
      memo: "September payout",
    });
    // scheduledFor must match the chosen local datetime (instant-safe)
    expect(
      new Date(String(createdBodies[0].scheduledFor)).getTime()
    ).toBe(new Date("2099-01-01T10:00").getTime());
  });

  it("rejects a past scheduled time with a validation error", async () => {
    renderWithClient(<SendPage />);

    fireEvent.change(screen.getByPlaceholderText("G..."), {
      target: { value: RECIPIENT },
    });
    fireEvent.change(screen.getByPlaceholderText("0.00"), {
      target: { value: "50" },
    });

    fireEvent.click(
      screen.getByLabelText("Schedule this payment for later")
    );
    fireEvent.change(screen.getByLabelText("Send on"), {
      target: { value: "2020-01-01T10:00" },
    });

    fireEvent.click(screen.getByRole("button", { name: /schedule payment/i }));

    expect(
      await screen.findByText("Scheduled time must be in the future.")
    ).toBeInTheDocument();
    expect(createdBodies).toHaveLength(0);
  });
});

// ── ScheduledPaymentsList ──────────────────────────────────────

describe("ScheduledPaymentsList", () => {
  it("renders upcoming payments with statuses and cancel actions", async () => {
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      const u = String(url);
      if (u === "/api/csrf") {
        return Promise.resolve(jsonResponse(200, { token: "test-token" }));
      }
      if (u === "/api/scheduled" && (!init?.method || init.method === "GET")) {
        return Promise.resolve(
          jsonResponse(200, {
            success: true,
            data: [
              {
                id: "sched_1",
                amount: "100",
                assetCode: "XLM",
                destAddress: RECIPIENT,
                memo: "Payout",
                scheduledFor: "2099-01-01T10:00:00.000Z",
                status: "SCHEDULED",
              },
              {
                id: "sched_2",
                amount: "25",
                assetCode: "XLM",
                destAddress: PUBLIC_KEY,
                scheduledFor: "2099-02-01T10:00:00.000Z",
                status: "EXECUTED",
                transactionHash: "tx123",
              },
            ],
            meta: {},
          })
        );
      }
      return Promise.resolve(
        jsonResponse(200, { success: true, data: [], meta: {} })
      );
    });

    renderWithClient(<ScheduledPaymentsList />);

    expect(await screen.findByText("100.00 XLM")).toBeInTheDocument();
    expect(await screen.findByText("25.00 XLM")).toBeInTheDocument();
    expect(await screen.findByText("scheduled")).toBeInTheDocument();
    expect(await screen.findByText("executed")).toBeInTheDocument();

    // Only the SCHEDULED row offers a cancel action
    const cancelButtons = screen.getAllByRole("button", { name: /cancel/i });
    expect(cancelButtons).toHaveLength(1);
  });

  it("cancels a scheduled payment via DELETE", async () => {
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      const u = String(url);
      if (u === "/api/csrf") {
        return Promise.resolve(jsonResponse(200, { token: "test-token" }));
      }
      if (u === "/api/scheduled" && (!init?.method || init.method === "GET")) {
        return Promise.resolve(
          jsonResponse(200, {
            success: true,
            data: [
              {
                id: "sched_1",
                amount: "100",
                assetCode: "XLM",
                destAddress: RECIPIENT,
                scheduledFor: "2099-01-01T10:00:00.000Z",
                status: "SCHEDULED",
              },
            ],
            meta: {},
          })
        );
      }
      if (u.startsWith("/api/scheduled?id=") && init?.method === "DELETE") {
        deletedIds.push(u.split("id=")[1]);
        return Promise.resolve(
          jsonResponse(200, {
            success: true,
            data: { id: "sched_1", status: "CANCELLED" },
          })
        );
      }
      return Promise.resolve(
        jsonResponse(200, { success: true, data: [], meta: {} })
      );
    });

    renderWithClient(<ScheduledPaymentsList />);

    fireEvent.click(await screen.findByRole("button", { name: /cancel/i }));

    await waitFor(() => {
      expect(deletedIds).toContain("sched_1");
    });
    const deleteCall = fetchMock.mock.calls.find(
      ([url, init]) =>
        String(url).startsWith("/api/scheduled?id=") && init?.method === "DELETE"
    );
    expect(deleteCall).toBeTruthy();
  });
});
