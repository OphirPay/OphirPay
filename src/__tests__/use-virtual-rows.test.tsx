// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import {
  DEFAULT_OVERSCAN,
  DEFAULT_ROW_HEIGHT,
  DEFAULT_VIEWPORT_HEIGHT,
  useVirtualRows,
} from "@/hooks/useVirtualRows";

/** Rows that fit on one screen with the default height/row-height ratio. */
const PER_SCREEN = Math.ceil(DEFAULT_VIEWPORT_HEIGHT / DEFAULT_ROW_HEIGHT);

interface VirtualState {
  startIndex: number;
  endIndex: number;
  padTop: number;
  padBottom: number;
  isFullyRendered: boolean;
}

interface HarnessProps {
  rowCount: number;
  rowHeight?: number;
  overscan?: number;
}

function Harness({ rowCount, rowHeight, overscan }: HarnessProps) {
  const virtual = useVirtualRows({ rowCount, rowHeight, overscan });
  return (
    <div>
      <div data-testid="state">
        {JSON.stringify({
          startIndex: virtual.startIndex,
          endIndex: virtual.endIndex,
          padTop: virtual.padTop,
          padBottom: virtual.padBottom,
          isFullyRendered: virtual.isFullyRendered,
        })}
      </div>
      <div
        ref={virtual.scrollRef}
        data-testid="scroller"
        style={{ overflowY: "auto" }}
      />
      <button type="button" onClick={() => virtual.scrollToIndex(100)}>
        jump to 100
      </button>
      <button type="button" onClick={() => virtual.scrollToIndex(rowCount - 1)}>
        jump to last
      </button>
    </div>
  );
}

function readState(): VirtualState {
  return JSON.parse(screen.getByTestId("state").textContent ?? "{}") as VirtualState;
}

/**
 * jsdom has no layout, so the scroll container always reports `clientHeight`
 * 0 and drops `scrollTop`. Give the element real numbers so the hook's
 * measurement path exercises its real branches.
 */
function mockLayout(element: HTMLElement, height = DEFAULT_VIEWPORT_HEIGHT) {
  let scrollTopValue = 0;
  Object.defineProperty(element, "clientHeight", {
    configurable: true,
    value: height,
  });
  Object.defineProperty(element, "scrollTop", {
    configurable: true,
    get: () => scrollTopValue,
    set: (v: number) => {
      scrollTopValue = v;
    },
  });
}

describe("useVirtualRows hook", () => {
  it("treats an empty row set as fully rendered with no spacers", () => {
    render(<Harness rowCount={0} />);
    const state = readState();

    expect(state.startIndex).toBe(0);
    expect(state.endIndex).toBe(-1);
    expect(state.padTop).toBe(0);
    expect(state.padBottom).toBe(0);
    expect(state.isFullyRendered).toBe(true);
  });

  it("marks small row sets as fully rendered without top or bottom spacers", () => {
    // 5 rows easily fit on the default 560px viewport (~10 rows per screen)
    render(<Harness rowCount={5} />);
    const state = readState();

    expect(state.startIndex).toBe(0);
    expect(state.endIndex).toBe(4);
    expect(state.padTop).toBe(0);
    expect(state.padBottom).toBe(0);
    expect(state.isFullyRendered).toBe(true);
  });

  it("mounts only the top window + overscan on the initial paint of a large set", () => {
    const ROW_COUNT = 500;
    render(<Harness rowCount={ROW_COUNT} />);
    const state = readState();

    // At scrollTop 0: start is 0, end is per-screen + overscan
    const expectedEnd = Math.min(ROW_COUNT - 1, PER_SCREEN - 1 + DEFAULT_OVERSCAN);

    expect(state.startIndex).toBe(0);
    expect(state.endIndex).toBe(expectedEnd);
    expect(state.padTop).toBe(0);
    expect(state.padBottom).toBe((ROW_COUNT - 1 - expectedEnd) * DEFAULT_ROW_HEIGHT);
    expect(state.isFullyRendered).toBe(false);
  });

  it("re-derives the window and updates spacers on scroll", () => {
    const ROW_COUNT = 500;
    render(<Harness rowCount={ROW_COUNT} />);
    const scroller = screen.getByTestId("scroller");
    mockLayout(scroller);

    // Scroll down 20 rows
    const scrolledRows = 20;
    scroller.scrollTop = scrolledRows * DEFAULT_ROW_HEIGHT;
    fireEvent.scroll(scroller);

    const state = readState();
    const expectedStart = scrolledRows - DEFAULT_OVERSCAN;
    const expectedEnd = scrolledRows + PER_SCREEN - 1 + DEFAULT_OVERSCAN;

    expect(state.startIndex).toBe(expectedStart);
    expect(state.endIndex).toBe(expectedEnd);
    expect(state.padTop).toBe(expectedStart * DEFAULT_ROW_HEIGHT);
    expect(state.padBottom).toBe((ROW_COUNT - 1 - expectedEnd) * DEFAULT_ROW_HEIGHT);
  });

  it("scrollToIndex advances the window synchronously even without native scroll events", () => {
    const ROW_COUNT = 500;
    render(<Harness rowCount={ROW_COUNT} />);
    const scroller = screen.getByTestId("scroller");
    mockLayout(scroller);

    fireEvent.click(screen.getByRole("button", { name: /jump to 100/i }));

    const state = readState();
    // Row 100 must be mounted inside the window
    expect(state.startIndex).toBeLessThanOrEqual(100);
    expect(state.endIndex).toBeGreaterThanOrEqual(100);
    expect(state.padTop).toBeGreaterThan(0);
    expect(scroller.scrollTop).toBeGreaterThan(0);
  });

  it("scrollToIndex clamps cleanly to the end of the row set", () => {
    const ROW_COUNT = 500;
    render(<Harness rowCount={ROW_COUNT} />);
    const scroller = screen.getByTestId("scroller");
    mockLayout(scroller);

    fireEvent.click(screen.getByRole("button", { name: /jump to last/i }));

    const state = readState();
    expect(state.endIndex).toBe(ROW_COUNT - 1);
    expect(state.padBottom).toBe(0);
    expect(state.padTop).toBeGreaterThan(0);
  });
});
