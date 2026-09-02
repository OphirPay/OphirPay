// SPDX-License-Identifier: MIT
// Tests for the CSV upload flow on the New Batch page: the submit button
// stays disabled until every row in the imported file is valid.

import type React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import NewBatchPage from "@/app/batches/new/page";

const VALID_ADDRESS = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const OTHER_ADDRESS = "G" + "B".repeat(55);
const SELF_ADDRESS = "G" + "C".repeat(55);

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/batches/new",
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

vi.mock("@/hooks/useMultiWallet", () => ({
  useWallet: () => ({
    wallet: {
      connected: true,
      publicKey: SELF_ADDRESS,
      network: "TESTNET",
      balance: "1000",
      balanceLoading: false,
      activeWalletId: "freighter",
    },
    fetchBalance: vi.fn(),
    disconnect: vi.fn(),
  }),
}));

vi.mock("@/lib/wallets", () => ({
  getWalletConnector: vi.fn(),
}));

vi.mock("@/lib/stellar", () => ({
  isValidStellarAddress: (addr: string) => /^G[A-Z0-9]{55}$/.test(addr),
  buildBatchPaymentTx: vi.fn(),
  submitSignedTx: vi.fn(),
  getStellarExplorerUrl: vi.fn(),
  NETWORK_PASSPHRASE: "Test SDF Network ; September 2015",
}));

function csvFile(content: string): File {
  return new File([content], "recipients.csv", { type: "text/csv" });
}

async function uploadCsv(content: string) {
  const input = await screen.findByTestId("csv-file-input");
  fireEvent.change(input, { target: { files: [csvFile(content)] } });
  await screen.findByTestId("csv-preview-table");
}

function submitButton(): HTMLButtonElement {
  return screen.getByRole("button", { name: /send batch payment/i });
}

describe("NewBatchPage CSV upload flow", () => {
  it("switches to CSV mode and shows the dropzone", () => {
    render(<NewBatchPage />);
    fireEvent.click(screen.getByRole("tab", { name: "Upload CSV" }));
    expect(screen.getByTestId("csv-dropzone")).toBeInTheDocument();
  });

  it("keeps the submit button disabled until the file is valid", async () => {
    render(<NewBatchPage />);
    fireEvent.click(screen.getByRole("tab", { name: "Upload CSV" }));

    // No file loaded yet → disabled
    expect(submitButton()).toBeDisabled();

    // File with a malformed row → still disabled, error highlighted inline
    await uploadCsv(`address,amount,memo\nNOT_AN_ADDRESS,100,\n${OTHER_ADDRESS},50,\n`);
    expect(screen.getByText("Invalid Stellar address.")).toBeInTheDocument();
    expect(submitButton()).toBeDisabled();

    // Fix the malformed row inline → re-validated → submit enabled
    fireEvent.change(screen.getByDisplayValue("NOT_AN_ADDRESS"), {
      target: { value: VALID_ADDRESS },
    });
    await waitFor(() => {
      expect(submitButton()).not.toBeDisabled();
    });
    expect(screen.queryByText("Invalid Stellar address.")).toBeNull();
  });

  it("re-disables submit after toggling away from CSV mode and back", async () => {
    render(<NewBatchPage />);
    fireEvent.click(screen.getByRole("tab", { name: "Upload CSV" }));

    await uploadCsv(`address,amount,memo\n${OTHER_ADDRESS},100,\n`);
    await waitFor(() => {
      expect(submitButton()).not.toBeDisabled();
    });

    // Leave CSV mode and come back — the dropzone resets, so submit must be
    // disabled until a file is parsed and validated again.
    fireEvent.click(screen.getByRole("tab", { name: "Manual entry" }));
    fireEvent.click(screen.getByRole("tab", { name: "Upload CSV" }));
    expect(screen.queryByTestId("csv-preview-table")).toBeNull();
    expect(submitButton()).toBeDisabled();
  });

  it("opens the confirmation dialog when a valid file is submitted", async () => {
    render(<NewBatchPage />);
    fireEvent.click(screen.getByRole("tab", { name: "Upload CSV" }));

    await uploadCsv(`address,amount,memo\n${OTHER_ADDRESS},100,\n`);
    await waitFor(() => {
      expect(submitButton()).not.toBeDisabled();
    });

    fireEvent.click(submitButton());
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Confirm Batch Payment")).toBeInTheDocument();
    expect(within(dialog).getByText("1")).toBeInTheDocument();
    expect(within(dialog).getAllByText("100.00 XLM").length).toBeGreaterThan(0);
    expect(within(dialog).getByText("Total Amount")).toBeInTheDocument();
  });
});
