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
 * measurement path can be exercised.
 */
function makeScrollable(element: HTMLElement, clientHeight: number, scrollTop: number) {
  Object.defineProperty(element, "clientHeight", { value: clientHeight, configurable: true });
  Object.defineProperty(element, "scrollTop", {
    value: scrollTop,
    writable: true,
    configurable: true,
  });
}

describe("useVirtualRows", () => {
  it("mounts every row when the set fits the viewport", () => {
    render(<Harness rowCount={4} />);

    expect(readState()).toEqual({
      startIndex: 0,
      endIndex: 3,
      padTop: 0,
      padBottom: 0,
      isFullyRendered: true,
    });
  });

  it("reports an empty window for an empty row set", () => {
    render(<Harness rowCount={0} />);

    expect(readState()).toEqual({
      startIndex: 0,
      endIndex: -1,
      padTop: 0,
      padBottom: 0,
      isFullyRendered: true,
    });
  });

  it("windows a large row set and pads the rows it does not mount", () => {
    render(<Harness rowCount={1000} />);

    const state = readState();
    const expectedEnd = PER_SCREEN - 1 + DEFAULT_OVERSCAN;

    expect(state.startIndex).toBe(0);
    expect(state.endIndex).toBe(expectedEnd);
    expect(state.isFullyRendered).toBe(false);
    expect(state.padTop).toBe(0);
    // Every unmounted row is replaced by the equivalent spacer height, so the
    // scrollbar still reflects all 1000 rows.
    expect(state.padBottom).toBe((1000 - 1 - expectedEnd) * DEFAULT_ROW_HEIGHT);
    expect(state.endIndex - state.startIndex + 1).toBeLessThan(1000);
  });

  it("keeps the mounted row count bounded regardless of the row count", () => {
    const { unmount } = render(<Harness rowCount={50_000} />);
    const small = readState();
    unmount();

    render(<Harness rowCount={100_000} />);
    const large = readState();

    expect(large.endIndex - large.startIndex).toBe(small.endIndex - small.startIndex);
    expect(large.endIndex - large.startIndex + 1).toBeLessThanOrEqual(
      PER_SCREEN + DEFAULT_OVERSCAN * 2
    );
  });

  it("scrollToIndex brings the requested row into the window", () => {
    render(<Harness rowCount={1000} />);
    expect(readState().endIndex).toBeLessThan(100);

    fireEvent.click(screen.getByRole("button", { name: "jump to 100" }));

    const state = readState();
    expect(state.startIndex).toBeLessThanOrEqual(100);
    expect(state.endIndex).toBeGreaterThanOrEqual(100);
    expect(state.padTop).toBe(state.startIndex * DEFAULT_ROW_HEIGHT);
    expect(state.padBottom).toBe((1000 - 1 - state.endIndex) * DEFAULT_ROW_HEIGHT);
  });

  it("scrollToIndex clamps out-of-range indices instead of scrolling past the end", () => {
    render(<Harness rowCount={5} />);

    fireEvent.click(screen.getByRole("button", { name: "jump to 100" }));

    expect(readState()).toEqual({
      startIndex: 0,
      endIndex: 4,
      padTop: 0,
      padBottom: 0,
      isFullyRendered: true,
    });
  });

  it("re-derives the window from a scroll event", () => {
    render(<Harness rowCount={1000} />);
    const scroller = screen.getByTestId("scroller");

    makeScrollable(scroller, 600, 3000);
    fireEvent.scroll(scroller);

    const state = readState();
    const perScreen = Math.ceil(600 / DEFAULT_ROW_HEIGHT);
    const firstVisible = Math.floor(3000 / DEFAULT_ROW_HEIGHT);

    expect(state.startIndex).toBe(Math.max(0, firstVisible - DEFAULT_OVERSCAN));
    expect(state.endIndex).toBe(firstVisible + perScreen - 1 + DEFAULT_OVERSCAN);
    expect(state.padTop).toBe(state.startIndex * DEFAULT_ROW_HEIGHT);
  });

  it("honours a custom row height and overscan", () => {
    render(<Harness rowCount={1000} rowHeight={100} overscan={1} />);

    const state = readState();
    // ceil(560 / 100) = 6 rows fit on screen, plus one overscan row.
    expect(state.startIndex).toBe(0);
    expect(state.endIndex).toBe(6);
    expect(state.padBottom).toBe((1000 - 1 - 6) * 100);
  });
});
