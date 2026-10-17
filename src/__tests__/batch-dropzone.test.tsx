// SPDX-License-Identifier: MIT
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import {
  BatchDropzone,
  validateCsvFile,
  formatFileSize,
  type BatchDropzoneProps,
} from "@/components/batch/BatchDropzone";

describe("BatchDropzone Component (#1378)", () => {
  const defaultProps: BatchDropzoneProps = {
    onFileSelect: vi.fn(),
    onTemplateDownload: vi.fn(),
  };

  it("renders idle state with drag-and-drop prompt and template link", () => {
    render(<BatchDropzone {...defaultProps} />);
    expect(screen.getByTestId("csv-dropzone")).toBeInTheDocument();
    expect(screen.getByTestId("dropzone-idle-state")).toBeInTheDocument();
    expect(screen.getByText(/Drag & drop your CSV file here/i)).toBeInTheDocument();
    expect(screen.getByText(/Download template/i)).toBeInTheDocument();
  });

  it("toggles active visual state on dragover and dragleave", () => {
    render(<BatchDropzone {...defaultProps} />);
    const dropzone = screen.getByTestId("csv-dropzone");

    fireEvent.dragOver(dropzone);
    expect(screen.getByText("Drop your CSV here")).toBeInTheDocument();

    fireEvent.dragLeave(dropzone);
    expect(screen.getByText(/Drag & drop your CSV file here/i)).toBeInTheDocument();
  });

  it("rejects non-CSV files on drop and shows visual error state", async () => {
    const onFileSelect = vi.fn();
    render(<BatchDropzone {...defaultProps} onFileSelect={onFileSelect} />);
    const dropzone = screen.getByTestId("csv-dropzone");

    const invalidFile = new File(["binary data"], "payroll.pdf", { type: "application/pdf" });
    fireEvent.drop(dropzone, {
      dataTransfer: {
        files: [invalidFile],
      },
    });

    await waitFor(() => {
      expect(screen.getByTestId("dropzone-error-state")).toBeInTheDocument();
      expect(screen.getByText(/is not a CSV file/i)).toBeInTheDocument();
    });
    expect(onFileSelect).not.toHaveBeenCalled();
  });

  it("rejects empty 0-byte CSV files", async () => {
    const onFileSelect = vi.fn();
    render(<BatchDropzone {...defaultProps} onFileSelect={onFileSelect} />);
    const dropzone = screen.getByTestId("csv-dropzone");

    const emptyFile = new File([""], "empty.csv", { type: "text/csv" });
    fireEvent.drop(dropzone, {
      dataTransfer: {
        files: [emptyFile],
      },
    });

    await waitFor(() => {
      expect(screen.getByTestId("dropzone-error-state")).toBeInTheDocument();
      expect(screen.getByText(/is empty \(0 bytes\)/i)).toBeInTheDocument();
    });
    expect(onFileSelect).not.toHaveBeenCalled();
  });

  it("accepts valid CSV file and calls onFileSelect", async () => {
    const onFileSelect = vi.fn();
    render(<BatchDropzone {...defaultProps} onFileSelect={onFileSelect} />);
    const dropzone = screen.getByTestId("csv-dropzone");

    const validCsv = new File(["address,amount,memo\nGABC,100,memo"], "valid.csv", {
      type: "text/csv",
    });
    fireEvent.drop(dropzone, {
      dataTransfer: {
        files: [validCsv],
      },
    });

    await waitFor(() => {
      expect(onFileSelect).toHaveBeenCalledWith(validCsv);
    });
  });

  it("renders parsing progress state with progress bar when isParsing is true", () => {
    render(<BatchDropzone {...defaultProps} isParsing={true} parseProgress={65} />);
    expect(screen.getByTestId("dropzone-parsing-state")).toBeInTheDocument();
    expect(screen.getByText("Parsing batch CSV...")).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "65");
  });

  it("renders file metadata card when fileMetadata and showMetadataCard are provided", () => {
    render(
      <BatchDropzone
        {...defaultProps}
        showMetadataCard={true}
        fileMetadata={{
          name: "batch-payroll-q3.csv",
          sizeBytes: 15485,
          rowCount: 42,
        }}
      />
    );
    expect(screen.getByTestId("file-metadata-card")).toBeInTheDocument();
    expect(screen.getByTestId("metadata-filename")).toHaveTextContent("batch-payroll-q3.csv");
    expect(screen.getByTestId("metadata-details")).toHaveTextContent("15.1 KB · 42 rows");
  });

  it("triggers file input click on Enter or Space key navigation", () => {
    render(<BatchDropzone {...defaultProps} />);
    const dropzone = screen.getByTestId("csv-dropzone");
    const fileInput = screen.getByTestId("csv-file-input");

    const clickSpy = vi.spyOn(fileInput, "click");
    fireEvent.keyDown(dropzone, { key: "Enter" });
    expect(clickSpy).toHaveBeenCalled();

    clickSpy.mockClear();
    fireEvent.keyDown(dropzone, { key: " " });
    expect(clickSpy).toHaveBeenCalled();
  });

  it("triggers template download callback when clicked", () => {
    const onTemplateDownload = vi.fn();
    render(<BatchDropzone {...defaultProps} onTemplateDownload={onTemplateDownload} />);
    const downloadBtn = screen.getByText("Download template");

    fireEvent.click(downloadBtn);
    expect(onTemplateDownload).toHaveBeenCalledTimes(1);
  });

  describe("Utility helpers", () => {
    it("formatFileSize formats bytes, KB, and MB accurately", () => {
      expect(formatFileSize(500)).toBe("500 B");
      expect(formatFileSize(2048)).toBe("2.0 KB");
      expect(formatFileSize(1048576 * 2.5)).toBe("2.5 MB");
    });

    it("validateCsvFile validates extensions and MIME types", () => {
      const valid1 = new File(["a,b"], "test.csv", { type: "text/csv" });
      expect(validateCsvFile(valid1).isValid).toBe(true);

      const validExcel = new File(["a,b"], "test.csv", { type: "application/vnd.ms-excel" });
      expect(validateCsvFile(validExcel).isValid).toBe(true);

      const invalidExt = new File(["a,b"], "test.txt", { type: "text/plain" });
      expect(validateCsvFile(invalidExt).isValid).toBe(false);

      const invalidMime = new File(["a,b"], "test.csv", { type: "image/png" });
      expect(validateCsvFile(invalidMime).isValid).toBe(false);
    });
  });
});
