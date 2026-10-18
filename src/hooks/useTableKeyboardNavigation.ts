"use client";
// SPDX-License-Identifier: MIT


import { useCallback, useEffect, useRef, useState } from "react";
import type { KeyboardEvent, RefObject } from "react";

interface RowProps {
  tabIndex: number;
  onFocus: () => void;
}

interface UseTableKeyboardNavigationResult {
  /** Index of the row currently in the tab order (roving tabindex). */
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

const NAVIGATION_KEYS = new Set(["ArrowUp", "ArrowDown", "Home", "End", "Enter"]);

/**
 * Roving-tabindex keyboard navigation for table rows.
 *
 * - The active row keeps `tabIndex={0}` so it is the only row reachable via
 *   Tab; all other rows get `tabIndex={-1}`.
 * - ArrowUp / ArrowDown / Home / End move the active row and shift focus to
 *   it, whether the row itself or an action button/link inside it has focus.
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
 */
export interface UseTableKeyboardNavigationOptions {
  /** Optional callback fired when Enter is pressed on an active row. */
  onRowSelect?: (index: number) => void;
}

export function useTableKeyboardNavigation(
  rowCount: number,
  options?: UseTableKeyboardNavigationOptions
): UseTableKeyboardNavigationResult {
  const [activeIndex, setActiveIndex] = useState(rowCount > 0 ? 0 : -1);
  const tbodyRef = useRef<HTMLTableSectionElement | null>(null);

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
      if (!NAVIGATION_KEYS.has(event.key)) return;

      const rows = tbodyRef.current?.querySelectorAll<HTMLTableRowElement>(
        "tr[data-row-index]"
      );
      if (!rows || rows.length === 0) return;

      const row = (event.target as HTMLElement).closest("tr");
      if (!row) return;

      const currentIndex = Array.from(rows).indexOf(row);
      if (currentIndex === -1) return;

      if (event.key === "Enter") {
        const target = event.target as HTMLElement;
        const tagName = target.tagName.toLowerCase();
        // If the focused target is an interactive child like a button or input,
        // let it handle Enter naturally instead of intercepting
        if (
          tagName === "button" ||
          tagName === "input" ||
          tagName === "textarea" ||
          target.getAttribute("role") === "button"
        ) {
          return;
        }

        event.preventDefault();
        if (options?.onRowSelect) {
          options.onRowSelect(currentIndex);
        } else {
          // Fallback: click the primary link or action in the row
          const primaryAction = row.querySelector<HTMLAnchorElement | HTMLButtonElement>(
            'a[href], button[data-testid*="detail"], button[data-action="view"]'
          );
          if (primaryAction) {
            primaryAction.click();
          }
        }
        return;
      }

      let nextIndex = currentIndex;
      if (event.key === "ArrowUp") nextIndex -= 1;
      else if (event.key === "ArrowDown") nextIndex += 1;
      else if (event.key === "Home") nextIndex = 0;
      else if (event.key === "End") nextIndex = rows.length - 1;

      // Clamp at the table boundaries — no wrapping.
      if (nextIndex < 0 || nextIndex >= rows.length) return;

      event.preventDefault();
      setActiveIndex(nextIndex);
      rows[nextIndex]?.focus();
    },
    [options]
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
