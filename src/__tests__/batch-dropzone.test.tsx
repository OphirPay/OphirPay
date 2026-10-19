// SPDX-License-Identifier: MIT
// Tests for BatchDropzone: visual states (idle / drag-over / parsing / error),
// CSV validation before ingestion, and the imperative reset/openPicker API.

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import {
  BatchDropzone,
  type BatchDropzoneHandle,
} from "@/components/batch/BatchDropzone";

function csvFile(name = "recipients.csv") {
  return new File(["address,amount,memo"], name, { type: "text/csv" });
}

function otherFile(name = "notes.txt") {
  return new File(["hello"], name, { type: "text/plain" });
}

describe("BatchDropzone", () => {
  it("renders the idle dropzone with upload instructions", () => {
    render(<BatchDropzone onFileAccepted={() => {}} />);
    expect(screen.getByTestId("csv-dropzone")).toBeInTheDocument();
    expect(
      screen.getByText(/drag & drop your csv file here/i)
    ).toBeInTheDocument();
    expect(screen.getByText(/download template/i)).toBeInTheDocument();
  });

  it("shows the active state while a file is dragged over", () => {
    render(<BatchDropzone onFileAccepted={() => {}} />);
    const zone = screen.getByTestId("csv-dropzone");
    fireEvent.dragOver(zone);
    expect(screen.getByText(/drop your csv here/i)).toBeInTheDocument();
    fireEvent.dragLeave(zone);
    expect(
      screen.getByText(/drag & drop your csv file here/i)
    ).toBeInTheDocument();
  });

  it("rejects a non-CSV file and reports a user-friendly message", () => {
    const onRejected = vi.fn();
    render(<BatchDropzone onFileAccepted={() => {}} onRejected={onRejected} />);
    fireEvent.change(
      screen.getByTestId("csv-file-input") as HTMLInputElement,
      { target: { files: [otherFile()] } }
    );
    expect(onRejected).toHaveBeenCalledTimes(1);
    expect(onRejected.mock.calls[0][0]).toMatch(/not a csv file/i);
    expect(screen.getByRole("alert")).toHaveTextContent(/not a csv file/i);
  });

  it("accepts a valid CSV and forwards it to onFileAccepted", () => {
    const onFileAccepted = vi.fn();
    render(<BatchDropzone onFileAccepted={onFileAccepted} />);
    fireEvent.change(
      screen.getByTestId("csv-file-input") as HTMLInputElement,
      { target: { files: [csvFile()] } }
    );
    expect(onFileAccepted).toHaveBeenCalledTimes(1);
    expect((onFileAccepted.mock.calls[0][0] as File).name).toBe(
      "recipients.csv"
    );
  });

  it("shows an indeterminate progress bar while parsing", () => {
    const { rerender } = render(
      <BatchDropzone onFileAccepted={() => {}} parsing={false} />
    );
    expect(screen.queryByRole("progressbar")).toBeNull();
    rerender(<BatchDropzone onFileAccepted={() => {}} parsing />);
    const bar = screen.getByRole("progressbar");
    expect(bar).toBeInTheDocument();
    expect(bar).toHaveAttribute("aria-busy", "true");
  });

  it("exposes reset() and openPicker() via ref", () => {
    const ref: { current: BatchDropzoneHandle | null } = { current: null };
    render(<BatchDropzone ref={ref} onFileAccepted={() => {}} />);
    expect(ref.current).not.toBeNull();
    // openPicker must not throw (jsdom has no real file dialog).
    expect(() => act(() => ref.current?.openPicker())).not.toThrow();
    fireEvent.change(
      screen.getByTestId("csv-file-input") as HTMLInputElement,
      { target: { files: [csvFile()] } }
    );
    act(() => ref.current?.reset());
  });
});
