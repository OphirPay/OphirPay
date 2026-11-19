"use client";
// SPDX-License-Identifier: MIT

import { useCallback, useEffect, useRef, useState } from "react";
import type { KeyboardEvent, RefObject } from "react";

interface RowProps {
  tabIndex: number;
  onFocus: () => void;
}

export interface TableKeyboardNavigationOptions {
  /**
   * Called when Enter is pressed on a focused row. Use it to open the row's
   * detail view (or another primary action) from the keyboard.
   */
  onActivate?: (index: number) => void;
  /**
   * Selector used to find rows inside the container. Defaults to table rows
   * (`tr[data-row-index]`); pass `"[data-row-index]"` for card/list layouts.
   */
  rowSelector?: string;
}

interface UseTableKeyboardNavigationResult<T extends HTMLElement> {
  /** Index of the row currently in the tab order (roving tabindex). */
  activeIndex: number;
  /**
   * Props to spread onto each row — mark it with `data-row-index={index}`
   * so the handler can find rows inside the container.
   */
  getRowProps: (index: number) => RowProps;
  /** Attach to the rows container to handle Arrow/Home/End/Enter. */
  onRowsKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
  /** Attach to the rows container as `ref` to scope row lookups. */
  tbodyRef: RefObject<T | null>;
}

const NAVIGATION_KEYS = new Set(["ArrowUp", "ArrowDown", "Home", "End"]);
const DEFAULT_ROW_SELECTOR = "tr[data-row-index]";

/**
 * Roving-tabindex keyboard navigation for table rows and card lists.
 *
 * - The active row keeps `tabIndex={0}` so it is the only row reachable via
 *   Tab; all other rows get `tabIndex={-1}`.
 * - ArrowUp / ArrowDown / Home / End move the active row and shift focus to
 *   it, whether the row itself or an action button/link inside it has focus.
 * - Enter activates the focused row through the optional `onActivate`
 *   callback (e.g. navigate to the detail view).
 * - The active index clamps when the row set shrinks (filtering/pagination)
 *   and resets to the first row when rows first appear.
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
 *
 * Card layouts can use the same hook by passing
 * `{ rowSelector: "[data-row-index]" }` and attaching the ref/handler to the
 * list container instead of a `<tbody>`.
 */
export function useTableKeyboardNavigation<T extends HTMLElement = HTMLTableSectionElement>(
  rowCount: number,
  options: TableKeyboardNavigationOptions = {}
): UseTableKeyboardNavigationResult<T> {
  const { onActivate, rowSelector = DEFAULT_ROW_SELECTOR } = options;
  const [activeIndex, setActiveIndex] = useState(rowCount > 0 ? 0 : -1);
  const tbodyRef = useRef<T | null>(null);

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
    }
  }, [activeIndex, rowCount]);

  const onRowsKeyDown = useCallback(
    (event: KeyboardEvent<HTMLElement>) => {
      const isActivation = event.key === "Enter";
      if (!NAVIGATION_KEYS.has(event.key) && !isActivation) return;

      const rows = tbodyRef.current?.querySelectorAll<HTMLElement>(rowSelector);
      if (!rows || rows.length === 0) return;

      const row = (event.target as HTMLElement).closest<HTMLElement>(
        rowSelector
      );
      if (!row || !tbodyRef.current?.contains(row)) return;

      const currentIndex = Array.from(rows).indexOf(row);
      if (currentIndex === -1) return;

      if (isActivation) {
        if (!onActivate) return;
        // Let a focused button/link handle its own Enter; row activation is
        // only for the row container itself.
        const interactive = (event.target as HTMLElement).closest(
          "button, a, input, select, textarea"
        );
        if (interactive) return;
        event.preventDefault();
        onActivate(currentIndex);
        return;
      }

      let nextIndex = currentIndex;
      if (event.key === "ArrowUp") nextIndex -= 1;
      else if (event.key === "ArrowDown") nextIndex += 1;
      else if (event.key === "Home") nextIndex = 0;
      else if (event.key === "End") nextIndex = rows.length - 1;

      // Clamp at the boundaries — no wrapping.
      if (nextIndex < 0 || nextIndex >= rows.length) return;

      event.preventDefault();
      setActiveIndex(nextIndex);
      rows[nextIndex]?.focus();
    },
    [onActivate, rowSelector]
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
