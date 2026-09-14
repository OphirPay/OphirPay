// SPDX-License-Identifier: MIT

import { describe, it, expect, beforeEach } from "vitest";
import { useState } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ToastProvider } from "@/components/ui/Toast";
import { AddressAutocomplete } from "@/components/AddressAutocomplete";
import { saveAddress, getAddressBook } from "@/lib/address-book";

const ADDR_A = "G" + "A".repeat(55);
const ADDR_B = "G" + "B".repeat(55);

/** Controlled harness — mirrors how the Send page owns the value state. */
function Harness({ initial = "" }: { initial?: string }) {
  const [value, setValue] = useState(initial);
  return (
    <ToastProvider>
      <AddressAutocomplete value={value} onChange={setValue} />
    </ToastProvider>
  );
}

function setup(initial = "") {
  return render(<Harness initial={initial} />);
}

beforeEach(() => {
  localStorage.clear();
});

describe("AddressAutocomplete", () => {
  it("shows matching address book entries while typing", async () => {
    saveAddress({ publicKey: ADDR_A, label: "Alice" });
    setup();
    const input = screen.getByRole("combobox");

    await userEvent.type(input, "alice");
    expect(screen.getByText("Alice")).toBeInTheDocument();
    // shortened address: first 7 chars + … + last 6
    expect(screen.getByText(/GAAAAAA\.\.\.AAAAAA/)).toBeInTheDocument();

    // Selecting fills the field with the saved address
    fireEvent.mouseDown(screen.getByText("Alice"));
    expect(input).toHaveValue(ADDR_A);
  });

  it("does not show the dropdown for an empty query", async () => {
    saveAddress({ publicKey: ADDR_A, label: "Alice" });
    setup();
    const input = screen.getByRole("combobox");
    await userEvent.click(input);
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("supports keyboard navigation (arrow down + enter)", async () => {
    saveAddress({ publicKey: ADDR_A, label: "Alice" });
    saveAddress({ publicKey: ADDR_B, label: "Bob" });
    setup();
    const input = screen.getByRole("combobox");

    await userEvent.type(input, "G");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });

    // Highlight moved past Alice (index 0) to Bob (index 1)
    expect(input).toHaveValue(ADDR_B);
  });

  it("offers to save a valid new address that is not in the book", async () => {
    setup();
    const input = screen.getByRole("combobox");

    await userEvent.type(input, ADDR_A);
    const saveOption = screen.getByText("+ Save to address book");
    expect(saveOption).toBeInTheDocument();

    fireEvent.mouseDown(saveOption);
    // Persisted with a shortened default label; field value untouched
    const book = getAddressBook();
    expect(book).toHaveLength(1);
    expect(book[0].publicKey).toBe(ADDR_A);
    expect(book[0].label).toContain("...");
    expect(input).toHaveValue(ADDR_A);
  });

  it("does not offer to save an already-saved or invalid address", async () => {
    saveAddress({ publicKey: ADDR_A, label: "Alice" });
    setup();
    const input = screen.getByRole("combobox");

    // Already in the book
    await userEvent.type(input, ADDR_A);
    expect(screen.queryByText("+ Save to address book")).not.toBeInTheDocument();

    // Not a valid Stellar address
    fireEvent.change(input, { target: { value: "not-a-stellar-address" } });
    expect(screen.queryByText("+ Save to address book")).not.toBeInTheDocument();
  });

  it("closes the dropdown on Escape", async () => {
    saveAddress({ publicKey: ADDR_A, label: "Alice" });
    setup();
    const input = screen.getByRole("combobox");

    await userEvent.type(input, "ali");
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });
});
