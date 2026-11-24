// SPDX-License-Identifier: MIT
// Tests for CsvBatchImport: drag-and-drop upload, preview table, inline
// error highlighting, re-validation on edit, and validity callbacks.

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import {
  CsvBatchImport,
  buildBatchPaymentsCsv,
  sanitizeCsvExportFilename,
  type CsvRecipientRow,
} from "@/components/CsvBatchImport";

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
    // onRowsChange is called from a passive effect, which React can flush
    // after the DOM commit that `findByText` observes, so the synchronous
    // assertion would still see the mount-time call with []. Wait for the
    // callback to settle instead of racing the effect flush.
    await waitFor(() => {
      expect(onRowsChange).toHaveBeenLastCalledWith([
        { address: VALID_ADDRESS, amount: "100", memo: undefined },
      ]);
    });
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

  it("summarizes every failing row with its source row number", async () => {
    setup();
    await uploadFile(
      screen.getByTestId("csv-file-input") as HTMLInputElement,
      csvFile(
        `address,amount,memo\nBAD_ONE,100,\n${VALID_ADDRESS},0,\n${OTHER_ADDRESS},5,\n`
      )
    );

    const summary = await screen.findByTestId("csv-row-errors");
    expect(summary).toHaveTextContent(/fix 2 rows to continue/i);
    expect(screen.getByTestId("csv-row-error-1")).toHaveTextContent(
      "Invalid Stellar address."
    );
    expect(screen.getByTestId("csv-row-error-2")).toHaveTextContent(
      "Amount must be a number greater than 0."
    );
    // The summary repeats each message, but must not make the inline cell
    // error ambiguous for exact-text queries.
    expect(screen.getAllByText("Invalid Stellar address.")).toHaveLength(1);
  });

  it("reports a file-level error when the file cannot be read", async () => {
    setup();
    const file = csvFile(
      `address,amount,memo\n${VALID_ADDRESS},100,\n`
    );
    vi.spyOn(file, "text").mockRejectedValueOnce(new Error("unreadable"));

    fireEvent.change(screen.getByTestId("csv-file-input") as HTMLInputElement, {
      target: { files: [file] },
    });

    expect(
      await screen.findByText(/could not read the csv file/i)
    ).toBeInTheDocument();
    expect(screen.queryByTestId("csv-preview-table")).toBeNull();
    expect(screen.queryByTestId("csv-row-errors")).toBeNull();
    // Zero parsed rows with a file error must not read as "all rows valid".
    expect(screen.getByTestId("csv-summary")).toHaveTextContent(/import blocked/i);
  });

  it("flags memos within 28 characters but over the server's 28-byte limit", async () => {
    setup();
    // 15 × "é" is 15 characters but 30 UTF-8 bytes: accepted by a naive
    // `.length <= 28` check, rejected by the batch API with a whole-batch
    // error that named no row.
    await uploadFile(
      screen.getByTestId("csv-file-input") as HTMLInputElement,
      csvFile(`address,amount,memo\n${VALID_ADDRESS},100,${"é".repeat(15)}\n`)
    );

    expect(await screen.findByTestId("csv-row-error-1")).toHaveTextContent(
      /28 bytes or fewer/i
    );
    expect(
      screen
        .getAllByRole("alert")
        .map((el) => el.textContent)
        .join(" ")
    ).toMatch(/28 bytes or fewer/i);
    expect(screen.getByTestId("csv-status")).toHaveTextContent(
      /fix the highlighted fields/i
    );
  });

  it("exports verified batch rows to CSV with Recipient, Amount, Asset, Memo columns and quotes commas (#1910)", async () => {
    expect(
      buildBatchPaymentsCsv([
        { address: VALID_ADDRESS, amount: "100", asset: "XLM", memo: "Q3, payroll" },
        { address: OTHER_ADDRESS, amount: "50.25", memo: 'Bonus "A"' },
      ])
    ).toBe(
      [
        "Recipient,Amount,Asset,Memo",
        `${VALID_ADDRESS},100,XLM,"Q3, payroll"`,
        `${OTHER_ADDRESS},50.25,XLM,"Bonus ""A"""`,
      ].join("\n")
    );

    expect(sanitizeCsvExportFilename("my unsafe/file:name!.csv")).toBe(
      "my-unsafe-file-name-verified.csv"
    );

    setup();
    await uploadFile(
      screen.getByTestId("csv-file-input") as HTMLInputElement,
      csvFile(`address,amount,memo\n${VALID_ADDRESS},100,"Hello, world"\n`)
    );

    const exportBtn = await screen.findByTestId("csv-export-btn");
    expect(exportBtn).toHaveTextContent(/export csv/i);

    const createObjectUrlSpy = vi
      .spyOn(URL, "createObjectURL")
      .mockReturnValue("blob:mock-csv-url");
    const revokeObjectUrlSpy = vi
      .spyOn(URL, "revokeObjectURL")
      .mockImplementation(() => {});
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});

    fireEvent.click(exportBtn);

    expect(createObjectUrlSpy).toHaveBeenCalledTimes(1);
    const blobArg = createObjectUrlSpy.mock.calls[0][0] as Blob;
    expect(blobArg.type).toContain("text/csv");
    expect(await blobArg.text()).toBe(
      `Recipient,Amount,Asset,Memo\n${VALID_ADDRESS},100,XLM,"Hello, world"`
    );
    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(revokeObjectUrlSpy).toHaveBeenCalledWith("blob:mock-csv-url");

    createObjectUrlSpy.mockRestore();
    revokeObjectUrlSpy.mockRestore();
    clickSpy.mockRestore();
  });

  it("updates memo byte counter in real-time and warns when exceeding 28 bytes (Issue #1898)", async () => {
    const { onValidityChange } = setup();

    await uploadFile(
      screen.getByTestId("csv-file-input") as HTMLInputElement,
      csvFile(`address,amount,memo\n${VALID_ADDRESS},100,short memo\n`)
    );

    await screen.findByTestId("csv-preview-table");
    expect(screen.getByTestId("memo-byte-counter")).toHaveTextContent("18 bytes remaining (10/28 B)");
    expect(screen.queryByTestId("memo-warning-badge")).toBeNull();

    // Type into memo field to exceed 28 bytes (e.g. 8 rocket emojis = 32 bytes)
    const memoInput = screen.getByDisplayValue("short memo");
    fireEvent.change(memoInput, { target: { value: "🚀🚀🚀🚀🚀🚀🚀🚀" } });

    // Real-time counter and warning badge appear immediately
    expect(await screen.findByTestId("memo-warning-badge")).toBeInTheDocument();
    expect(screen.getByTestId("memo-warning-badge")).toHaveTextContent(/Exceeds 28-byte limit/i);
    expect(screen.getByTestId("memo-byte-counter")).toHaveTextContent(/4 bytes over limit/i);

    // Validity is reported as false to disable submission
    await waitFor(() => {
      expect(onValidityChange).toHaveBeenLastCalledWith(false);
    });
    expect(screen.getByTestId("csv-status")).toHaveTextContent(/fix the highlighted fields/i);

    // Fix the memo back to <= 28 bytes
    fireEvent.change(memoInput, { target: { value: "valid-note" } });

    await waitFor(() => {
      expect(onValidityChange).toHaveBeenLastCalledWith(true);
    });
    expect(screen.queryByTestId("memo-warning-badge")).toBeNull();
    expect(screen.getByTestId("memo-byte-counter")).toHaveTextContent("18 bytes remaining (10/28 B)");
    expect(screen.getByTestId("csv-status")).toHaveTextContent(/ready to submit/i);
  });
});
