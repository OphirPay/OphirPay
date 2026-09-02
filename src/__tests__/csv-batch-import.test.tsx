// SPDX-License-Identifier: MIT
// Tests for CsvBatchImport: drag-and-drop upload, preview table, inline
// error highlighting, re-validation on edit, and validity callbacks.

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { CsvBatchImport, type CsvRecipientRow } from "@/components/CsvBatchImport";

const VALID_ADDRESS = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const OTHER_ADDRESS = "G" + "B".repeat(55);

function csvFile(content: string, name = "recipients.csv"): File {
  return new File([content], name, { type: "text/csv" });
}

async function uploadFile(input: HTMLInputElement, file: File) {
  fireEvent.change(input, { target: { files: [file] } });
}

function setup(props: { selfAddress?: string | null } = {}) {
  const onRowsChange = vi.fn<(rows: CsvRecipientRow[]) => void>();
  const onValidityChange = vi.fn<(valid: boolean) => void>();
  render(
    <CsvBatchImport
      selfAddress={props.selfAddress ?? null}
      onRowsChange={onRowsChange}
      onValidityChange={onValidityChange}
    />
  );
  return { onRowsChange, onValidityChange };
}

describe("CsvBatchImport", () => {
  it("renders a dropzone with upload instructions", () => {
    setup();
    expect(screen.getByTestId("csv-dropzone")).toBeInTheDocument();
    expect(screen.getByText(/drag & drop your csv file here/i)).toBeInTheDocument();
    expect(screen.getByText(/download template/i)).toBeInTheDocument();
  });

  it("shows a row-by-row preview after uploading a file", async () => {
    setup();
    await uploadFile(
      screen.getByTestId("csv-file-input") as HTMLInputElement,
      csvFile(`address,amount,memo\n${VALID_ADDRESS},100,thanks\n${OTHER_ADDRESS},50,\n`)
    );

    expect(await screen.findByTestId("csv-preview-table")).toBeInTheDocument();
    expect(screen.getByTestId("csv-row-1")).toBeInTheDocument();
    expect(screen.getByTestId("csv-row-2")).toBeInTheDocument();
    expect(screen.getByText("recipients.csv")).toBeInTheDocument();
    // Both rows valid → summary says so
    expect(screen.getByTestId("csv-summary")).toHaveTextContent(/all rows valid/i);
    expect(screen.getByTestId("csv-status")).toHaveTextContent(/ready to submit/i);
  });

  it("highlights the offending field on a malformed row", async () => {
    setup();
    await uploadFile(
      screen.getByTestId("csv-file-input") as HTMLInputElement,
      csvFile(`address,amount,memo\nNOT_AN_ADDRESS,100,hi\n${VALID_ADDRESS},0,short\n`)
    );

    expect(await screen.findByText("Invalid Stellar address.")).toBeInTheDocument();
    expect(screen.getByText("Amount must be a number greater than 0.")).toBeInTheDocument();
    // Row containing an error is visually flagged and status prompts fixing
    expect(screen.getByTestId("csv-status")).toHaveTextContent(/fix the highlighted fields/i);
  });

  it("reports validity=false with malformed rows and validity=true once fixed", async () => {
    const { onRowsChange, onValidityChange } = setup();

    await uploadFile(
      screen.getByTestId("csv-file-input") as HTMLInputElement,
      csvFile(`address,amount,memo\nNOT_AN_ADDRESS,100,\n`)
    );
    await screen.findByText("Invalid Stellar address.");
    expect(onValidityChange).toHaveBeenLastCalledWith(false);
    // No valid rows are reported while the file is malformed
    expect(onRowsChange).toHaveBeenLastCalledWith([]);

    // Fix the address inline → re-validated and reported as valid
    const addressInput = screen.getByDisplayValue("NOT_AN_ADDRESS");
    fireEvent.change(addressInput, { target: { value: VALID_ADDRESS } });

    await waitFor(() => {
      expect(onValidityChange).toHaveBeenLastCalledWith(true);
    });
    expect(screen.queryByText("Invalid Stellar address.")).toBeNull();
    expect(onRowsChange).toHaveBeenLastCalledWith([
      { address: VALID_ADDRESS, amount: "100", memo: undefined },
    ]);
  });

  it("only reports rows without errors to the parent", async () => {
    const { onRowsChange } = setup();
    await uploadFile(
      screen.getByTestId("csv-file-input") as HTMLInputElement,
      csvFile(`address,amount,memo\n${VALID_ADDRESS},100,\nBAD,50,\n`)
    );
    await screen.findByText("Invalid Stellar address.");
    expect(onRowsChange).toHaveBeenLastCalledWith([
      { address: VALID_ADDRESS, amount: "100", memo: undefined },
    ]);
  });

  it("detects duplicate addresses and clears the error when one is removed", async () => {
    const { onValidityChange } = setup();
    await uploadFile(
      screen.getByTestId("csv-file-input") as HTMLInputElement,
      csvFile(`address,amount,memo\n${VALID_ADDRESS},100,\n${VALID_ADDRESS},50,\n`)
    );

    expect(await screen.findByText("Duplicate address.")).toBeInTheDocument();
    expect(onValidityChange).toHaveBeenLastCalledWith(false);

    fireEvent.click(screen.getByRole("button", { name: "Remove row 2" }));

    await waitFor(() => {
      expect(onValidityChange).toHaveBeenLastCalledWith(true);
    });
    expect(screen.queryByText("Duplicate address.")).toBeNull();
  });

  it("flags rows sending to the connected wallet's own address", async () => {
    setup({ selfAddress: VALID_ADDRESS });
    await uploadFile(
      screen.getByTestId("csv-file-input") as HTMLInputElement,
      csvFile(`address,amount,memo\n${VALID_ADDRESS},100,\n${OTHER_ADDRESS},50,\n`)
    );

    expect(await screen.findByText("Cannot send to your own address.")).toBeInTheDocument();
    expect(screen.getByTestId("csv-status")).toHaveTextContent(/fix the highlighted fields/i);
  });

  it("clears the preview when the file is removed", async () => {
    setup();
    await uploadFile(
      screen.getByTestId("csv-file-input") as HTMLInputElement,
      csvFile(`address,amount,memo\n${VALID_ADDRESS},100,\n`)
    );
    await screen.findByTestId("csv-preview-table");

    fireEvent.click(screen.getByRole("button", { name: "Remove file" }));

    expect(screen.queryByTestId("csv-preview-table")).toBeNull();
    expect(screen.queryByText("recipients.csv")).toBeNull();
  });

  it("shows a file-level error for a CSV with no data rows", async () => {
    setup();
    await uploadFile(
      screen.getByTestId("csv-file-input") as HTMLInputElement,
      csvFile("address,amount,memo\n")
    );

    expect(
      await screen.findByText(/must have a header row and at least one data row/i)
    ).toBeInTheDocument();
  });
});
