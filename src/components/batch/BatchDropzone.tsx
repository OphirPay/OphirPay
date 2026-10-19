"use client";
// SPDX-License-Identifier: MIT

import {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useRef,
  useState,
  type DragEvent,
} from "react";
import { cn } from "@/lib/utils";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { downloadCsvTemplate } from "@/lib/csv-import";

const ACCEPTED_MIME = ["text/csv", "application/vnd.ms-excel"];
const ACCEPTED_EXT = [".csv"];

export interface BatchDropzoneHandle {
  /** Clear the selected file and any error state. */
  reset: () => void;
  /** Programmatically open the file picker. */
  openPicker: () => void;
}

export interface BatchDropzoneProps {
  /** Called with the dropped/selected file only after MIME + extension validation passes. */
  onFileAccepted: (file: File) => void;
  /** Called with a user-friendly message when a rejected (non-CSV) file is dropped. */
  onRejected?: (message: string) => void;
  /** Show the parsing progress bar while the parent is parsing the file. */
  parsing?: boolean;
  /** Disable the dropzone (e.g. while a submit is in flight). */
  disabled?: boolean;
  className?: string;
}

function isCsvFile(file: File): boolean {
  const name = file.name.toLowerCase();
  const extOk = ACCEPTED_EXT.some((ext) => name.endsWith(ext));
  const mimeOk = file.type ? ACCEPTED_MIME.includes(file.type) : false;
  return extOk || mimeOk;
}

/**
 * Reusable drag-and-drop upload zone with visual idle / drag-over / parsing /
 * error states, CSV validation before ingestion, and a parsing progress bar.
 */
export const BatchDropzone = forwardRef<BatchDropzoneHandle, BatchDropzoneProps>(
  function BatchDropzone(
    { onFileAccepted, onRejected, parsing = false, disabled = false, className },
    ref
  ) {
    const inputRef = useRef<HTMLInputElement>(null);
    const [isDragActive, setIsDragActive] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [acceptedName, setAcceptedName] = useState<string | null>(null);

    const reset = useCallback(() => {
      setError(null);
      setAcceptedName(null);
      if (inputRef.current) inputRef.current.value = "";
    }, []);

    const openPicker = useCallback(() => {
      inputRef.current?.click();
    }, []);

    useImperativeHandle(ref, () => ({ reset, openPicker }), [reset, openPicker]);

    const handleFile = useCallback(
      (file: File | undefined) => {
        if (!file) return;
        if (!isCsvFile(file)) {
          const msg = `"${file.name}" is not a CSV file. Please choose a .csv file.`;
          setError(msg);
          setAcceptedName(null);
          onRejected?.(msg);
          return;
        }
        setError(null);
        setAcceptedName(file.name);
        onFileAccepted(file);
      },
      [onFileAccepted, onRejected]
    );

    const onDrop = useCallback(
      (e: DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        setIsDragActive(false);
        if (disabled) return;
        handleFile(e.dataTransfer.files?.[0]);
      },
      [disabled, handleFile]
    );

    const isError = error !== null;

    return (
      <div
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-label="Upload CSV file"
        aria-disabled={disabled}
        data-testid="csv-dropzone"
        onClick={() => !disabled && openPicker()}
        onKeyDown={(e) => {
          if (disabled) return;
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            openPicker();
          }
        }}
        onDragOver={(e) => {
          e.preventDefault();
          if (!disabled) setIsDragActive(true);
        }}
        onDragLeave={(e) => {
          e.preventDefault();
          setIsDragActive(false);
        }}
        onDrop={onDrop}
        className={cn(
          "relative border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors focus:outline-none focus:ring-2 focus:ring-ophir-500/40",
          className,
          disabled && "opacity-60 cursor-not-allowed",
          isError
            ? "border-red-500 bg-red-50 dark:bg-red-950/30"
            : isDragActive
              ? "border-ophir-500 bg-ophir-50 dark:bg-ophir-950/30"
              : "border-gray-300 dark:border-gray-700 hover:border-ophir-400 dark:hover:border-ophir-600"
        )}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".csv,text/csv,application/vnd.ms-excel"
          className="hidden"
          data-testid="csv-file-input"
          disabled={disabled}
          onChange={(e) => handleFile(e.target.files?.[0])}
        />

        {parsing ? (
          <div className="space-y-3" data-testid="csv-parsing">
            <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
              Parsing {acceptedName ?? "file"}…
            </p>
            <ProgressBar indeterminate variant="default" />
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Reading rows and validating addresses.
            </p>
          </div>
        ) : (
          <>
            <svg
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={1.5}
              stroke="currentColor"
              className={cn(
                "w-10 h-10 mx-auto mb-3",
                isDragActive
                  ? "text-ophir-600 dark:text-ophir-400"
                  : "text-gray-400 dark:text-gray-500"
              )}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5"
              />
            </svg>
            <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
              {isDragActive
                ? "Drop your CSV here"
                : "Drag & drop your CSV file here, or click to browse"}
            </p>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              Accepts <span className="font-mono">.csv</span> files
            </p>
            {isError && (
              <p
                role="alert"
                className="mt-3 text-xs font-medium text-red-600 dark:text-red-400"
              >
                {error}
              </p>
            )}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                downloadCsvTemplate();
              }}
              className="mt-3 text-sm text-ophir-600 dark:text-ophir-400 hover:underline"
            >
              Download template
            </button>
          </>
        )}
      </div>
    );
  }
);
