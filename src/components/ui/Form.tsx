"use client";
// SPDX-License-Identifier: MIT


import {
  forwardRef,
  useId,
  type InputHTMLAttributes,
  type TextareaHTMLAttributes,
  type SelectHTMLAttributes,
  type ReactNode,
} from "react";
import { cn } from "@/lib/utils";

// ── Shared field wrapper ───────────────────────────────────────

interface FieldProps {
  id?: string;
  label?: string;
  error?: string | null;
  hint?: string;
  required?: boolean;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
}

function FieldShell({
  id,
  label,
  error,
  hint,
  required,
  leftIcon,
  rightIcon,
  children,
}: FieldProps & { children: ReactNode }) {
  return (
    <div className="w-full">
      {label && (
        <label
          htmlFor={id}
          className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5"
        >
          {label}
          {required && <span className="text-red-500 ml-0.5">*</span>}
        </label>
      )}
      <div className="relative">
        {leftIcon && (
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500">
            {leftIcon}
          </span>
        )}
        {children}
        {rightIcon && (
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500">
            {rightIcon}
          </span>
        )}
      </div>
      {error ? (
        <p
          id={id ? `${id}-error` : undefined}
          role="alert"
          className="mt-1.5 text-xs text-red-600 dark:text-red-400"
        >
          {error}
        </p>
      ) : hint ? (
        <p id={id ? `${id}-hint` : undefined} className="mt-1.5 text-xs text-gray-500 dark:text-gray-400">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

const inputBaseClasses = cn(
  "w-full rounded-lg border bg-white dark:bg-gray-900 px-3.5 py-2.5 text-sm",
  "text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500",
  "border-gray-300 dark:border-gray-700",
  "focus:outline-none focus:ring-2 focus:ring-ophir-500/40 focus:border-ophir-500",
  "transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
);

// ── Input ──────────────────────────────────────────────────────

interface InputProps extends InputHTMLAttributes<HTMLInputElement>, FieldProps {}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { id, label, error, hint, required, leftIcon, rightIcon, className, ...rest },
  ref
) {
  const autoId = useId();
  const fieldId = id ?? autoId;
  const describedBy =
    error ? `${fieldId}-error` : hint ? `${fieldId}-hint` : undefined;

  return (
    <FieldShell id={fieldId} label={label} error={error} hint={hint} required={required} leftIcon={leftIcon} rightIcon={rightIcon}>
      <input
        ref={ref}
        id={fieldId}
        required={required}
        aria-invalid={!!error}
        aria-describedby={describedBy}
        className={cn(inputBaseClasses, leftIcon ? "pl-9" : undefined, rightIcon ? "pr-9" : undefined, error ? "border-red-500 focus:border-red-500 focus:ring-red-500/30" : undefined, className)}
        {...rest}
      />
    </FieldShell>
  );
});

// ── Textarea ───────────────────────────────────────────────────

interface TextareaProps
  extends TextareaHTMLAttributes<HTMLTextAreaElement>,
    FieldProps {}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  function Textarea({ id, label, error, hint, required, className, ...rest }, ref) {
    const autoId = useId();
    const fieldId = id ?? autoId;
    const describedBy =
      error ? `${fieldId}-error` : hint ? `${fieldId}-hint` : undefined;

    return (
      <FieldShell id={fieldId} label={label} error={error} hint={hint} required={required}>
        <textarea
          ref={ref}
          id={fieldId}
          required={required}
          aria-invalid={!!error}
          aria-describedby={describedBy}
          className={cn(inputBaseClasses, "min-h-[96px] resize-y", error ? "border-red-500 focus:border-red-500 focus:ring-red-500/30" : undefined, className)}
          {...rest}
        />
      </FieldShell>
    );
  }
);

// ── Select ─────────────────────────────────────────────────────

interface SelectProps
  extends SelectHTMLAttributes<HTMLSelectElement>,
    FieldProps {
  options: { value: string; label: string }[];
  placeholder?: string;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { id, label, error, hint, required, options, placeholder, className, ...rest },
  ref
) {
  const autoId = useId();
  const fieldId = id ?? autoId;
  const describedBy =
    error ? `${fieldId}-error` : hint ? `${fieldId}-hint` : undefined;

  return (
    <FieldShell id={fieldId} label={label} error={error} hint={hint} required={required}>
      <select
        ref={ref}
        id={fieldId}
        required={required}
        aria-invalid={!!error}
        aria-describedby={describedBy}
        className={cn(inputBaseClasses, "appearance-none pr-8 bg-no-repeat bg-[right_0.75rem_center] bg-[length:1rem] [background-image:url(\"data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke='%239ca3af' stroke-width='2'%3e%3cpath stroke-linecap='round' stroke-linejoin='round' d='M19.5 8.25l-7.5 7.5-7.5-7.5'/%3e%3c/svg%3e\")]", error ? "border-red-500 focus:border-red-500 focus:ring-red-500/30" : undefined, className)}
        {...rest}
      >
        {placeholder && (
          <option value="" disabled>
            {placeholder}
          </option>
        )}
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </FieldShell>
  );
});
