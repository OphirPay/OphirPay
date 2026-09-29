// SPDX-License-Identifier: MIT
// Tests for AddressBookCsvImport: uploading a CSV saves valid rows
// immediately and reports invalid rows with their row number and reason.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { AddressBookCsvImport } from "@/components/AddressBookCsvImport";
import { getAddressBook } from "@/lib/address-book";

const ADDR_A = "G" + "A".repeat(55);
const ADDR_B = "G" + "B".repeat(55);

function csvFile(content: string, name = "address-book.csv"): File {
  return new File([content], name, { type: "text/csv" });
}

async function uploadFile(input: HTMLInputElement, file: File) {
  fireEvent.change(input, { target: { files: [file] } });
}

beforeEach(() => {
  localStorage.clear();
});

function setup() {
  const onImported = vi.fn<(count: number) => void>();
  render(<AddressBookCsvImport onImported={onImported} />);
  return { onImported };
}

describe("AddressBookCsvImport", () => {
  it("renders a dropzone with upload instructions", () => {
    setup();
    expect(screen.getByTestId("address-book-csv-dropzone")).toBeInTheDocument();
    expect(screen.getByText(/drag & drop your csv file here/i)).toBeInTheDocument();
  });

  it("imports all rows from a valid file and reports the count", async () => {
    const { onImported } = setup();
    await uploadFile(
      screen.getByTestId("address-book-csv-file-input") as HTMLInputElement,
      csvFile(`label,address,memo\nAlice,${ADDR_A},thanks\nBob,${ADDR_B},\n`)
    );

    await waitFor(() => {
      expect(onImported).toHaveBeenCalledWith(2);
    });
    expect(getAddressBook()).toHaveLength(2);
    expect(screen.getByTestId("address-book-csv-summary")).toHaveTextContent(
      /imported 2 of 2 contacts/i
    );
  });

  it("keeps valid rows and reports invalid ones with row number and reason", async () => {
    const { onImported } = setup();
    await uploadFile(
      screen.getByTestId("address-book-csv-file-input") as HTMLInputElement,
      csvFile(`label,address,memo\nAlice,${ADDR_A},\nBob,not-an-address,\n`)
    );

    await waitFor(() => {
      expect(onImported).toHaveBeenCalledWith(1);
    });
    expect(getAddressBook()).toHaveLength(1);
    expect(getAddressBook()[0]).toMatchObject({ label: "Alice", publicKey: ADDR_A });

    expect(screen.getByTestId("address-book-csv-summary")).toHaveTextContent(
      /imported 1 of 2 contacts.*1 row skipped/i
    );
    expect(screen.getByTestId("address-book-csv-row-2")).toHaveTextContent(
      "Row 2: Invalid Stellar address."
    );
  });

  it("shows a clear message for a header-only file without importing anything", async () => {
    const { onImported } = setup();
    await uploadFile(
      screen.getByTestId("address-book-csv-file-input") as HTMLInputElement,
      csvFile("label,address,memo\n")
    );

    expect(
      await screen.findByText(/must have a header row and at least one data row/i)
    ).toBeInTheDocument();
    expect(onImported).not.toHaveBeenCalled();
    expect(getAddressBook()).toHaveLength(0);
  });

  it("shows a clear message for an empty file", async () => {
    setup();
    await uploadFile(
      screen.getByTestId("address-book-csv-file-input") as HTMLInputElement,
      csvFile("")
    );

    expect(await screen.findByText(/csv file is empty/i)).toBeInTheDocument();
  });
});
