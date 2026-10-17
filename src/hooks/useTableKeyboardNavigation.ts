"use client";
// SPDX-License-Identifier: MIT

import { useCallback, useEffect, useRef, useState } from "react";
import type { KeyboardEvent, RefObject } from "react";

export const FOCUS_VISIBLE_ROW_CLASS =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ophir-500 focus-visible:ring-offset-2";

export interface RowProps {
  tabIndex: number;
  onFocus: () => void;
  "data-row-index": number;
}

export interface UseTableKeyboardNavigationOptions {
  /** Called when the user presses Enter while focused on a row. */
  onRowActivate?: (index: number) => void;
}

export interface UseTableKeyboardNavigationResult {
  /** Index of the row currently in the tab order (roving tabindex). */
  activeIndex: number;
  /**
   * Props to spread onto each `<tr>` or row item — marks it with `data-row-index={index}`
   * so the handler can find rows inside the container.
   */
  getRowProps: (index: number) => RowProps;
  /** Attach to `<tbody>` or list container to handle ArrowUp/ArrowDown/Home/End/Enter. */
  onRowsKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
  /** Attach to `<tbody>` as `ref` to scope row lookups. */
  tbodyRef: RefObject<HTMLTableSectionElement | null>;
}

const NAVIGATION_KEYS = new Set(["ArrowUp", "ArrowDown", "Home", "End", "Enter"]);

/**
 * Roving-tabindex keyboard navigation for table rows and list items (#1305).
 *
 * - The active row keeps `tabIndex={0}` so it is the only row reachable via
 *   Tab; all other rows get `tabIndex={-1}`.
 * - ArrowUp / ArrowDown / Home / End move the active row and shift focus to
 *   it, whether the row itself or an action button/link inside it has focus.
 * - Enter triggers `onRowActivate(currentIndex)` (or clicks the row's primary
 *   detail link) when pressed directly on a focused row.
 */
export function useTableKeyboardNavigation(
  rowCount: number,
  options: UseTableKeyboardNavigationOptions = {}
): UseTableKeyboardNavigationResult {
  const { onRowActivate } = options;
  const [activeIndex, setActiveIndex] = useState(rowCount > 0 ? 0 : -1);
  const tbodyRef = useRef<HTMLTableSectionElement | null>(null);

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

      const container = tbodyRef.current ?? (event.currentTarget as HTMLElement | null);
      if (!container) return;

      const rows = container.querySelectorAll<HTMLElement>("[data-row-index]");
      if (!rows || rows.length === 0) return;

      const target = event.target as HTMLElement;
      const row = target.closest<HTMLElement>("[data-row-index]");
      if (!row) return;

      const currentIndex = Array.from(rows).indexOf(row);
      if (currentIndex === -1) return;

      if (event.key === "Enter") {
        // Do not hijack Enter when focus is inside an interactive child control
        const isInteractiveChild =
          target !== row &&
          Boolean(target.closest("button, a, input, select, textarea"));
        if (isInteractiveChild) return;

        if (onRowActivate) {
          event.preventDefault();
          onRowActivate(currentIndex);
          return;
        }

        const primaryLink = row.querySelector<HTMLElement>("a[href], [data-row-detail-trigger]");
        if (primaryLink) {
          event.preventDefault();
          primaryLink.click();
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
    [onRowActivate]
  );

  const getRowProps = useCallback(
    (index: number): RowProps => ({
      tabIndex: index === activeIndex ? 0 : -1,
      onFocus: () => setActiveIndex(index),
      "data-row-index": index,
    }),
    [activeIndex]
  );

  return { activeIndex, getRowProps, onRowsKeyDown, tbodyRef };
}
