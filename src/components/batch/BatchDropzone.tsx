"use client";
// SPDX-License-Identifier: MIT

import { useCallback, useRef, useState, useContext } from "react";
import { cn } from "@/lib/utils";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { ToastContext } from "@/components/ui/Toast";

export type DropzoneState = "idle" | "active" | "parsing" | "error";

export interface BatchDropzoneProps {
  /** Callback invoked when a valid CSV file is dropped or selected. */
  onFileSelect: (file: File) => Promise<void> | void;
  /** Whether parsing is actively underway. */
  isParsing?: boolean;
  /** Parsing progress percentage (0–100). */
  parseProgress?: number;
  /** Active filename. */
  fileName?: string | null;
  /** File size in bytes. */
  fileSize?: number | null;
  /** Total parsed row count. */
  rowCount?: number | null;
  /** Error message to display when validation fails. */
  errorMessage?: string | null;
  /** Callback to clear/reset the active file. */
  onClear?: () => void;
  /** Callback to trigger CSV template download. */
  onTemplateDownload?: () => void;
  /** Whether to render file metadata card below dropzone (default: true). */
  showMetadataCard?: boolean;
  /** Maximum recipients allowed. */
  maxRecipients?: number;
  /** Additional styling. */
  className?: string;
  /** Disable interactions. */
  disabled?: boolean;
}

const ALLOWED_MIME_TYPES = new Set([
  "text/csv",
  "application/vnd.ms-excel",
  "text/plain",
  "application/csv",
  "text/x-csv",
  "", // Some browsers / OS leave local file type empty
]);

export function formatFileSize(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || isNaN(bytes) || bytes < 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function validateCsvFile(file: File): { valid: boolean; error?: string } {
  const extension = file.name.slice(file.name.lastIndexOf(".")).toLowerCase();
  if (extension !== ".csv") {
    return {
      valid: false,
      error: `Invalid file format: "${file.name}". Please upload a .csv file.`,
    };
  }

  if (file.type && !ALLOWED_MIME_TYPES.has(file.type.toLowerCase())) {
    return {
      valid: false,
      error: `Unsupported MIME type: "${file.type}". Only CSV files are supported.`,
    };
  }

  if (file.size === 0) {
    return {
      valid: false,
      error: "The selected CSV file is empty (0 bytes).",
    };
  }

  return { valid: true };
}

export function BatchDropzone({
  onFileSelect,
  isParsing = false,
  parseProgress = 0,
  fileName,
  fileSize,
  rowCount,
  errorMessage: externalErrorMessage,
  onClear,
  onTemplateDownload,
  showMetadataCard = true,
  inputRef: externalInputRef,
  maxRecipients = 100,
  className,
  disabled = false,
}: BatchDropzoneProps & { inputRef?: React.RefObject<HTMLInputElement | null> }) {
  const [isDragOver, setIsDragOver] = useState(false);
  const [internalError, setInternalError] = useState<string | null>(null);
  const localInputRef = useRef<HTMLInputElement>(null);
  const inputRef = externalInputRef ?? localInputRef;

  // Safe toast access (won't crash if rendered outside ToastProvider)
  const toastCtx = useContext(ToastContext);

  const displayError = externalErrorMessage || internalError;
  const state: DropzoneState = isParsing
    ? "parsing"
    : isDragOver
    ? "active"
    : displayError
    ? "error"
    : "idle";

  const handleFileProcess = useCallback(
    async (file: File) => {
      setInternalError(null);
      const validation = validateCsvFile(file);

      if (!validation.valid) {
        const errorMsg = validation.error ?? "Invalid CSV file.";
        setInternalError(errorMsg);
        toastCtx?.error("Invalid file format", errorMsg);
        return;
      }

      try {
        await onFileSelect(file);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Failed to parse CSV file.";
        setInternalError(msg);
        toastCtx?.error("Upload Error", msg);
      }
    },
    [onFileSelect, toastCtx]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragOver(false);

      if (disabled || isParsing) return;

      const file = e.dataTransfer.files?.[0];
      if (file) {
        handleFileProcess(file);
      }
    },
    [disabled, isParsing, handleFileProcess]
  );

  const handleDragOver = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();
      if (!disabled && !isParsing) {
        setIsDragOver(true);
      }
    },
    [disabled, isParsing]
  );

  const handleDragLeave = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  }, []);

  const handleClick = () => {
    if (!disabled && !isParsing) {
      inputRef.current?.click();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if ((e.key === "Enter" || e.key === " ") && !disabled && !isParsing) {
      e.preventDefault();
      inputRef.current?.click();
    }
  };

  return (
    <div className={cn("w-full space-y-3", className)}>
      <div
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-label="Upload CSV file"
        aria-busy={isParsing}
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        data-testid="csv-dropzone"
        data-state={state}
        className={cn(
          "relative border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-ophir-500/40",
          state === "idle" &&
            "border-gray-300 dark:border-gray-700 hover:border-ophir-400 dark:hover:border-ophir-600 bg-white/50 dark:bg-gray-900/50",
          state === "active" &&
            "border-ophir-500 bg-ophir-50/80 dark:bg-ophir-950/40 scale-[1.01] shadow-lg shadow-ophir-500/10 ring-2 ring-ophir-500/30",
          state === "parsing" &&
            "border-ophir-400 bg-ophir-50/40 dark:bg-ophir-950/20 cursor-wait",
          state === "error" &&
            "border-red-400 dark:border-red-600 bg-red-50/40 dark:bg-red-950/20 hover:border-red-500",
          disabled && "opacity-50 cursor-not-allowed hover:border-gray-300"
        )}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".csv,text/csv,application/vnd.ms-excel"
          className="hidden"
          disabled={disabled || isParsing}
          data-testid="csv-file-input"
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) {
              handleFileProcess(file);
            }
          }}
        />

        {/* State: Parsing */}
        {state === "parsing" && (
          <div className="flex flex-col items-center justify-center space-y-3 py-2" data-testid="dropzone-parsing">
            <svg
              className="animate-spin h-8 w-8 text-ophir-600 dark:text-ophir-400"
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
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
              />
            </svg>
            <p className="text-sm font-medium text-gray-800 dark:text-gray-200">
              Parsing and validating recipients...
            </p>
            <div className="w-full max-w-xs">
              <ProgressBar
                value={parseProgress || 50}
                showLabel={true}
                variant="default"
              />
            </div>
          </div>
        )}

        {/* State: Error */}
        {state === "error" && (
          <div className="flex flex-col items-center justify-center space-y-2 py-1" data-testid="dropzone-error">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={1.5}
              stroke="currentColor"
              className="w-10 h-10 text-red-500 dark:text-red-400"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z"
              />
            </svg>
            <p className="text-sm font-semibold text-red-600 dark:text-red-400">
              {displayError}
            </p>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Click or drag a new valid CSV file to try again
            </p>
          </div>
        )}

        {/* State: Active (Drag Over) */}
        {state === "active" && (
          <div className="flex flex-col items-center justify-center space-y-2 py-2" data-testid="dropzone-active">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={2}
              stroke="currentColor"
              className="w-12 h-12 text-ophir-600 dark:text-ophir-400 animate-bounce"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5"
              />
            </svg>
            <p className="text-base font-semibold text-ophir-700 dark:text-ophir-300">
              Drop your CSV file here
            </p>
          </div>
        )}

        {/* State: Idle */}
        {state === "idle" && (
          <div className="flex flex-col items-center justify-center" data-testid="dropzone-idle">
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
              Columns: <span className="font-mono">address,amount,memo</span> — up to {maxRecipients} recipients
            </p>
            {onTemplateDownload && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onTemplateDownload();
                }}
                className="mt-3 text-sm text-ophir-600 dark:text-ophir-400 hover:underline inline-flex items-center gap-1 focus:outline-none"
              >
                <span>Download template</span>
              </button>
            )}
          </div>
        )}
      </div>

      {/* Render file metadata before verification */}
      {showMetadataCard && fileName && (
        <div
          data-testid="file-metadata-card"
          className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 px-4 py-3 rounded-lg border border-gray-200 dark:border-gray-800 bg-gray-50/80 dark:bg-gray-800/40"
        >
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-gray-900 dark:text-white truncate">
                {fileName}
              </span>
              {fileSize !== null && fileSize !== undefined && (
                <span
                  data-testid="file-size-badge"
                  className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 font-mono"
                >
                  {formatFileSize(fileSize)}
                </span>
              )}
            </div>
            {rowCount !== null && rowCount !== undefined && (
              <p
                data-testid="file-row-count"
                className="text-xs text-gray-500 dark:text-gray-400 mt-0.5"
              >
                {rowCount} {rowCount === 1 ? "row" : "rows"}
              </p>
            )}
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={handleClick}
              className="px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 text-xs font-medium hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
            >
              Replace file
            </button>
            {onClear && (
              <button
                type="button"
                onClick={onClear}
                className="px-3 py-1.5 rounded-lg border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 text-xs font-medium hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors"
              >
                Remove file
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
