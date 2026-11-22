// SPDX-License-Identifier: MIT

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BatchConfirmDialog } from "@/components/BatchConfirmDialog";

const ADDRESS_A = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const ADDRESS_B = "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";

function renderDialog() {
  return render(
    <BatchConfirmDialog
      open
      recipients={[
        { address: ADDRESS_A, amount: "100000000" },
        { address: ADDRESS_B, amount: "50000000" },
      ]}
      totalAmount={150000000}
      estimatedFee="10000000"
      onConfirm={() => {}}
      onCancel={() => {}}
    />
  );
}

describe("BatchConfirmDialog copy-to-clipboard (issue #1894)", () => {
  let writeText: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("copies the full recipient address on click", async () => {
    renderDialog();
    fireEvent.click(screen.getAllByRole("button", { name: /copy recipient address/i })[0]);
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(ADDRESS_A), { timeout: 15000 });
  }, 20000);

  it("shows a 'Copied!' tooltip that clears after 2 seconds", async () => {
    vi.useFakeTimers();
    try {
      renderDialog();
      fireEvent.click(screen.getAllByRole("button", { name: /copy recipient address/i })[0]);
      // Resolve the clipboard promise under fake timers.
      await vi.waitFor(() => {
        expect(screen.getByTestId("copied-tooltip-0")).toHaveTextContent("Copied!");
      });
      // Advance past the 2s auto-dismiss window.
      vi.advanceTimersByTime(2000);
      await vi.waitFor(() => {
        expect(screen.queryByTestId("copied-tooltip-0")).not.toBeInTheDocument();
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("announces the copy via an aria-live polite region", async () => {
    renderDialog();
    const live = screen.getByTestId("batch-copy-announcement");
    expect(live).toHaveAttribute("aria-live", "polite");
    fireEvent.click(screen.getAllByRole("button", { name: /copy recipient address/i })[0]);
    await waitFor(() => expect(live).toHaveTextContent(/address copied/i));
  });

  it("handles clipboard permission failure gracefully without a tooltip", async () => {
    writeText.mockRejectedValueOnce(new Error("NotAllowedError"));
    renderDialog();
    fireEvent.click(screen.getAllByRole("button", { name: /copy recipient address/i })[0]);
    // No 'Copied!' tooltip should appear on failure.
    await waitFor(() =>
      expect(screen.queryByTestId("copied-tooltip-0")).not.toBeInTheDocument()
    );
    // A graceful fallback message is announced instead.
    await waitFor(() =>
      expect(screen.getByTestId("batch-copy-announcement")).toHaveTextContent(
        /copy failed/i
      )
    );
  });
});