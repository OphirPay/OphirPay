// SPDX-License-Identifier: MIT
// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import {
  FOCUS_VISIBLE_ROW_CLASS,
  useTableKeyboardNavigation,
} from "@/hooks/useTableKeyboardNavigation";
import { Pagination } from "@/components/ui/Pagination";

function TestTable({
  rows,
  onActivate,
}: {
  rows: Array<{ id: string; label: string }>;
  onActivate?: (index: number) => void;
}) {
  const { activeIndex, getRowProps, onRowsKeyDown, tbodyRef } =
    useTableKeyboardNavigation(rows.length, { onRowActivate: onActivate });

  return (
    <div>
      <span data-testid="active-index">{activeIndex}</span>
      <table>
        <tbody ref={tbodyRef} onKeyDown={onRowsKeyDown}>
          {rows.map((r, i) => (
            <tr
              key={r.id}
              data-testid={`row-${i}`}
              className={FOCUS_VISIBLE_ROW_CLASS}
              {...getRowProps(i)}
            >
              <td>{r.label}</td>
              <td>
                <button type="button" data-testid={`action-${i}`}>
                  Inspect {r.id}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

describe("Table and list keyboard navigation (#1305)", () => {
  const SAMPLE_ROWS = [
    { id: "p1", label: "Payment #1" },
    { id: "p2", label: "Payment #2" },
    { id: "p3", label: "Payment #3" },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("navigates between rows with ArrowDown, ArrowUp, Home, and End using roving tabindex", () => {
    render(<TestTable rows={SAMPLE_ROWS} />);

    const row0 = screen.getByTestId("row-0");
    const row1 = screen.getByTestId("row-1");
    const row2 = screen.getByTestId("row-2");

    expect(row0.tabIndex).toBe(0);
    expect(row1.tabIndex).toBe(-1);
    expect(row2.tabIndex).toBe(-1);
    expect(row0.className).toContain("focus-visible:ring-2");

    row0.focus();
    fireEvent.keyDown(row0, { key: "ArrowDown" });
    expect(document.activeElement).toBe(row1);
    expect(row1.tabIndex).toBe(0);
    expect(row0.tabIndex).toBe(-1);

    fireEvent.keyDown(row1, { key: "End" });
    expect(document.activeElement).toBe(row2);
    expect(row2.tabIndex).toBe(0);

    fireEvent.keyDown(row2, { key: "ArrowUp" });
    expect(document.activeElement).toBe(row1);

    fireEvent.keyDown(row1, { key: "Home" });
    expect(document.activeElement).toBe(row0);
  });

  it("opens the detail view on Enter when focused on a row, without intercepting inner button Enter", () => {
    const onActivate = vi.fn();
    render(<TestTable rows={SAMPLE_ROWS} onActivate={onActivate} />);

    const row1 = screen.getByTestId("row-1");
    const actionBtn1 = screen.getByTestId("action-1");

    // Pressing Enter on inner button does not trigger row activation
    actionBtn1.focus();
    fireEvent.keyDown(actionBtn1, { key: "Enter" });
    expect(onActivate).not.toHaveBeenCalled();

    // Pressing Enter on the row itself triggers detail activation
    row1.focus();
    fireEvent.keyDown(row1, { key: "Enter" });
    expect(onActivate).toHaveBeenCalledWith(1);
  });

  it("exposes keyboard-accessible Pagination controls with ARIA labels and focus-visible rings", () => {
    const onNext = vi.fn();
    const onPrev = vi.fn();
    const onPage = vi.fn();

    render(
      <Pagination
        page={2}
        totalPages={4}
        hasNext={true}
        hasPrev={true}
        onNext={onNext}
        onPrev={onPrev}
        onPage={onPage}
      />,
    );

    const prevBtn = screen.getByRole("button", { name: "Previous page" });
    const nextBtn = screen.getByRole("button", { name: "Next page" });
    const page2Btn = screen.getByRole("button", { name: "Page 2" });
    const page3Btn = screen.getByRole("button", { name: "Page 3" });

    expect(page2Btn.getAttribute("aria-current")).toBe("page");
    expect(page3Btn.getAttribute("aria-current")).toBeNull();
    expect(page2Btn.className).toContain("focus-visible:ring-2");

    fireEvent.click(prevBtn);
    expect(onPrev).toHaveBeenCalledTimes(1);

    fireEvent.click(nextBtn);
    expect(onNext).toHaveBeenCalledTimes(1);

    fireEvent.click(page3Btn);
    expect(onPage).toHaveBeenCalledWith(3);
  });
});
