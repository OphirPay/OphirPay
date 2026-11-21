// SPDX-License-Identifier: MIT

import { fireEvent,render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach,describe, expect, it, vi } from "vitest";

import { AddressBookMultiSelect } from "@/components/batches/AddressBookMultiSelect";

vi.mock("@/lib/address-book", () => ({
  getAddressBook: () => [
    { label: "Alice", publicKey: "GDUMMY1111111111111111111111111111111111111111111111111111111" },
    { label: "Bob", publicKey: "GDUMMY2222222222222222222222222222222222222222222222222222222" },
  ],
}));

describe("AddressBookMultiSelect component", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders contacts and multi-select controls", () => {
    render(<AddressBookMultiSelect onAdd={vi.fn()} />);

    expect(screen.getByText("Alice")).toBeDefined();
    expect(screen.getByText("Bob")).toBeDefined();
    expect(screen.getByRole("button", { name: /Add Selected/ })).toBeDisabled();
  });

  it("enables selection and calls onAdd with selected contacts and default amount", async () => {
    const onAdd = vi.fn();
    const user = userEvent.setup();

    render(<AddressBookMultiSelect onAdd={onAdd} />);

    const checkbox = screen.getByRole("checkbox", { name: "Add Alice" });
    await user.click(checkbox);

    const amountInput = screen.getByLabelText("Default amount per recipient");
    await user.type(amountInput, "15.5");

    const addBtn = screen.getByRole("button", { name: "Add Selected (1)" });
    expect(addBtn).not.toBeDisabled();

    await user.click(addBtn);
    expect(onAdd).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ label: "Alice" })]),
      "15.5"
    );
  });

  it("shows scroll indicators when horizontal overflow is detected", () => {
    render(<AddressBookMultiSelect onAdd={vi.fn()} />);

    const wrapper = screen.getByTestId("address-book-scroll-wrapper");
    expect(wrapper).toBeDefined();

    // Mock scroll dimensions with overflow
    Object.defineProperty(wrapper, "scrollWidth", { value: 600, configurable: true });
    Object.defineProperty(wrapper, "clientWidth", { value: 300, configurable: true });
    Object.defineProperty(wrapper, "scrollLeft", { value: 50, configurable: true, writable: true });

    fireEvent.scroll(wrapper);

    expect(screen.getByTestId("scroll-indicator-left")).toBeDefined();
    expect(screen.getByTestId("scroll-indicator-right")).toBeDefined();
  });
});
