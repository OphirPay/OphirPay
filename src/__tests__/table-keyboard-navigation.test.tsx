// SPDX-License-Identifier: MIT

import { describe, it, expect, vi } from "vitest";
import { act, render, screen, fireEvent, renderHook } from "@testing-library/react";
import React from "react";
import { useTableKeyboardNavigation } from "@/hooks/useTableKeyboardNavigation";
import { Pagination } from "@/components/ui/Pagination";

function TestTable({
  rowCount = 3,
  onSelect,
}: {
  rowCount?: number;
  onSelect?: (index: number) => void;
}) {
  const { getRowProps, onRowsKeyDown, tbodyRef } =
    useTableKeyboardNavigation(rowCount, { onRowSelect: onSelect });

  return (
    <table aria-label="Test Table">
      <tbody ref={tbodyRef} onKeyDown={onRowsKeyDown}>
        {Array.from({ length: rowCount }).map((_, i) => (
          <tr key={i} data-row-index={i} {...getRowProps(i)} data-testid={`row-${i}`}>
            <td>Row {i}</td>
            <td>
              <button type="button" data-testid={`action-${i}`}>
                Action {i}
              </button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

describe("useTableKeyboardNavigation", () => {
  it("initializes activeIndex to -1 when rowCount is 0, and 0 when rowCount > 0", () => {
    const { result: emptyResult } = renderHook(() => useTableKeyboardNavigation(0));
    expect(emptyResult.current.activeIndex).toBe(-1);

    const { result: filledResult } = renderHook(() => useTableKeyboardNavigation(5));
    expect(filledResult.current.activeIndex).toBe(0);
  });

  it("clamps activeIndex when rowCount decreases", () => {
    let count = 5;
    const { result, rerender } = renderHook(() => useTableKeyboardNavigation(count));
    expect(result.current.activeIndex).toBe(0);

    // Simulate navigating to row 4
    act(() => {
      result.current.getRowProps(4).onFocus();
    });
    expect(result.current.activeIndex).toBe(4);

    // Reduce rowCount to 3 — should clamp to 2
    count = 3;
    rerender();
    expect(result.current.activeIndex).toBe(2);

    // Reduce rowCount to 0 — should reset to -1
    count = 0;
    rerender();
    expect(result.current.activeIndex).toBe(-1);
  });

  it("supports roving tabindex and navigates with Arrow keys, Home, and End", () => {
    render(<TestTable rowCount={4} />);
    const row0 = screen.getByTestId("row-0");
    const row1 = screen.getByTestId("row-1");
    const row2 = screen.getByTestId("row-2");
    const row3 = screen.getByTestId("row-3");

    expect(row0).toHaveAttribute("tabindex", "0");
    expect(row1).toHaveAttribute("tabindex", "-1");
    expect(row2).toHaveAttribute("tabindex", "-1");
    expect(row3).toHaveAttribute("tabindex", "-1");

    // ArrowDown moves from 0 to 1
    fireEvent.keyDown(row0, { key: "ArrowDown" });
    expect(row1).toHaveFocus();
    expect(row1).toHaveAttribute("tabindex", "0");
    expect(row0).toHaveAttribute("tabindex", "-1");

    // End jumps to last row
    fireEvent.keyDown(row1, { key: "End" });
    expect(row3).toHaveFocus();
    expect(row3).toHaveAttribute("tabindex", "0");

    // Home jumps to first row
    fireEvent.keyDown(row3, { key: "Home" });
    expect(row0).toHaveFocus();
    expect(row0).toHaveAttribute("tabindex", "0");

    // ArrowUp on first row clamps at 0
    fireEvent.keyDown(row0, { key: "ArrowUp" });
    expect(row0).toHaveFocus();
  });

  it("triggers onRowSelect when Enter is pressed on a row", () => {
    const handleSelect = vi.fn();
    render(<TestTable rowCount={3} onSelect={handleSelect} />);
    const row1 = screen.getByTestId("row-1");

    fireEvent.focus(row1);
    fireEvent.keyDown(row1, { key: "Enter" });

    expect(handleSelect).toHaveBeenCalledWith(1);
  });

  it("does not intercept Enter when focus is inside a child button", () => {
    const handleSelect = vi.fn();
    render(<TestTable rowCount={3} onSelect={handleSelect} />);
    const button0 = screen.getByTestId("action-0");

    fireEvent.keyDown(button0, { key: "Enter" });
    expect(handleSelect).not.toHaveBeenCalled();
  });
});

describe("Pagination keyboard accessibility", () => {
  it("renders accessible buttons with focus visible styling and aria attributes", () => {
    const onNext = vi.fn();
    const onPrev = vi.fn();
    const onPage = vi.fn();

    render(
      <Pagination
        page={2}
        totalPages={5}
        hasNext={true}
        hasPrev={true}
        onNext={onNext}
        onPrev={onPrev}
        onPage={onPage}
      />
    );

    const prevBtn = screen.getByTestId("pagination-prev");
    const nextBtn = screen.getByTestId("pagination-next");
    const page2Btn = screen.getByTestId("pagination-page-2");
    const page3Btn = screen.getByTestId("pagination-page-3");

    expect(prevBtn).toHaveClass("focus-visible:ring-2");
    expect(nextBtn).toHaveClass("focus-visible:ring-2");
    expect(page2Btn).toHaveAttribute("aria-current", "page");
    expect(page3Btn).not.toHaveAttribute("aria-current");

    fireEvent.click(page3Btn);
    expect(onPage).toHaveBeenCalledWith(3);

    fireEvent.click(nextBtn);
    expect(onNext).toHaveBeenCalled();
  });
});
