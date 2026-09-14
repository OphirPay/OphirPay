// SPDX-License-Identifier: MIT
// Component tests for AddressBookMultiSelect — multi-select contacts from the
// saved address book and add them to a batch with a default amount.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { AddressBookMultiSelect } from "@/components/batches/AddressBookMultiSelect";
import type { AddressEntry } from "@/lib/address-book";

const STORAGE_KEY = "ophirpay-address-book";

const ALICE = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const BOB = "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";
const CAROL = "GCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC";

function seedAddressBook(entries: AddressEntry[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
}

beforeEach(() => {
  localStorage.clear();
});

describe("AddressBookMultiSelect", () => {
  it("shows an empty state when the address book has no contacts", () => {
    render(<AddressBookMultiSelect onAdd={vi.fn()} />);
    expect(screen.getByText(/no saved contacts yet/i)).toBeInTheDocument();
  });

  it("renders saved contacts with label and shortened address", () => {
    seedAddressBook([
      { publicKey: ALICE, label: "Alice" },
      { publicKey: BOB, label: "Bob" },
    ]);
    render(<AddressBookMultiSelect onAdd={vi.fn()} />);
    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getByText("Bob")).toBeInTheDocument();
    expect(screen.getByText("GAAAAAA...AAAAAA")).toBeInTheDocument();
  });

  it("filters contacts by label", () => {
    seedAddressBook([
      { publicKey: ALICE, label: "Alice" },
      { publicKey: BOB, label: "Bob" },
    ]);
    render(<AddressBookMultiSelect onAdd={vi.fn()} />);
    fireEvent.change(screen.getByLabelText(/search address book/i), {
      target: { value: "bob" },
    });
    expect(screen.queryByText("Alice")).toBeNull();
    expect(screen.getByText("Bob")).toBeInTheDocument();
  });

  it("disables the add button until at least one contact is selected", () => {
    seedAddressBook([{ publicKey: ALICE, label: "Alice" }]);
    render(<AddressBookMultiSelect onAdd={vi.fn()} />);
    const addButton = screen.getByRole("button", { name: /add selected/i });
    expect(addButton).toBeDisabled();

    fireEvent.click(screen.getByRole("checkbox", { name: /add alice/i }));
    expect(addButton).toBeEnabled();
  });

  it("calls onAdd with the selected entries and default amount, then clears selection", () => {
    seedAddressBook([
      { publicKey: ALICE, label: "Alice" },
      { publicKey: BOB, label: "Bob" },
      { publicKey: CAROL, label: "Carol" },
    ]);
    const onAdd = vi.fn();
    render(<AddressBookMultiSelect onAdd={onAdd} />);

    fireEvent.click(screen.getByRole("checkbox", { name: /add alice/i }));
    fireEvent.click(screen.getByRole("checkbox", { name: /add carol/i }));
    fireEvent.change(screen.getByLabelText(/default amount/i), {
      target: { value: "10" },
    });
    fireEvent.click(screen.getByRole("button", { name: /add selected \(2\)/i }));

    expect(onAdd).toHaveBeenCalledTimes(1);
    const [entries, amount] = onAdd.mock.calls[0];
    expect(entries.map((e: AddressEntry) => e.publicKey)).toEqual([ALICE, CAROL]);
    expect(amount).toBe("10");

    // Selection is cleared after adding
    expect(screen.getByRole("button", { name: /add selected \(0\)/i })).toBeDisabled();
  });

  it("does not call onAdd when nothing is selected", () => {
    seedAddressBook([{ publicKey: ALICE, label: "Alice" }]);
    const onAdd = vi.fn();
    render(<AddressBookMultiSelect onAdd={onAdd} />);
    fireEvent.click(screen.getByRole("button", { name: /add selected \(0\)/i }));
    expect(onAdd).not.toHaveBeenCalled();
  });

  it("marks contacts already in the batch and excludes them from the count", () => {
    seedAddressBook([
      { publicKey: ALICE, label: "Alice" },
      { publicKey: BOB, label: "Bob" },
    ]);
    render(<AddressBookMultiSelect onAdd={vi.fn()} existingAddresses={[ALICE]} />);

    expect(screen.getByText("In batch")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: /add alice/i })).toBeDisabled();
    expect(screen.getByRole("checkbox", { name: /add bob/i })).toBeEnabled();
    expect(screen.getByRole("button", { name: /add selected \(0\)/i })).toBeDisabled();

    fireEvent.click(screen.getByRole("checkbox", { name: /add bob/i }));
    expect(screen.getByRole("button", { name: /add selected \(1\)/i })).toBeEnabled();
  });

  it("skips already-added addresses when merging selections", () => {
    seedAddressBook([
      { publicKey: ALICE, label: "Alice" },
      { publicKey: BOB, label: "Bob" },
    ]);
    const onAdd = vi.fn();
    render(<AddressBookMultiSelect onAdd={onAdd} existingAddresses={[ALICE]} />);

    // Bob is the only selectable contact; Alice stays out of the payload.
    fireEvent.click(screen.getByRole("checkbox", { name: /add bob/i }));
    fireEvent.click(screen.getByRole("button", { name: /add selected \(1\)/i }));

    expect(onAdd).toHaveBeenCalledTimes(1);
    const [entries] = onAdd.mock.calls[0];
    expect(entries.map((e: AddressEntry) => e.publicKey)).toEqual([BOB]);
  });
});
