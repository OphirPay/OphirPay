"use client";
// SPDX-License-Identifier: MIT

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

/**
 * Row virtualization (windowing) for large tables (issue #745).
 *
 * Given a row count and a fixed row height, returns the slice of rows that
 * should be mounted for the current scroll position. Only the viewport plus
 * `overscan` rows above/below are rendered, so a table with thousands of rows
 * still mounts a bounded number of DOM nodes.
 *
 * Small tables (<= `threshold`) render in full — this keeps the markup (and
 * therefore existing keyboard-navigation and accessibility tests) unchanged
 * for ordinary pages, while large pages are windowed.
 *
 * The caller renders spacer elements of height `topSpacerHeight` /
 * `bottomSpacerHeight` around the table so the scrollbar still reflects the
 * full row count without mounting placeholder `<tr>`s.
 */

export interface UseVirtualRowsOptions {
  /** Fixed row height in px. Default 60. */
  rowHeight?: number;
  /** Rows rendered above and below the viewport. Default 6. */
  overscan?: number;
  /** Only virtualize when rowCount exceeds this. Default 50. */
  threshold?: number;
  /**
   * Rows assumed to fit when the container height can't be measured (e.g.
   * jsdom, SSR). Default 12.
   */
  fallbackViewportRows?: number;
}

export interface UseVirtualRowsResult {
  /** First mounted row (index into the full row set). */
  startIndex: number;
  /** One past the last mounted row (index into the full row set). */
  endIndex: number;
  /** Height of the spacer rendered above the table. */
  topSpacerHeight: number;
  /** Height of the spacer rendered below the table. */
  bottomSpacerHeight: number;
  /** Whether windowing is active for this row count. */
  virtualized: boolean;
  /** Attach to the scroll container that wraps the table. */
  containerRef: RefObject<HTMLDivElement | null>;
  /** Attach to the scroll container's onScroll. */
  onScroll: () => void;
}

export const DEFAULT_ROW_HEIGHT = 60;
export const DEFAULT_OVERSCAN = 6;
export const DEFAULT_VIRTUALIZE_THRESHOLD = 50;
export const FALLBACK_VIEWPORT_ROWS = 12;

export function useVirtualRows(
  rowCount: number,
  options: UseVirtualRowsOptions = {}
): UseVirtualRowsResult {
  const rowHeight = options.rowHeight ?? DEFAULT_ROW_HEIGHT;
  const overscan = options.overscan ?? DEFAULT_OVERSCAN;
  const threshold = options.threshold ?? DEFAULT_VIRTUALIZE_THRESHOLD;
  const fallbackViewportRows =
    options.fallbackViewportRows ?? FALLBACK_VIEWPORT_ROWS;

  const containerRef = useRef<HTMLDivElement | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);

  const virtualized = rowCount > threshold;

  // Measure the scroll container and keep the measurement fresh on resize.
  useEffect(() => {
    if (!virtualized) return;
    const el = containerRef.current;
    if (!el) return;

    const measure = () => setViewportHeight(el.clientHeight);
    measure();

    const observer =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(measure)
        : null;
    observer?.observe(el);
    window.addEventListener("resize", measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [virtualized]);

  const onScroll = useCallback(() => {
    const el = containerRef.current;
    if (el) setScrollTop(el.scrollTop);
  }, []);

  if (!virtualized) {
    return {
      startIndex: 0,
      endIndex: rowCount,
      topSpacerHeight: 0,
      bottomSpacerHeight: 0,
      virtualized: false,
      containerRef,
      onScroll,
    };
  }

  const effectiveViewportHeight =
    viewportHeight > 0 ? viewportHeight : fallbackViewportRows * rowHeight;
  const visibleCount =
    Math.ceil(effectiveViewportHeight / rowHeight) + overscan * 2;
  const maxStart = Math.max(0, rowCount - visibleCount);
  const rawStart = Math.floor(scrollTop / rowHeight) - overscan;
  const startIndex = Math.min(Math.max(0, rawStart), maxStart);
  const endIndex = Math.min(rowCount, startIndex + visibleCount);

  return {
    startIndex,
    endIndex,
    topSpacerHeight: startIndex * rowHeight,
    bottomSpacerHeight: Math.max(0, (rowCount - endIndex) * rowHeight),
    virtualized: true,
    containerRef,
    onScroll,
  };
}
