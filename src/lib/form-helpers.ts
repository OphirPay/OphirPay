"use client";
// SPDX-License-Identifier: MIT


import { useState, useCallback, useRef } from "react";

/**
 * Form submission state management to prevent double-submits.
 * Tracks submitting state and provides a wrapped submit handler.
 */
export function useFormSubmit<T extends unknown[]>(
  handler: (...args: T) => Promise<void> | void
) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const submittingRef = useRef(false);

  const submit = useCallback(
    async (...args: T) => {
      if (submittingRef.current) return;
      submittingRef.current = true;
      setIsSubmitting(true);
      try {
        await handler(...args);
      } finally {
        submittingRef.current = false;
        setIsSubmitting(false);
      }
    },
    [handler]
  );

  return { submit, isSubmitting };
}

/**
 * Simple form reset helper — returns a function that resets all form fields.
 */
export function useFormReset(formRef: React.RefObject<HTMLFormElement | null>) {
  return useCallback(() => {
    formRef.current?.reset();
    // Also clear any controlled inputs by dispatching an input event
    formRef.current
      ?.querySelectorAll<
        HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
      >("input, textarea, select")
      .forEach((el) => {
        const prototype = Object.getPrototypeOf(el) as object;
        const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
          prototype,
          "value"
        )?.set;
        nativeInputValueSetter?.call(el, "");
        el.dispatchEvent(new Event("input", { bubbles: true }));
      });
  }, [formRef]);
}
