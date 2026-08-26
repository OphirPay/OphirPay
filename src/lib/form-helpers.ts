"use client";
// SPDX-License-Identifier: MIT


import { useState, useCallback } from "react";

/**
 * Form submission state management to prevent double-submits.
 * Tracks submitting state and provides a wrapped submit handler.
 */
export function useFormSubmit<T extends unknown[]>(
  handler: (...args: T) => Promise<void>
) {
  const [isSubmitting, setIsSubmitting] = useState(false);

  const submit = useCallback(
    async (...args: T) => {
      if (isSubmitting) return;
      setIsSubmitting(true);
      try {
        await handler(...args);
      } finally {
        setIsSubmitting(false);
      }
    },
    [handler, isSubmitting]
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
    formRef.current?.querySelectorAll("input, textarea, select").forEach((el) => {
      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (el as any).constructor.prototype,
        "value"
      )?.set;
      nativeInputValueSetter?.call(el, "");
      el.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }, [formRef]);
}
