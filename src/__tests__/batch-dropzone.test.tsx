// SPDX-License-Identifier: MIT

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import {
  BatchDropzone,
  validateCsvFile,
  formatFileSize,
} from "@/components/batch/BatchDropzone";
import { ToastProvider } from "@/components/ui/Toast";

describe("BatchDropzone Component (#1378)", () => {
  describe("formatFileSize", () => {
    it("formats bytes, KB, and MB accurately", () => {
      expect(formatFileSize(500)).toBe("500 B");
      expect(formatFileSize(2048)).toBe("2.0 KB");
      expect(formatFileSize(15360)).toBe("15.0 KB");
      expect(formatFileSize(2097152)).toBe("2.0 MB");
      expect(formatFileSize(null)).toBe("");
    });
  });

  describe("validateCsvFile", () => {
    it("accepts valid .csv files with standard MIME types", () => {
      const file = new File(["address,amount\nGA...,10\n"], "test.csv", {
        type: "text/csv",
      });
      expect(validateCsvFile(file).valid).toBe(true);
    });

    it("rejects non-csv file extensions immediately", () => {
      const file = new File(["binary-data"], "photo.png", {
        type: "image/png",
      });
      const res = validateCsvFile(file);
      expect(res.valid).toBe(false);
      expect(res.error).toMatch(/Invalid file format/i);
    });

    it("rejects non-csv MIME types even if named .csv", () => {
      const file = new File(["binary-data"], "malicious.csv", {
        type: "application/x-executable",
      });
      const res = validateCsvFile(file);
      expect(res.valid).toBe(false);
      expect(res.error).toMatch(/Unsupported MIME type/i);
    });

    it("rejects empty 0-byte files", () => {
      const file = new File([], "empty.csv", {
        type: "text/csv",
      });
      const res = validateCsvFile(file);
      expect(res.valid).toBe(false);
      expect(res.error).toMatch(/empty/i);
    });
  });

  describe("Visual states and interactions", () => {
    it("renders idle state with upload prompt and template download", () => {
      const onDownload = vi.fn();
      render(
        <BatchDropzone
          onFileSelect={vi.fn()}
          onTemplateDownload={onDownload}
        />
      );

      expect(screen.getByTestId("csv-dropzone")).toHaveAttribute("data-state", "idle");
      expect(screen.getByText(/drag & drop your csv file here/i)).toBeInTheDocument();
      expect(screen.getByText(/download template/i)).toBeInTheDocument();

      fireEvent.click(screen.getByText(/download template/i));
      expect(onDownload).toHaveBeenCalledTimes(1);
    });

    it("transitions to active state on drag over and returns to idle on drag leave", () => {
      render(<BatchDropzone onFileSelect={vi.fn()} />);
      const dropzone = screen.getByTestId("csv-dropzone");

      fireEvent.dragOver(dropzone);
      expect(dropzone).toHaveAttribute("data-state", "active");
      expect(screen.getByText(/drop your csv file here/i)).toBeInTheDocument();

      fireEvent.dragLeave(dropzone);
      expect(dropzone).toHaveAttribute("data-state", "idle");
    });

    it("processes valid dropped CSV and invokes onFileSelect", async () => {
      const onSelect = vi.fn();
      render(<BatchDropzone onFileSelect={onSelect} />);
      const dropzone = screen.getByTestId("csv-dropzone");

      const file = new File(["address,amount\nGA...,50"], "recipients.csv", {
        type: "text/csv",
      });

      fireEvent.drop(dropzone, {
        dataTransfer: {
          files: [file],
        },
      });

      await waitFor(() => {
        expect(onSelect).toHaveBeenCalledWith(file);
      });
    });

    it("displays error state when invalid file is dropped", async () => {
      render(
        <ToastProvider>
          <BatchDropzone onFileSelect={vi.fn()} />
        </ToastProvider>
      );
      const dropzone = screen.getByTestId("csv-dropzone");

      const invalidFile = new File(["some-image"], "avatar.png", {
        type: "image/png",
      });

      fireEvent.drop(dropzone, {
        dataTransfer: {
          files: [invalidFile],
        },
      });

      await waitFor(() => {
        expect(dropzone).toHaveAttribute("data-state", "error");
        expect(screen.getByTestId("dropzone-error")).toBeInTheDocument();
        expect(within(screen.getByTestId("dropzone-error")).getByText(/Invalid file format.*\.csv/i)).toBeInTheDocument();
      });
    });

    it("renders parsing state with ProgressBar", () => {
      render(
        <BatchDropzone
          onFileSelect={vi.fn()}
          isParsing={true}
          parseProgress={65}
        />
      );

      const dropzone = screen.getByTestId("csv-dropzone");
      expect(dropzone).toHaveAttribute("data-state", "parsing");
      expect(screen.getByTestId("dropzone-parsing")).toBeInTheDocument();
      expect(screen.getByText(/parsing and validating recipients/i)).toBeInTheDocument();
      expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "65");
    });

    it("displays file metadata before verification", () => {
      const onClear = vi.fn();
      render(
        <BatchDropzone
          onFileSelect={vi.fn()}
          fileName="payroll_october.csv"
          fileSize={24576} // 24 KB
          rowCount={45}
          onClear={onClear}
        />
      );

      expect(screen.getByTestId("file-metadata-card")).toBeInTheDocument();
      expect(screen.getByText("payroll_october.csv")).toBeInTheDocument();
      expect(screen.getByTestId("file-size-badge")).toHaveTextContent("24.0 KB");
      expect(screen.getByTestId("file-row-count")).toHaveTextContent("45 rows");

      fireEvent.click(screen.getByText(/remove file/i));
      expect(onClear).toHaveBeenCalledTimes(1);
    });

    it("supports keyboard access via Enter and Space to click hidden input", () => {
      render(<BatchDropzone onFileSelect={vi.fn()} />);
      const dropzone = screen.getByTestId("csv-dropzone");
      const fileInput = screen.getByTestId("csv-file-input") as HTMLInputElement;

      const clickSpy = vi.spyOn(fileInput, "click");

      fireEvent.keyDown(dropzone, { key: "Enter" });
      expect(clickSpy).toHaveBeenCalledTimes(1);

      fireEvent.keyDown(dropzone, { key: " " });
      expect(clickSpy).toHaveBeenCalledTimes(2);
    });
  });
});
