// SPDX-License-Identifier: MIT
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import {
  BatchDropzone,
  validateCsvFile,
  formatFileSizeKb,
} from "@/components/batch/BatchDropzone";
import { CsvBatchImport } from "@/components/CsvBatchImport";

const VALID_ADDRESS = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const OTHER_ADDRESS = "G" + "B".repeat(55);

describe("BatchDropzone & CsvBatchImport drag-and-drop progress (#1378)", () => {
  it("transitions between idle, drag-over, parsing, and error visual states", () => {
    const onFileAccepted = vi.fn();
    const { rerender } = render(
      <BatchDropzone onFileAccepted={onFileAccepted} />
    );

    const dropzone = screen.getByTestId("csv-dropzone");
    expect(dropzone).toHaveAttribute("data-state", "idle");

    fireEvent.dragOver(dropzone);
    expect(dropzone).toHaveAttribute("data-state", "drag-over");
    expect(screen.getByText(/drop your csv here/i)).toBeInTheDocument();

    fireEvent.dragLeave(dropzone);
    expect(dropzone).toHaveAttribute("data-state", "idle");

    rerender(<BatchDropzone onFileAccepted={onFileAccepted} isParsing />);
    expect(dropzone).toHaveAttribute("data-state", "parsing");
    expect(screen.getByText(/parsing csv batch file/i)).toBeInTheDocument();

    rerender(<BatchDropzone onFileAccepted={onFileAccepted} hasError />);
    expect(dropzone).toHaveAttribute("data-state", "error");
  });

  it("validates MIME type and .csv extension before ingestion and rejects non-CSV files", () => {
    expect(
      validateCsvFile(new File(["a,b"], "batch.csv", { type: "text/csv" })).valid
    ).toBe(true);
    expect(
      validateCsvFile(
        new File(["a,b"], "payroll.CSV", { type: "application/vnd.ms-excel" })
      ).valid
    ).toBe(true);
    expect(
      validateCsvFile(
        new File(["{}"], "payload.json", { type: "application/json" })
      ).valid
    ).toBe(false);
    expect(
      validateCsvFile(
        new File(["binary"], "fake.csv", { type: "application/pdf" })
      ).valid
    ).toBe(false);

    const onFileAccepted = vi.fn();
    const onFileRejected = vi.fn();
    render(
      <BatchDropzone
        onFileAccepted={onFileAccepted}
        onFileRejected={onFileRejected}
      />
    );

    const badFile = new File(["not csv"], "malware.exe", {
      type: "application/octet-stream",
    });
    const dropzone = screen.getByTestId("csv-dropzone");
    fireEvent.drop(dropzone, { dataTransfer: { files: [badFile] } });

    expect(onFileAccepted).not.toHaveBeenCalled();
    expect(onFileRejected).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("csv-dropzone-error")).toHaveTextContent(
      /invalid file type "malware\.exe"/i
    );
    expect(dropzone).toHaveAttribute("data-state", "error");
  });

  it("renders file metadata (name, size in KB, row count) and ProgressBar upon dropping a CSV", async () => {
    const onRowsChange = vi.fn();
    const onValidityChange = vi.fn();
    render(
      <CsvBatchImport
        selfAddress={null}
        onRowsChange={onRowsChange}
        onValidityChange={onValidityChange}
      />
    );

    const csvContent = `address,amount,memo\n${VALID_ADDRESS},125.5,invoice-1\n${OTHER_ADDRESS},75,invoice-2\n`;
    const file = new File([csvContent], "q4-payouts.csv", { type: "text/csv" });
    const dropzone = screen.getByTestId("csv-dropzone");

    fireEvent.drop(dropzone, { dataTransfer: { files: [file] } });

    expect(await screen.findByTestId("csv-summary")).toHaveTextContent(/2 rows/i);

    const progressbar = screen.getByRole("progressbar");
    expect(progressbar).toHaveAttribute("aria-valuenow", "100");
    expect(screen.getByTestId("csv-file-size")).toHaveTextContent(
      formatFileSizeKb(file.size)
    );
    await waitFor(() => {
      expect(onValidityChange).toHaveBeenLastCalledWith(true);
    });
  });
});
