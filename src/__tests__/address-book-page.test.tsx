// SPDX-License-Identifier: MIT

import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ToastProvider } from "@/components/ui/Toast";
import AddressBookPage from "@/app/address-book/page";
import { saveAddress, getAddressBook } from "@/lib/address-book";
import { exportToCsv } from "@/lib/csv";

vi.mock("@/lib/csv", () => ({ exportToCsv: vi.fn() }));

const ADDR_A = "G" + "A".repeat(55);
const ADDR_B = "G" + "B".repeat(55);

function setup() {
  return render(
    <ToastProvider>
      <AddressBookPage />
    </ToastProvider>
  );
}

beforeEach(() => {
  localStorage.clear();
});

describe("AddressBookPage", () => {
  it("renders the empty state with no contacts", () => {
    setup();
    expect(
      screen.getByText(/your address book is empty/i)
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /add your first contact/i })
    ).toBeInTheDocument();
  });

  it("adds a contact via the modal", async () => {
    const user = userEvent.setup();
    setup();

    await user.click(screen.getByRole("button", { name: /add contact/i }));
    const dialog = screen.getByRole("dialog");

    await user.type(within(dialog).getByLabelText(/nickname/i), "Alice");
    await user.type(
      within(dialog).getByLabelText(/stellar address/i),
      ADDR_A
    );
    await user.click(
      within(dialog).getByRole("button", { name: /save contact/i })
    );

    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(getAddressBook()).toHaveLength(1);
    expect(getAddressBook()[0]).toMatchObject({
      publicKey: ADDR_A,
      label: "Alice",
    });
  });

  it("rejects an invalid address with an inline error", async () => {
    const user = userEvent.setup();
    setup();

    await user.click(screen.getByRole("button", { name: /add contact/i }));
    const dialog = screen.getByRole("dialog");

    await user.type(within(dialog).getByLabelText(/nickname/i), "Alice");
    await user.type(
      within(dialog).getByLabelText(/stellar address/i),
      "not-an-address"
    );
    await user.click(
      within(dialog).getByRole("button", { name: /save contact/i })
    );

    expect(screen.getByRole("alert")).toHaveTextContent(/invalid stellar address/i);
    expect(getAddressBook()).toHaveLength(0);
  });

  it("edits an existing contact", async () => {
    const user = userEvent.setup();
    saveAddress({ publicKey: ADDR_A, label: "Alice" });
    setup();

    await user.click(screen.getByRole("button", { name: /edit/i }));
    const dialog = screen.getByRole("dialog");

    const nickname = within(dialog).getByLabelText(/nickname/i);
    await user.clear(nickname);
    await user.type(nickname, "Alice — Freelance");
    await user.click(
      within(dialog).getByRole("button", { name: /save changes/i })
    );

    expect(screen.getByText("Alice — Freelance")).toBeInTheDocument();
    expect(getAddressBook()[0].label).toBe("Alice — Freelance");
    expect(getAddressBook()).toHaveLength(1); // no duplicate
  });

  it("deletes a contact after confirmation", async () => {
    const user = userEvent.setup();
    saveAddress({ publicKey: ADDR_A, label: "Alice" });
    saveAddress({ publicKey: ADDR_B, label: "Bob" });
    setup();

    await user.click(screen.getAllByRole("button", { name: /delete/i })[0]);
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent(/delete contact/i);

    await user.click(within(dialog).getByRole("button", { name: /^delete$/i }));

    const remaining = getAddressBook();
    expect(remaining).toHaveLength(1);
    expect(remaining[0].publicKey).toBe(ADDR_B);
  });

  it("searches contacts by nickname", async () => {
    saveAddress({ publicKey: ADDR_A, label: "Alice" });
    saveAddress({ publicKey: ADDR_B, label: "Bob" });
    setup();

    const search = screen.getByLabelText(/search contacts/i);
    fireEvent.change(search, { target: { value: "bob" } });

    expect(screen.getByText("Bob")).toBeInTheDocument();
    expect(screen.queryByText("Alice")).not.toBeInTheDocument();
  });

  it("imports a CSV and displays row-level rejections", async () => {
    setup();
    const input = screen.getByTestId("address-book-csv-input");
    const file = new File(
      [`label,address,memo\n"Alice, work",${ADDR_A},Invoice\nBad,invalid,\n`],
      "contacts.csv",
      { type: "text/csv" }
    );
    fireEvent.change(input, { target: { files: [file] } });

    expect(await screen.findByText("Alice, work")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Import complete: 1 added, 0 updated, 1 rejected."
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Row 3: Invalid Stellar address.");
    expect(getAddressBook()).toMatchObject([
      { publicKey: ADDR_A, label: "Alice, work", memo: "Invoice" },
    ]);
  });

  it("exports all contacts as label, publicKey, and memo CSV columns", () => {
    saveAddress({ publicKey: ADDR_A, label: "Alice", memo: "Invoice" });
    setup();

    fireEvent.click(screen.getByRole("button", { name: /export csv/i }));

    expect(exportToCsv).toHaveBeenCalledWith(
      [{ label: "Alice", publicKey: ADDR_A, memo: "Invoice" }],
      [
        { key: "label", header: "label" },
        { key: "publicKey", header: "publicKey" },
        { key: "memo", header: "memo" },
      ],
      { filename: "ophirpay-address-book.csv" }
    );
  });
});
