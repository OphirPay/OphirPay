"use client";
// SPDX-License-Identifier: MIT

import { useCallback, useEffect, useRef, useState } from "react";
import type { KeyboardEvent, RefObject } from "react";

interface RowProps {
  tabIndex: number;
  onFocus: () => void;
}

/**
 * Bridge to a virtualized row window (see `useVirtualRows`). Without it the
 * hook assumes every row is mounted, which is what a non-virtualized table
 * does.
 */
export interface TableKeyboardVirtualization {
  /** Index of the first row currently mounted. */
  startIndex: number;
  /** Index of the last row currently mounted; -1 when nothing is mounted. */
  endIndex: number;
  /** Brings `index` into the mounted window (scrolls the container). */
  scrollToIndex: (index: number) => void;
}

interface UseTableKeyboardNavigationResult {
  /**
   * Index of the row currently in the tab order (roving tabindex). Always an
   * index into the full row set, not into the mounted window.
   */
  activeIndex: number;
  /**
   * Props to spread onto each `<tr>` — mark it with `data-row-index={index}`
   * so the handler can find rows inside the tbody.
   */
  getRowProps: (index: number) => RowProps;
  /** Attach to `<tbody>` to handle ArrowUp/ArrowDown/Home/End. */
  onRowsKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
  /** Attach to `<tbody>` as `ref` to scope row lookups. */
  tbodyRef: RefObject<HTMLTableSectionElement | null>;
}

const NAVIGATION_KEYS = new Set(["ArrowUp", "ArrowDown", "Home", "End"]);

/** Looks a row up by its absolute index rather than by DOM position. */
function findRow(
  tbody: HTMLTableSectionElement | null,
  index: number
): HTMLTableRowElement | null {
  return tbody?.querySelector<HTMLTableRowElement>(`tr[data-row-index="${index}"]`) ?? null;
}

/**
 * Roving-tabindex keyboard navigation for table rows.
 *
 * - The active row keeps `tabIndex={0}` so it is the only row reachable via
 *   Tab; all other rows get `tabIndex={-1}`.
 * - ArrowUp / ArrowDown / Home / End move the active row and shift focus to
 *   it, whether the row itself or an action button/link inside it has focus.
 * - The active index clamps when the row set shrinks (filtering/pagination)
 *   and resets to the first row when rows first appear.
 * - With a virtualized table only a window of rows is mounted, so the target
 *   row may not exist yet: the hook asks the window to scroll to it and
 *   focuses it on the render that mounts it. The active row is also kept
 *   inside the mounted window when the user scrolls by hand, so the table
 *   never drops out of the tab order.
 *
 * Usage:
 * ```tsx
 * const { activeIndex, getRowProps, onRowsKeyDown, tbodyRef } =
 *   useTableKeyboardNavigation(rows.length);
 *
 * <tbody ref={tbodyRef} onKeyDown={onRowsKeyDown}>
 *   {rows.map((row, i) => (
 *     <tr key={row.id} data-row-index={i} {...getRowProps(i)}>…</tr>
 *   ))}
 * </tbody>
 * ```
 */
export function useTableKeyboardNavigation(
  rowCount: number,
  virtualization?: TableKeyboardVirtualization
): UseTableKeyboardNavigationResult {
  const [activeIndex, setActiveIndex] = useState(rowCount > 0 ? 0 : -1);
  const tbodyRef = useRef<HTMLTableSectionElement | null>(null);
  // Read through a ref so `onRowsKeyDown` can stay stable across renders.
  const virtualizationRef = useRef<TableKeyboardVirtualization | null>(virtualization ?? null);
  // Set when a key moved the active row outside the mounted window; the row is
  // focused as soon as the window renders it.
  const pendingFocusRef = useRef<number | null>(null);

  const virtualStart = virtualization ? virtualization.startIndex : 0;
  const virtualEnd = virtualization ? virtualization.endIndex : -1;

  // Keep the active row valid as the row set changes: reset to -1 when empty,
  // clamp to the last row when the set shrinks, and default to the first row
  // when rows first appear so the table is always reachable via Tab.
  useEffect(() => {
    if (rowCount === 0) {
      setActiveIndex(-1);
    } else if (activeIndex >= rowCount) {
      setActiveIndex(rowCount - 1);
    } else if (activeIndex === -1) {
      setActiveIndex(0);
    } else if (virtualEnd >= 0 && activeIndex < virtualStart) {
      // Scrolled past the active row — hand the roving tabindex to the first
      // row that is actually mounted.
      setActiveIndex(virtualStart);
    } else if (virtualEnd >= 0 && activeIndex > virtualEnd) {
      setActiveIndex(virtualEnd);
    }
  }, [activeIndex, rowCount, virtualStart, virtualEnd]);

  useEffect(() => {
    virtualizationRef.current = virtualization ?? null;

    const pending = pendingFocusRef.current;
    if (pending === null) return;

    const row = findRow(tbodyRef.current, pending);
    if (!row) return; // the window has not caught up yet — retry next render

    pendingFocusRef.current = null;
    row.focus();
  });

  const onRowsKeyDown = useCallback(
    (event: KeyboardEvent<HTMLElement>) => {
      if (!NAVIGATION_KEYS.has(event.key)) return;

      const row = (event.target as HTMLElement).closest<HTMLTableRowElement>(
        "tr[data-row-index]"
      );
      if (!row) return;

      // Rows are indexed by their position in the full row set, not by their
      // position in the DOM — with virtualization those differ.
      const currentIndex = Number(row.dataset.rowIndex);
      if (!Number.isInteger(currentIndex)) return;

      let nextIndex = currentIndex;
      if (event.key === "ArrowUp") nextIndex -= 1;
      else if (event.key === "ArrowDown") nextIndex += 1;
      else if (event.key === "Home") nextIndex = 0;
      else if (event.key === "End") nextIndex = rowCount - 1;

      // Clamp at the table boundaries — no wrapping.
      if (nextIndex < 0 || nextIndex >= rowCount) return;

      event.preventDefault();
      setActiveIndex(nextIndex);

      const mounted = findRow(tbodyRef.current, nextIndex);
      if (mounted) {
        mounted.focus();
        return;
      }

      // The target row is outside the mounted window: scroll the window to it
      // and focus it once it renders.
      const virtual = virtualizationRef.current;
      if (!virtual) return;
      virtual.scrollToIndex(nextIndex);
      pendingFocusRef.current = nextIndex;
    },
    [rowCount]
  );

  const getRowProps = useCallback(
    (index: number): RowProps => ({
      tabIndex: index === activeIndex ? 0 : -1,
      onFocus: () => setActiveIndex(index),
    }),
    [activeIndex]
  );

  return { activeIndex, getRowProps, onRowsKeyDown, tbodyRef };
}
