// SPDX-License-Identifier: MIT
// Unit tests for BatchDropzone: HTML5 drag-and-drop, visual dropping feedback,
// non-CSV rejection with error toasts, parsing progress, and metadata display.

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { BatchDropzone, isValidCsvFile } from "@/components/batch/BatchDropzone";
import { ToastProvider } from "@/components/ui/Toast";
import { CsvBatchImport } from "@/components/CsvBatchImport";

function createMockFile(name: string, content: string, type: string): File {
  return new File([content], name, { type });
}

describe("isValidCsvFile helper", () => {
  it("accepts valid .csv files with csv MIME types", () => {
    const file = createMockFile("payroll.csv", "a,b,c", "text/csv");
    expect(isValidCsvFile(file)).toEqual({ valid: true });
  });

  it("accepts valid .csv files with excel MIME types", () => {
    const file = createMockFile("payroll.csv", "a,b,c", "application/vnd.ms-excel");
    expect(isValidCsvFile(file)).toEqual({ valid: true });
  });

  it("accepts .csv files with empty MIME type (common in OS file drops)", () => {
    const file = createMockFile("payroll.csv", "a,b,c", "");
    expect(isValidCsvFile(file)).toEqual({ valid: true });
  });

  it("rejects non-.csv extensions immediately", () => {
    const pdf = createMockFile("document.pdf", "%PDF-1.4", "application/pdf");
    const result = isValidCsvFile(pdf);
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/Invalid file format/i);
  });

  it("rejects files with invalid MIME types even if named .csv", () => {
    const exe = createMockFile("malicious.csv", "MZ", "application/x-msdownload");
    const result = isValidCsvFile(exe);
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/Invalid MIME type/i);
  });
});

describe("BatchDropzone component", () => {
  it("renders idle state with upload instructions and template download link", () => {
    const onFileAccepted = vi.fn();
    render(
      <ToastProvider>
        <BatchDropzone onFileAccepted={onFileAccepted} />
      </ToastProvider>
    );

    const dropzone = screen.getByTestId("csv-dropzone");
    expect(dropzone).toHaveAttribute("data-state", "idle");
    expect(screen.getByText(/drag & drop your csv file here/i)).toBeInTheDocument();
    expect(screen.getByText(/download template/i)).toBeInTheDocument();
  });

  it("activates drag-over visual highlight on dragover and reverts on dragleave", () => {
    const onFileAccepted = vi.fn();
    render(
      <ToastProvider>
        <BatchDropzone onFileAccepted={onFileAccepted} />
      </ToastProvider>
    );

    const dropzone = screen.getByTestId("csv-dropzone");

    // Simulate drag enter / drag over
    fireEvent.dragEnter(dropzone, {
      dataTransfer: { items: [{ kind: "file", type: "text/csv" }] },
    });
    fireEvent.dragOver(dropzone, {
      dataTransfer: { items: [{ kind: "file", type: "text/csv" }] },
    });

    expect(dropzone).toHaveAttribute("data-state", "drag-over");
    expect(screen.getByText(/drop your csv here/i)).toBeInTheDocument();

    // Simulate drag leave
    fireEvent.dragLeave(dropzone);
    expect(dropzone).toHaveAttribute("data-state", "idle");
    expect(screen.getByText(/drag & drop your csv file here/i)).toBeInTheDocument();
  });

  it("accepts a valid CSV dropped into the zone and notifies onFileAccepted", () => {
    const onFileAccepted = vi.fn();
    render(
      <ToastProvider>
        <BatchDropzone onFileAccepted={onFileAccepted} />
      </ToastProvider>
    );

    const dropzone = screen.getByTestId("csv-dropzone");
    const file = createMockFile("recipients.csv", "address,amount,memo\n", "text/csv");

    fireEvent.drop(dropzone, {
      dataTransfer: { files: [file] },
    });

    expect(onFileAccepted).toHaveBeenCalledTimes(1);
    expect(onFileAccepted).toHaveBeenCalledWith(file);
    expect(screen.queryByTestId("csv-dropzone-error")).toBeNull();
  });

  it("rejects non-CSV files immediately with user-friendly error and toast", async () => {
    const onFileAccepted = vi.fn();
    const onFileRejected = vi.fn();

    render(
      <ToastProvider>
        <BatchDropzone
          onFileAccepted={onFileAccepted}
          onFileRejected={onFileRejected}
        />
      </ToastProvider>
    );

    const dropzone = screen.getByTestId("csv-dropzone");
    const invalidFile = createMockFile("payroll.pdf", "fake pdf content", "application/pdf");

    fireEvent.drop(dropzone, {
      dataTransfer: { files: [invalidFile] },
    });

    // onFileAccepted must not be called
    expect(onFileAccepted).not.toHaveBeenCalled();
    expect(onFileRejected).toHaveBeenCalledWith(
      invalidFile,
      expect.stringMatching(/Invalid file format/i)
    );

    // Visual error state in dropzone
    expect(dropzone).toHaveAttribute("data-state", "error");
    const errorContainer = screen.getByTestId("csv-dropzone-error");
    expect(errorContainer).toBeInTheDocument();
    expect(within(errorContainer).getByText(/Upload Rejected/i)).toBeInTheDocument();
    expect(within(errorContainer).getByText(/Please upload a CSV file/i)).toBeInTheDocument();

    // Assertive error toast alert is displayed
    const toastAlert = await screen.findByRole("alert");
    expect(toastAlert).toBeInTheDocument();
    expect(within(toastAlert).getByText("Invalid file format")).toBeInTheDocument();
    expect(within(toastAlert).getByText(/Please upload a CSV file/i)).toBeInTheDocument();
  });

  it("displays parsing progress feedback when isParsing is true", () => {
    const onFileAccepted = vi.fn();
    const { rerender } = render(
      <ToastProvider>
        <BatchDropzone
          onFileAccepted={onFileAccepted}
          isParsing={true}
          fileMetadata={{ name: "large-batch.csv", sizeKb: "24.5", rowCount: 100 }}
        />
      </ToastProvider>
    );

    const dropzone = screen.getByTestId("csv-dropzone");
    expect(dropzone).toHaveAttribute("data-state", "parsing");
    expect(screen.getByTestId("csv-dropzone-parsing")).toBeInTheDocument();
    expect(screen.getByText("Parsing CSV file...")).toBeInTheDocument();
    expect(screen.getByText("large-batch.csv (24.5 KB)")).toBeInTheDocument();

    // Indeterminate progress bar
    expect(screen.getByRole("progressbar")).toBeInTheDocument();

    // Re-render with numeric progress
    rerender(
      <ToastProvider>
        <BatchDropzone
          onFileAccepted={onFileAccepted}
          isParsing={true}
          parseProgress={75}
          fileMetadata={{ name: "large-batch.csv", sizeKb: "24.5", rowCount: 100 }}
        />
      </ToastProvider>
    );
    expect(screen.getByText("75%")).toBeInTheDocument();
  });
});

describe("CsvBatchImport with BatchDropzone integration", () => {
  const VALID_ADDRESS = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

  it("displays file size in KB and row count immediately upon drop", async () => {
    const onRowsChange = vi.fn();
    const onValidityChange = vi.fn();

    render(
      <ToastProvider>
        <CsvBatchImport
          onRowsChange={onRowsChange}
          onValidityChange={onValidityChange}
        />
      </ToastProvider>
    );

    const dropzone = screen.getByTestId("csv-dropzone");
    const content = `address,amount,memo\n${VALID_ADDRESS},150,bonus\n`;
    const file = createMockFile("salaries.csv", content, "text/csv");

    fireEvent.drop(dropzone, {
      dataTransfer: { files: [file] },
    });

    await waitFor(() => {
      expect(screen.getByTestId("csv-summary")).toBeInTheDocument();
    });

    // File metadata displayed immediately
    expect(screen.getByTestId("csv-row-count")).toHaveTextContent("1 row");
    expect(screen.getByTestId("csv-file-size")).toHaveTextContent(/KB/);
    expect(screen.getByTestId("csv-summary")).toHaveTextContent(/all rows valid/i);
    expect(screen.getByTestId("csv-preview-table")).toBeInTheDocument();
  });
});
