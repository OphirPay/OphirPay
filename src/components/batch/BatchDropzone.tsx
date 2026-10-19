"use client";
// SPDX-License-Identifier: MIT

import {
  forwardRef,
  useCallback,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent,
  type ChangeEvent,
} from "react";
import { cn } from "@/lib/utils";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { useOptionalToast } from "@/components/ui/Toast";
import { downloadCsvTemplate, MAX_BATCH_RECIPIENTS } from "@/lib/csv-import";

// ── Types ─────────────────────────────────────────────────────

export type DropzoneState = "idle" | "drag-over" | "parsing" | "error";

export interface FileMetadata {
  name: string;
  sizeKb: string | number;
  rowCount?: number;
}

export interface BatchDropzoneProps {
  /** Called when a valid CSV file is dropped or selected. */
  onFileAccepted: (file: File) => void | Promise<void>;
  /** Optional callback when a file is rejected before parsing. */
  onFileRejected?: (file: File, reason: string) => void;
  /** Whether the parent is currently parsing the CSV file. */
  isParsing?: boolean;
  /** Optional parsing progress (0–100); if omitted while isParsing=true, indeterminate progress is shown. */
  parseProgress?: number;
  /** Current file metadata to display in the dropzone or summary. */
  fileMetadata?: FileMetadata | null;
  /** Optional callback to trigger template download. Defaults to downloadCsvTemplate. */
  onTemplateDownload?: () => void;
  /** Whether interactions are disabled. */
  disabled?: boolean;
  /** Additional custom class names. */
  className?: string;
}

// ── File format validation ────────────────────────────────────

const ALLOWED_CSV_MIMES = [
  "text/csv",
  "application/vnd.ms-excel",
  "text/plain",
  "application/csv",
  "text/x-csv",
  "application/x-csv",
  "text/comma-separated-values",
];

export function isValidCsvFile(file: File): { valid: boolean; error?: string } {
  const name = file.name || "";
  const hasCsvExtension = name.toLowerCase().endsWith(".csv");

  if (!hasCsvExtension) {
    return {
      valid: false,
      error: "Invalid file format. Please upload a CSV file (.csv).",
    };
  }

  const mime = file.type?.toLowerCase().trim();
  // When MIME type is non-empty, ensure it matches a recognized CSV/text MIME
  if (mime && !ALLOWED_CSV_MIMES.includes(mime)) {
    return {
      valid: false,
      error: "Invalid MIME type. Only CSV files are supported.",
    };
  }

  return { valid: true };
}

// ── Component ─────────────────────────────────────────────────

export const BatchDropzone = forwardRef<HTMLInputElement, BatchDropzoneProps>(
  function BatchDropzone(
    {
      onFileAccepted,
      onFileRejected,
      isParsing = false,
      parseProgress,
      fileMetadata,
      onTemplateDownload = downloadCsvTemplate,
      disabled = false,
      className,
    },
    forwardedRef
  ) {
    const [internalState, setInternalState] = useState<DropzoneState>("idle");
    const [errorMessage, setErrorMessage] = useState<string | null>(null);
    const dragCounterRef = useRef(0);
    const localInputRef = useRef<HTMLInputElement>(null);
    const toast = useOptionalToast();

    const currentState: DropzoneState = isParsing
      ? "parsing"
      : errorMessage
        ? "error"
        : internalState;

    const setInputRefs = (el: HTMLInputElement | null) => {
      localInputRef.current = el;
      if (typeof forwardedRef === "function") {
        forwardedRef(el);
      } else if (forwardedRef) {
        forwardedRef.current = el;
      }
    };

    const handleProcessFile = useCallback(
      (file: File | undefined) => {
        if (!file || disabled) return;

        const validation = isValidCsvFile(file);
        if (!validation.valid) {
          const error = validation.error ?? "Invalid CSV file.";
          setErrorMessage(error);
          setInternalState("error");
          toast?.error("Invalid file format", error);
          onFileRejected?.(file, error);
          if (localInputRef.current) localInputRef.current.value = "";
          return;
        }

        setErrorMessage(null);
        setInternalState("idle");
        onFileAccepted(file);
      },
      [disabled, onFileAccepted, onFileRejected, toast]
    );

    // ── Drag & Drop Handlers ────────────────────────────────────

    const handleDragEnter = (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();
      if (disabled) return;
      dragCounterRef.current += 1;
      if (e.dataTransfer?.items && e.dataTransfer.items.length > 0) {
        setInternalState("drag-over");
      }
    };

    const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();
      if (disabled) return;
      if (currentState !== "drag-over" && currentState !== "parsing") {
        setInternalState("drag-over");
      }
    };

    const handleDragLeave = (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();
      if (disabled) return;
      dragCounterRef.current -= 1;
      if (dragCounterRef.current <= 0) {
        dragCounterRef.current = 0;
        setInternalState("idle");
      }
    };

    const handleDrop = (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();
      dragCounterRef.current = 0;
      if (disabled) return;

      const files = e.dataTransfer?.files;
      const file = files?.[0];
      handleProcessFile(file);
    };

    const handleInputChange = (e: ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      handleProcessFile(file);
    };

    const handleBoxClick = () => {
      if (disabled || isParsing) return;
      localInputRef.current?.click();
    };

    const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        handleBoxClick();
      }
    };

    const handleResetError = (e?: React.MouseEvent) => {
      e?.stopPropagation();
      setErrorMessage(null);
      setInternalState("idle");
      if (localInputRef.current) localInputRef.current.value = "";
    };

    return (
      <div
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-label="Upload CSV file"
        aria-disabled={disabled}
        onClick={handleBoxClick}
        onKeyDown={handleKeyDown}
        onDragEnter={handleDragEnter}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={cn(
          "relative border-2 border-dashed rounded-xl p-8 text-center transition-all duration-200 select-none",
          disabled && "opacity-50 cursor-not-allowed",
          !disabled && "cursor-pointer focus:outline-none focus:ring-2 focus:ring-ophir-500/40",
          currentState === "idle" &&
            "border-gray-300 dark:border-gray-700 hover:border-ophir-400 dark:hover:border-ophir-600 bg-transparent hover:bg-gray-50/50 dark:hover:bg-gray-800/30",
          currentState === "drag-over" &&
            "border-ophir-500 bg-ophir-50 dark:bg-ophir-950/40 ring-4 ring-ophir-500/20 scale-[1.01]",
          currentState === "parsing" &&
            "border-ophir-400 bg-ophir-50/40 dark:bg-ophir-950/20 cursor-wait",
          currentState === "error" &&
            "border-red-400 dark:border-red-600 bg-red-50/60 dark:bg-red-950/20",
          className
        )}
        data-testid="csv-dropzone"
        data-state={currentState}
      >
        <input
          ref={setInputRefs}
          type="file"
          accept=".csv,text/csv,application/vnd.ms-excel"
          className="hidden"
          disabled={disabled || isParsing}
          data-testid="csv-file-input"
          onChange={handleInputChange}
        />

        {/* ── State: Parsing ── */}
        {currentState === "parsing" && (
          <div className="space-y-4" data-testid="csv-dropzone-parsing">
            <div className="w-10 h-10 mx-auto rounded-full bg-ophir-100 dark:bg-ophir-900/50 flex items-center justify-center text-ophir-600 dark:text-ophir-400 animate-spin">
              <svg
                className="w-5 h-5"
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
              >
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8v8H4z"
                />
              </svg>
            </div>
            <div>
              <p className="text-sm font-semibold text-gray-900 dark:text-white">
                Parsing CSV file...
              </p>
              {fileMetadata?.name && (
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                  {fileMetadata.name} ({fileMetadata.sizeKb} KB)
                </p>
              )}
            </div>
            <div className="max-w-xs mx-auto">
              <ProgressBar
                value={parseProgress ?? 0}
                indeterminate={parseProgress === undefined}
                variant="default"
                showLabel={parseProgress !== undefined}
              />
            </div>
          </div>
        )}

        {/* ── State: Error ── */}
        {currentState === "error" && (
          <div className="space-y-3" data-testid="csv-dropzone-error">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={1.5}
              stroke="currentColor"
              className="w-10 h-10 mx-auto text-red-500"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"
              />
            </svg>
            <div>
              <p className="text-sm font-semibold text-red-700 dark:text-red-400">
                Upload Rejected
              </p>
              <p className="text-xs text-red-600 dark:text-red-400 mt-1 max-w-sm mx-auto">
                {errorMessage}
              </p>
            </div>
            <button
              type="button"
              onClick={handleResetError}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-red-700 dark:text-red-300 bg-red-100 dark:bg-red-900/40 hover:bg-red-200 dark:hover:bg-red-800/50 rounded-lg transition-colors"
            >
              Choose a valid CSV file
            </button>
          </div>
        )}

        {/* ── State: Drag Over ── */}
        {currentState === "drag-over" && (
          <div className="space-y-2 pointer-events-none">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={1.75}
              stroke="currentColor"
              className="w-12 h-12 mx-auto text-ophir-600 dark:text-ophir-400 animate-bounce"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5"
              />
            </svg>
            <p className="text-base font-semibold text-ophir-700 dark:text-ophir-300">
              Drop your CSV here
            </p>
            <p className="text-xs text-ophir-600/80 dark:text-ophir-400/80">
              Release file to validate and parse
            </p>
          </div>
        )}

        {/* ── State: Idle ── */}
        {currentState === "idle" && (
          <>
            <svg
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={1.5}
              stroke="currentColor"
              className="w-10 h-10 mx-auto mb-3 text-gray-400 dark:text-gray-500"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5"
              />
            </svg>
            <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
              Drag & drop your CSV file here, or click to browse
            </p>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              Columns: <span className="font-mono">address,amount,memo</span> — up
              to {MAX_BATCH_RECIPIENTS} recipients
            </p>

          <div className="mt-3">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onTemplateDownload();
              }}
              className="text-sm text-ophir-600 dark:text-ophir-400 hover:underline inline-flex items-center gap-1"
            >
              Download template
            </button>
          </div>
          </>
        )}
      </div>
    );
  }
);
