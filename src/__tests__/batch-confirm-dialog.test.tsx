// SPDX-License-Identifier: MIT

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { BatchConfirmDialog } from "@/components/BatchConfirmDialog";

const baseProps = {
  open: true,
  onConfirm: vi.fn(),
  onCancel: vi.fn(),
  totalAmount: 25.5,
  estimatedFee: "600",
};

describe("BatchConfirmDialog", () => {
  it("renders nothing when closed", () => {
    render(
      <BatchConfirmDialog
        {...baseProps}
        open={false}
        recipients={[{ address: "G" + "A".repeat(55), amount: "10" }]}
      />
    );
    expect(screen.queryByText("Confirm Batch Payment")).toBeNull();
  });

  it("renders title and summary when open", () => {
    render(
      <BatchConfirmDialog
        {...baseProps}
        recipients={[
          { address: "G" + "A".repeat(55), amount: "10" },
          { address: "G" + "B".repeat(55), amount: "15.5" },
        ]}
      />
    );
    expect(screen.getByText("Confirm Batch Payment")).toBeDefined();
    expect(screen.getByText("2")).toBeDefined();
    expect(screen.getByText("Total Amount")).toBeDefined();
    expect(screen.getByText("25.50 XLM")).toBeDefined();
  });

  it("displays per-recipient amounts for top N recipients", () => {
    render(
      <BatchConfirmDialog
        {...baseProps}
        recipients={[
          { address: "G" + "A".repeat(55), amount: "10" },
          { address: "G" + "B".repeat(55), amount: "15.5" },
        ]}
      />
    );
    expect(screen.getByText("10.00 XLM")).toBeDefined();
    expect(screen.getByText("15.50 XLM")).toBeDefined();
  });

  it("shows '…and X more' when recipients exceed MAX_VISIBLE (5)", () => {
    const recipients = Array.from({ length: 8 }, (_, i) => ({
      address: `G${String.fromCharCode(65 + i).repeat(55)}`,
      amount: `${i + 1}`,
    }));

    render(<BatchConfirmDialog {...baseProps} recipients={recipients} />);
    expect(screen.getByText("…and 3 more")).toBeDefined();
  });

  it("does not show '…and X more' when recipients are 5 or fewer", () => {
    const recipients = Array.from({ length: 5 }, (_, i) => ({
      address: `G${String.fromCharCode(65 + i).repeat(55)}`,
      amount: `${i + 1}`,
    }));

    render(<BatchConfirmDialog {...baseProps} recipients={recipients} />);
    expect(screen.queryByText(/…and/)).toBeNull();
  });

  it("calls onConfirm when Confirm & Sign is clicked", () => {
    const onConfirm = vi.fn();
    render(
      <BatchConfirmDialog
        {...baseProps}
        onConfirm={onConfirm}
        recipients={[{ address: "G" + "A".repeat(55), amount: "10" }]}
      />
    );
    fireEvent.click(screen.getByTestId("batch-confirm-send"));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("calls onCancel when Back is clicked", () => {
    const onCancel = vi.fn();
    render(
      <BatchConfirmDialog
        {...baseProps}
        onCancel={onCancel}
        recipients={[{ address: "G" + "A".repeat(55), amount: "10" }]}
      />
    );
    fireEvent.click(screen.getByText("Back"));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("shows estimated fee", () => {
    render(
      <BatchConfirmDialog
        {...baseProps}
        estimatedFee="700"
        recipients={[{ address: "G" + "A".repeat(55), amount: "10" }]}
      />
    );
    expect(screen.getByText("Estimated Fee")).toBeDefined();
    expect(screen.getByText("0.00007 XLM")).toBeDefined();
  });
});

describe("BatchConfirmDialog copy-to-clipboard (issue #1894)", () => {
  const ADDRESS_A = "G" + "A".repeat(55);
  const ADDRESS_B = "G" + "B".repeat(55);
  const writeText = vi.fn();

  beforeEach(() => {
    writeText.mockReset();
    writeText.mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("copies the full address (not the shortened form) when an address is clicked", async () => {
    render(
      <BatchConfirmDialog
        {...baseProps}
        recipients={[
          { address: ADDRESS_A, amount: "10" },
          { address: ADDRESS_B, amount: "15.5" },
        ]}
      />
    );
    fireEvent.click(
      screen.getByRole("button", { name: /copy recipient address GAAAAAAAA/i })
    );
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText).toHaveBeenCalledWith(ADDRESS_A);
    // Feedback appears only on the clicked row, and is announced politely.
    expect(await screen.findByText("Copied!")).toBeDefined();
    expect(screen.getAllByText("Copied!")).toHaveLength(1);
    expect(screen.getByText("Address copied")).toBeDefined();
  });

  it("shows 'Copied!' and hides it again after 2 seconds", async () => {
    vi.useFakeTimers();
    render(
      <BatchConfirmDialog
        {...baseProps}
        recipients={[{ address: ADDRESS_A, amount: "10" }]}
      />
    );
    fireEvent.click(
      screen.getByRole("button", { name: /copy recipient address/i })
    );
    // Flush the resolved writeText promise so the tooltip state lands.
    await act(async () => {});
    expect(screen.getByText("Copied!")).toBeDefined();
    act(() => {
      vi.advanceTimersByTime(1999);
    });
    expect(screen.getByText("Copied!")).toBeDefined();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.queryByText("Copied!")).toBeNull();
    expect(screen.queryByText("Address copied")).toBeNull();
  });

  it("fails gracefully when the clipboard write is rejected", async () => {
    writeText.mockRejectedValue(new Error("Clipboard permission denied"));
    render(
      <BatchConfirmDialog
        {...baseProps}
        recipients={[{ address: ADDRESS_A, amount: "10" }]}
      />
    );
    fireEvent.click(
      screen.getByRole("button", { name: /copy recipient address/i })
    );
    // Flush the rejected promise; the rejection must be swallowed.
    await act(async () => {});
    expect(writeText).toHaveBeenCalledWith(ADDRESS_A);
    expect(screen.queryByText("Copied!")).toBeNull();
    expect(screen.queryByText("Address copied")).toBeNull();
  });
});
