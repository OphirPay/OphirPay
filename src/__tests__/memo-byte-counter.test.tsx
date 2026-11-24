// SPDX-License-Identifier: MIT
// Regression tests for the Stellar memo byte-length warning indicator
// (issue #1898): a live UTF-8 byte counter that warns when a memo exceeds
// the recommended 28-byte text-memo limit.

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { CsvBatchImport, type CsvRecipientRow } from "@/components/CsvBatchImport";
import { getMemoByteUsage, MEMO_TEXT_BYTE_LIMIT } from "@/lib/memo";

const VALID_ADDRESS = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const OTHER_ADDRESS = "G" + "B".repeat(55);

function csvFile(content: string, name = "recipients.csv"): File {
  return new File([content], name, { type: "text/csv" });
}

async function uploadFile(input: HTMLInputElement, file: File) {
  fireEvent.change(input, { target: { files: [file] } });
}

function setup() {
  const onRowsChange = vi.fn<(rows: CsvRecipientRow[]) => void>();
  const onValidityChange = vi.fn<(valid: boolean) => void>();
  render(
    <CsvBatchImport
      selfAddress={null}
      onRowsChange={onRowsChange}
      onValidityChange={onValidityChange}
    />
  );
  return { onRowsChange, onValidityChange };
}

describe("getMemoByteUsage", () => {
  it("counts ASCII characters as one byte each", () => {
    const usage = getMemoByteUsage("invoice-10294");
    expect(usage.bytes).toBe(13);
    expect(usage.limit).toBe(MEMO_TEXT_BYTE_LIMIT);
    expect(usage.remaining).toBe(15);
    expect(usage.exceeded).toBe(false);
  });

  it("counts multi-byte UTF-8 characters as more than one byte", () => {
    // "€" is 3 UTF-8 bytes; "😀" is 4 UTF-8 bytes.
    const usage = getMemoByteUsage("€😀");
    expect(usage.bytes).toBe(7);
    expect(usage.exceeded).toBe(false);
  });

  it("flags a memo that exceeds the 28-byte limit", () => {
    const usage = getMemoByteUsage("x".repeat(29));
    expect(usage.bytes).toBe(29);
    expect(usage.remaining).toBe(0);
    expect(usage.exceeded).toBe(true);
  });

  it("treats exactly 28 bytes as within the limit", () => {
    const usage = getMemoByteUsage("y".repeat(28));
    expect(usage.bytes).toBe(28);
    expect(usage.remaining).toBe(0);
    expect(usage.exceeded).toBe(false);
  });

  it("honours a custom limit", () => {
    const usage = getMemoByteUsage("abcde", 3);
    expect(usage.limit).toBe(3);
    expect(usage.remaining).toBe(0);
    expect(usage.exceeded).toBe(true);
  });
});

describe("CsvBatchImport memo byte counter", () => {
  it("shows a live byte counter for the memo field", async () => {
    setup();
    await uploadFile(
      screen.getByTestId("csv-file-input") as HTMLInputElement,
      csvFile(`address,amount,memo\n${VALID_ADDRESS},100,thanks\n`)
    );

    const counter = await screen.findByTestId("memo-byte-counter");
    // "thanks" is 6 ASCII bytes.
    expect(counter).toHaveTextContent("6/28 bytes");
    expect(counter).toHaveAttribute("data-exceeded", "false");
  });

  it("warns when the memo exceeds 28 UTF-8 bytes", async () => {
    setup();
    await uploadFile(
      screen.getByTestId("csv-file-input") as HTMLInputElement,
      csvFile(`address,amount,memo\n${VALID_ADDRESS},100,short\n`)
    );

    const input = await screen.findByTestId("memo-input");
    // 29 ASCII characters → 29 bytes, one over the limit.
    fireEvent.change(input, { target: { value: "z".repeat(29) } });

    const counter = screen.getByTestId("memo-byte-counter");
    expect(counter).toHaveTextContent("29/28 bytes");
    expect(counter).toHaveTextContent(/1 over/);
    expect(counter).toHaveAttribute("data-exceeded", "true");
  });

  it("counts multi-byte characters in the live counter", async () => {
    setup();
    await uploadFile(
      screen.getByTestId("csv-file-input") as HTMLInputElement,
      csvFile(`address,amount,memo\n${VALID_ADDRESS},100,\n${OTHER_ADDRESS},50,\n`)
    );

    // Scope to the first row's memo input (one per row).
    const row = await screen.findByTestId("csv-row-1");
    const input = row.querySelector('[data-testid="memo-input"]') as HTMLInputElement;
    // "€" is 3 bytes; 10 of them = 30 bytes → 2 over the limit.
    fireEvent.change(input, { target: { value: "€".repeat(10) } });

    const counter = row.querySelector('[data-testid="memo-byte-counter"]') as HTMLElement;
    expect(counter).toHaveTextContent("30/28 bytes");
    expect(counter).toHaveTextContent(/2 over/);
    expect(counter).toHaveAttribute("data-exceeded", "true");
  });
});