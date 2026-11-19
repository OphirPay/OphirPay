// SPDX-License-Identifier: MIT

import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { useTableKeyboardNavigation } from "@/hooks/useTableKeyboardNavigation";

function TableHarness({ onActivate }: { onActivate?: (index: number) => void }) {
  const rows = ["alpha", "beta", "gamma"];
  const { activeIndex, getRowProps, onRowsKeyDown, tbodyRef } =
    useTableKeyboardNavigation(rows.length, { onActivate });

  return (
    <table>
      <tbody ref={tbodyRef} onKeyDown={onRowsKeyDown}>
        {rows.map((row, index) => (
          <tr key={row} data-row-index={index} {...getRowProps(index)}>
            <td>
              <span>{row}</span>
              <button type="button">{`action-${row}`}</button>
            </td>
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr>
          <td>{`active:${activeIndex}`}</td>
        </tr>
      </tfoot>
    </table>
  );
}

function ListHarness({ onActivate }: { onActivate?: (index: number) => void }) {
  const rows = ["one", "two"];
  const { getRowProps, onRowsKeyDown, tbodyRef } =
    useTableKeyboardNavigation<HTMLDivElement>(rows.length, {
      rowSelector: "[data-row-index]",
      onActivate,
    });

  return (
    <div ref={tbodyRef} onKeyDown={onRowsKeyDown}>
      {rows.map((row, index) => (
        <div
          key={row}
          role="listitem"
          data-row-index={index}
          {...getRowProps(index)}
        >
          {row}
        </div>
      ))}
    </div>
  );
}

describe("useTableKeyboardNavigation", () => {
  it("keeps exactly one row in the tab order", () => {
    render(<TableHarness />);
    const rows = screen.getAllByRole("row").filter((row) => row.dataset.rowIndex);

    expect(rows[0]).toHaveAttribute("tabindex", "0");
    expect(rows[1]).toHaveAttribute("tabindex", "-1");
    expect(rows[2]).toHaveAttribute("tabindex", "-1");
  });

  it("moves focus with ArrowDown/ArrowUp and updates the roving tabindex", () => {
    render(<TableHarness />);
    const rows = screen.getAllByRole("row").filter((row) => row.dataset.rowIndex);

    rows[0]!.focus();
    fireEvent.keyDown(rows[0]!, { key: "ArrowDown" });
    expect(rows[1]).toHaveFocus();
    expect(rows[1]).toHaveAttribute("tabindex", "0");
    expect(rows[0]).toHaveAttribute("tabindex", "-1");

    fireEvent.keyDown(rows[1]!, { key: "ArrowUp" });
    expect(rows[0]).toHaveFocus();
  });

  it("supports Home/End and ignores movement past the boundaries", () => {
    render(<TableHarness />);
    const rows = screen.getAllByRole("row").filter((row) => row.dataset.rowIndex);

    rows[0]!.focus();
    fireEvent.keyDown(rows[0]!, { key: "ArrowUp" });
    expect(rows[0]).toHaveFocus();

    fireEvent.keyDown(rows[0]!, { key: "End" });
    expect(rows[2]).toHaveFocus();

    fireEvent.keyDown(rows[2]!, { key: "ArrowDown" });
    expect(rows[2]).toHaveFocus();

    fireEvent.keyDown(rows[2]!, { key: "Home" });
    expect(rows[0]).toHaveFocus();
  });

  it("activates the focused row on Enter", () => {
    const onActivate = vi.fn();
    render(<TableHarness onActivate={onActivate} />);
    const rows = screen.getAllByRole("row").filter((row) => row.dataset.rowIndex);

    rows[1]!.focus();
    fireEvent.keyDown(rows[1]!, { key: "Enter" });

    expect(onActivate).toHaveBeenCalledWith(1);
  });

  it("lets a focused action button handle Enter itself", () => {
    const onActivate = vi.fn();
    render(<TableHarness onActivate={onActivate} />);

    const button = screen.getByRole("button", { name: "action-beta" });
    button.focus();
    fireEvent.keyDown(button, { key: "Enter" });

    expect(onActivate).not.toHaveBeenCalled();
  });

  it("works for card lists via a custom row selector", () => {
    const onActivate = vi.fn();
    render(<ListHarness onActivate={onActivate} />);

    const [first, second] = screen.getAllByRole("listitem");
    first!.focus();
    fireEvent.keyDown(first!, { key: "ArrowDown" });
    expect(second).toHaveFocus();

    fireEvent.keyDown(second!, { key: "Enter" });
    expect(onActivate).toHaveBeenCalledWith(1);
  });
});
