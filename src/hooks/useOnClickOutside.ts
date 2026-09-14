"use client";
// SPDX-License-Identifier: MIT


import { useEffect, useRef, type RefObject } from "react";

/**
 * Detects clicks outside of the given ref element and calls the callback.
 * Useful for dropdowns, modals, and popovers.
 *
 * @example
 * Close a payment-details dropdown when the user clicks elsewhere:
 *
 * ```tsx
 * function RecipientMenu() {
 *   const ref = useRef<HTMLDivElement>(null);
 *   const [open, setOpen] = useState(false);
 *   useOnClickOutside(ref, () => setOpen(false), open);
 *
 *   return (
 *     <div ref={ref}>
 *       <button onClick={() => setOpen((o) => !o)}>⋯</button>
 *       {open && <ul>…</ul>}
 *     </div>
 *   );
 * }
 * ```
 */
export function useOnClickOutside<T extends HTMLElement>(
  ref: RefObject<T | null>,
  handler: () => void,
  enabled = true
) {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    if (!enabled) return;

    const listener = (event: MouseEvent | TouchEvent) => {
      const el = ref.current;
      if (!el || el.contains(event.target as Node)) return;
      handlerRef.current();
    };

    document.addEventListener("mousedown", listener);
    document.addEventListener("touchstart", listener);
    return () => {
      document.removeEventListener("mousedown", listener);
      document.removeEventListener("touchstart", listener);
    };
  }, [ref, enabled]);
}
