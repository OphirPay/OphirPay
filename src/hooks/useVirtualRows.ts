"use client";
// SPDX-License-Identifier: MIT

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RefObject } from "react";

/**
 * Estimated height of one payments row, in px. The table rows are rendered at
 * their natural height; this constant only drives the window maths and the
 * height of the spacer rows, so a small drift is absorbed by `overscan`.
 */
export const DEFAULT_ROW_HEIGHT = 60;

/** Rows kept mounted above/below the viewport so fast scrolling stays blank-free. */
export const DEFAULT_OVERSCAN = 8;

/**
 * Viewport height assumed before the scroll container has been measured.
 * Used during SSR and in jsdom, where `clientHeight` is always 0.
 */
export const DEFAULT_VIEWPORT_HEIGHT = 560;

interface Viewport {
  scrollTop: number;
  height: number;
}

export interface UseVirtualRowsOptions {
  /** Number of rows in the underlying (already filtered + sorted) row set. */
  rowCount: number;
  /** Estimated height of a single row, in px. */
  rowHeight?: number;
  /** Extra rows mounted above and below the visible window. */
  overscan?: number;
  /** Height assumed until the container is measured. */
  fallbackViewportHeight?: number;
}

export interface UseVirtualRowsResult {
  /** Index of the first mounted row (0 when the set is empty). */
  startIndex: number;
  /** Index of the last mounted row; -1 when the set is empty. */
  endIndex: number;
  /** Height of the spacer above the window, in px. */
  padTop: number;
  /** Height of the spacer below the window, in px. */
  padBottom: number;
  /** `true` when the window already covers every row, so no spacers are needed. */
  isFullyRendered: boolean;
  /** Attach to the scrolling element that wraps the table. */
  scrollRef: RefObject<HTMLDivElement | null>;
  /** Scrolls the container so that `index` sits fully inside the viewport. */
  scrollToIndex: (index: number) => void;
}

/**
 * Row virtualization (windowing) for tables.
 *
 * Only the rows around the viewport are mounted; the rows above and below are
 * replaced by a single spacer element of the equivalent height, so the scroll
 * geometry — and therefore the scrollbar — behaves as if every row existed.
 *
 * The window is derived from `scrollTop` + the measured viewport height, and
 * the hook re-measures on scroll and on container resize. Until the container
 * reports a height (SSR, jsdom) it falls back to `fallbackViewportHeight`, so
 * the first paint already renders a sensible window instead of nothing.
 *
 * Usage:
 * ```tsx
 * const { startIndex, endIndex, padTop, padBottom, scrollRef, scrollToIndex } =
 *   useVirtualRows({ rowCount: rows.length });
 *
 * <div ref={scrollRef} className="overflow-auto max-h-[70vh]">
 *   <table>…<tbody>{rows.slice(startIndex, endIndex + 1).map(…)}</tbody></table>
 * </div>
 * ```
 */
export function useVirtualRows({
  rowCount,
  rowHeight = DEFAULT_ROW_HEIGHT,
  overscan = DEFAULT_OVERSCAN,
  fallbackViewportHeight = DEFAULT_VIEWPORT_HEIGHT,
}: UseVirtualRowsOptions): UseVirtualRowsResult {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [viewport, setViewport] = useState<Viewport>({
    scrollTop: 0,
    height: fallbackViewportHeight,
  });

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;

    const measure = () => {
      const height = element.clientHeight || fallbackViewportHeight;
      setViewport((previous) => {
        // A container without layout (jsdom, or a hidden panel) reports
        // scrollTop 0 for every programmatic scroll, which would throw away
        // the window `scrollToIndex` just moved to. Trust the DOM only once
        // the element actually has a height.
        const scrollTop = element.clientHeight > 0 ? element.scrollTop : previous.scrollTop;
        if (previous.scrollTop === scrollTop && previous.height === height) return previous;
        return { scrollTop, height };
      });
    };

    measure();
    element.addEventListener("scroll", measure, { passive: true });

    // ResizeObserver is unavailable in jsdom; guard rather than polyfill.
    let observer: ResizeObserver | undefined;
    if (typeof ResizeObserver !== "undefined") {
      observer = new ResizeObserver(measure);
      observer.observe(element);
    }

    return () => {
      element.removeEventListener("scroll", measure);
      observer?.disconnect();
    };
  }, [fallbackViewportHeight]);

  const { startIndex, endIndex, padTop, padBottom, isFullyRendered } = useMemo(() => {
    if (rowCount <= 0) {
      return { startIndex: 0, endIndex: -1, padTop: 0, padBottom: 0, isFullyRendered: true };
    }

    const perScreen = Math.max(1, Math.ceil(viewport.height / rowHeight));
    const firstVisible = Math.max(0, Math.floor(viewport.scrollTop / rowHeight));
    const lastIndex = rowCount - 1;
    const start = Math.min(Math.max(0, firstVisible - overscan), lastIndex);
    const end = Math.max(start, Math.min(lastIndex, firstVisible + perScreen - 1 + overscan));

    // Small tables fit entirely — render them exactly as before, with no
    // spacer rows at all.
    if (start === 0 && end === rowCount - 1) {
      return { startIndex: 0, endIndex: end, padTop: 0, padBottom: 0, isFullyRendered: true };
    }

    return {
      startIndex: start,
      endIndex: end,
      padTop: start * rowHeight,
      padBottom: (rowCount - 1 - end) * rowHeight,
      isFullyRendered: false,
    };
  }, [rowCount, rowHeight, overscan, viewport]);

  const scrollToIndex = useCallback(
    (index: number) => {
      const element = scrollRef.current;
      const clamped = Math.max(0, Math.min(index, Math.max(0, rowCount - 1)));
      const height = element?.clientHeight || fallbackViewportHeight;
      const rowTop = clamped * rowHeight;
      const rowBottom = rowTop + rowHeight;

      let nextTop = element ? element.scrollTop : viewport.scrollTop;
      if (rowTop < nextTop) nextTop = rowTop;
      else if (rowBottom > nextTop + height) nextTop = rowBottom - height;
      nextTop = Math.max(0, nextTop);

      if (element) element.scrollTop = nextTop;
      // jsdom never fires a scroll event and never persists scrollTop, so the
      // window is advanced from state as well — this also makes the next
      // render synchronous for keyboard navigation.
      setViewport((previous) =>
        previous.scrollTop === nextTop ? previous : { ...previous, scrollTop: nextTop }
      );
    },
    [rowCount, rowHeight, fallbackViewportHeight, viewport.scrollTop]
  );

  return {
    startIndex,
    endIndex,
    padTop,
    padBottom,
    isFullyRendered,
    scrollRef,
    scrollToIndex,
  };
}
